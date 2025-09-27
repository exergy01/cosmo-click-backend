// routes/wallet/ton-deposits.js - ПОЛНАЯ ВЕРСИЯ С ВРЕМЕННЫМ ОКНОМ И ОТСЛЕЖИВАНИЕМ ПОПЫТОК
const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { notifyTonDeposit } = require('../telegramBot');
const axios = require('axios');

const router = express.Router();

// Получение транзакций TON
const getTonTransactions = async (gameWalletAddress, limit = 50) => {
  console.log(`Получаем TON транзакции для ${gameWalletAddress}`);
  
  // ПРИОРИТЕТ: TONAPI с токеном
  if (process.env.TONAPI_TOKEN) {
    try {
      console.log('Пробуем TONAPI с токеном...');
      const response = await axios.get(`https://tonapi.io/v2/blockchain/accounts/${gameWalletAddress}/transactions`, {
        params: { 
          limit: Math.min(limit, 100),
          sort_order: 'desc'
        },
        headers: {
          'Authorization': `Bearer ${process.env.TONAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      if (response.data && response.data.transactions) {
        const transactions = response.data.transactions.map(tx => ({
          transaction_id: { 
            hash: tx.hash,
            lt: tx.lt.toString()
          },
          utime: tx.utime,
          in_msg: {
            source: tx.in_msg?.source?.address || tx.in_msg?.source,
            value: tx.in_msg?.value
          }
        }));
        console.log(`TONAPI работает! Получено ${transactions.length} транзакций`);
        return transactions;
      }
    } catch (error) {
      console.log('TONAPI ошибка:', error.message);
    }
  }

  // Резерв: TON Center
  if (process.env.TONCENTER_API_KEY) {
    try {
      console.log('Пробуем TON Center с API ключом...');
      const response = await axios.get('https://toncenter.com/api/v2/getTransactions', {
        params: {
          address: gameWalletAddress,
          limit: Math.min(limit, 50),
          archival: true
        },
        headers: {
          'X-API-Key': process.env.TONCENTER_API_KEY
        },
        timeout: 15000
      });

      if (response.data.ok && response.data.result) {
        console.log(`TON Center работает! Получено ${response.data.result.length} транзакций`);
        return response.data.result;
      }
    } catch (error) {
      console.log('TON Center ошибка:', error.message);
    }
  }

  throw new Error('Все TON API недоступны');
};

// Функция создания таблицы для ожидаемых депозитов (если не существует)
const ensureExpectedDepositsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expected_deposits (
        id SERIAL PRIMARY KEY,
        player_id VARCHAR(50) NOT NULL,
        amount DECIMAL(10, 8) NOT NULL,
        from_address VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        processed BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Создаем индексы если их нет
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_expected_player_from_amount 
      ON expected_deposits (player_id, from_address, amount)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_expected_expires_processed 
      ON expected_deposits (expires_at, processed)
    `);
    
    console.log('✅ Таблица expected_deposits готова');
  } catch (error) {
    console.error('Ошибка создания таблицы expected_deposits:', error);
  }
};

// Инициализируем таблицу при запуске
ensureExpectedDepositsTable();

// Функция проверки принадлежности депозита с временным окном
const isDepositForPlayerWithTimeWindow = async (tx, playerId, fromAddress) => {
    const txTime = new Date(tx.utime * 1000);
    const minutesAgo = Math.floor((Date.now() - txTime.getTime()) / (1000 * 60));
    const amount = parseFloat(tx.in_msg.value) / 1000000000;
    
    console.log(`🔍 Проверка депозита с временным окном:`);
    console.log(`   - Сумма: ${amount} TON`);
    console.log(`   - От адреса: ${fromAddress || 'неизвестно'}`);
    console.log(`   - Время: ${minutesAgo} минут назад`);
    console.log(`   - Для игрока: ${playerId}`);
    
    try {
      // ОСНОВНАЯ ПРОВЕРКА: Ищем ожидаемый депозит только по игроку и сумме (без адреса)
      const expectedResult = await pool.query(
        `SELECT id, amount, created_at, from_address FROM expected_deposits 
         WHERE player_id = $1 
         AND ABS(amount - $2) < 0.001
         AND expires_at > NOW()
         AND NOT processed
         ORDER BY created_at DESC 
         LIMIT 1`,
        [playerId, amount]
      );
      
      if (expectedResult.rows.length > 0) {
        const expectedDeposit = expectedResult.rows[0];
        const expectedMinutesAgo = Math.floor((Date.now() - new Date(expectedDeposit.created_at).getTime()) / (1000 * 60));
        
        console.log(`✅ НАЙДЕН ОЖИДАЕМЫЙ ДЕПОЗИТ: ${expectedDeposit.amount} TON (${expectedMinutesAgo} мин назад)`);
        console.log(`   - Ожидался от: ${expectedDeposit.from_address}`);
        console.log(`   - Пришел от: ${fromAddress}`);
        
        // Помечаем ожидаемый депозит как обработанный
        await pool.query(
          'UPDATE expected_deposits SET processed = true WHERE id = $1',
          [expectedDeposit.id]
        );
        
        return {
          valid: true,
          method: 'expected_deposit_by_amount',
          details: `Найден ожидаемый депозит по сумме для игрока ${playerId}`
        };
      }
      
      // РЕЗЕРВНАЯ ПРОВЕРКА: Очень свежие транзакции (менее 2 минут)
      if (minutesAgo < 2) {
        console.log(`⚠️ РАЗРЕШЕНО: Очень свежая транзакция (${minutesAgo} мин)`);
        return {
          valid: true,
          method: 'fallback_very_fresh',
          details: `Очень свежая транзакция (${minutesAgo} мин назад)`
        };
      }
      
    } catch (error) {
      console.error('Ошибка проверки ожидаемых депозитов:', error);
    }
    
    console.log(`❌ ОТКЛОНЕНО: Нет ожидаемого депозита для игрока ${playerId}`);
    return {
      valid: false,
      method: 'no_expected_deposit',
      details: 'Депозит не найден в ожидаемых или слишком старый'
    };
  };
  // ПРОДОЛЖЕНИЕ ton-deposits.js - Часть 2: Функция обработки депозита

// Функция обработки депозита С ОТСЛЕЖИВАНИЕМ СТАТУСОВ
async function processDeposit(playerId, amount, hash, fromAddress, validationInfo) {
    console.log(`💰 ОБРАБОТКА ДЕПОЗИТА:`);
    console.log(`   - Сумма: ${amount} TON`);
    console.log(`   - От: ${fromAddress}`);
    console.log(`   - Hash: ${hash}`);
    console.log(`   - Игрок: ${playerId}`);
    console.log(`   - Метод валидации: ${validationInfo.method}`);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // ШАГ 1: Проверяем игрока
      const playerResult = await client.query(
        'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
        [playerId]
      );
  
      if (playerResult.rows.length === 0) {
        console.log(`❌ Игрок ${playerId} не найден`);
        await client.query('ROLLBACK');
        return { success: false, error: 'Player not found' };
      }
  
      const playerData = playerResult.rows[0];
      const currentBalance = parseFloat(playerData.ton || '0');
      console.log(`✅ Игрок: ${playerData.first_name}, баланс: ${currentBalance} TON`);
      
      // ШАГ 2: Проверяем дублирование
      const existingCheck = await client.query(
        'SELECT id, status FROM ton_deposits WHERE transaction_hash = $1 AND status = $2',
        [hash, 'completed']
      );
  
      if (existingCheck.rows.length > 0) {
        console.log(`⚠️ Транзакция уже обработана: ${hash} (статус: ${existingCheck.rows[0].status})`);
        await client.query('ROLLBACK');
        return { success: false, error: 'Transaction already processed', skipped: true };
      }
      
      // ШАГ 3: Обновляем баланс игрока
      const newBalance = currentBalance + amount;
      console.log(`💰 Обновляем баланс: ${currentBalance} + ${amount} = ${newBalance}`);
      
      const updateResult = await client.query(
        'UPDATE players SET ton = $1 WHERE telegram_id = $2 RETURNING ton',
        [newBalance, playerId]
      );
      
      if (updateResult.rows.length === 0) {
        console.log(`❌ Не удалось обновить баланс`);
        await client.query('ROLLBACK');
        return { success: false, error: 'Failed to update balance' };
      }
  
      // ШАГ 4: Записываем депозит в историю со статусом 'completed'
      const depositResult = await client.query(
        `INSERT INTO ton_deposits (
          player_id, amount, transaction_hash, status, created_at
        ) VALUES ($1, $2, $3, 'completed', NOW()) 
        RETURNING id`,
        [playerId, amount, hash]
      );
      
      console.log(`✅ Депозит записан с ID: ${depositResult.rows[0].id}`);
  
      // ШАГ 5: Записываем в balance_history (если таблица существует)
      try {
        await client.query(
          `INSERT INTO balance_history (
            telegram_id, currency, old_balance, new_balance, 
            change_amount, reason, details, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            playerId,
            'ton',
            currentBalance,
            newBalance,
            amount,
            'deposit_with_time_window',
            JSON.stringify({
              transaction_hash: hash,
              from_address: fromAddress,
              validation_method: validationInfo.method,
              validation_details: validationInfo.details,
              timestamp: new Date().toISOString()
            })
          ]
        );
        console.log(`✅ История баланса записана`);
      } catch (historyError) {
        console.log('⚠️ Не удалось записать историю баланса (не критично):', historyError.message);
      }
  
      // Коммитим транзакцию
      await client.query('COMMIT');
      console.log(`🎉 УСПЕХ! Депозит обработан: ${amount} TON для ${playerData.first_name}`);
      
      // Отправляем уведомление (не критично)
      try {
        if (notifyTonDeposit) {
          await notifyTonDeposit(playerData, amount, hash);
          console.log(`📧 Уведомление отправлено`);
        }
      } catch (notifyErr) {
        console.log('⚠️ Уведомление не отправлено:', notifyErr.message);
      }
      
      return {
        success: true,
        amount,
        new_balance: newBalance,
        hash: hash.substring(0, 16) + '...',
        old_balance: currentBalance,
        deposit_id: depositResult.rows[0].id,
        validation_method: validationInfo.method
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА в processDeposit:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
  
  // POST /register-expected - Регистрация ожидаемого депозита + запись попытки
  router.post('/register-expected', async (req, res) => {
    const { player_id, amount, from_address, timestamp } = req.body;
    
    if (!player_id || !amount || !from_address) {
      return res.status(400).json({ error: 'Отсутствуют обязательные поля' });
    }
  
    try {
      // Удаляем старые записи этого игрока
      await pool.query(
        'DELETE FROM expected_deposits WHERE player_id = $1 AND created_at < NOW() - INTERVAL \'1 hour\'',
        [player_id]
      );
  
      // Создаем запись об ожидаемом депозите
      const result = await pool.query(
        `INSERT INTO expected_deposits (
          player_id, amount, from_address, created_at, expires_at
        ) VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '10 minutes')
        RETURNING id`,
        [player_id, parseFloat(amount), from_address]
      );
      
      // НОВОЕ: Записываем попытку депозита в ton_deposits со статусом 'pending'
      try {
        await pool.query(
          `INSERT INTO ton_deposits (
            player_id, amount, transaction_hash, status, created_at
          ) VALUES ($1, $2, $3, 'pending', NOW())`,
          [
            player_id,
            parseFloat(amount),
            null // transaction_hash будет позже
          ]
        );
        console.log('✅ Попытка депозита зарегистрирована со статусом pending');
      } catch (depositErr) {
        console.error('Ошибка записи попытки депозита:', depositErr);
      }
      
      console.log(`📝 Зарегистрирован ожидаемый депозит: ${amount} TON от ${from_address} для игрока ${player_id}`);
      
      res.json({ 
        success: true, 
        message: 'Ожидаемый депозит зарегистрирован',
        expected_deposit_id: result.rows[0].id
      });
      
    } catch (error) {
      console.error('Ошибка регистрации ожидаемого депозита:', error);
      res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
  });
  
  // НОВЫЙ ENDPOINT: Обновление статуса попытки депозита (отмена/ошибка)
  router.post('/update-deposit-status', async (req, res) => {
    const { player_id, amount, status } = req.body;
    
    console.log('Обновление статуса депозита:', { player_id, amount, status });
    
    if (!player_id || !amount || !status) {
      return res.status(400).json({ error: 'Отсутствуют обязательные поля' });
    }
  
    try {
      // Обновляем статус pending депозита
      const result = await pool.query(
        `UPDATE ton_deposits 
         SET status = $1
         WHERE player_id = $2 
           AND amount = $3 
           AND status = 'pending' 
           AND created_at >= NOW() - INTERVAL '1 hour'
         RETURNING id`,
        [status, player_id, parseFloat(amount)]
      );
      
      if (result.rows.length > 0) {
        console.log(`✅ Статус депозита обновлен на '${status}'`);
        res.json({ success: true, message: `Статус обновлен: ${status}` });
      } else {
        console.log('⚠️ Не найден pending депозит для обновления');
        res.json({ success: false, message: 'Pending депозит не найден' });
      }
      
    } catch (error) {
      console.error('Ошибка обновления статуса депозита:', error);
      res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
  });
  // ПРОДОЛЖЕНИЕ ton-deposits.js - Часть 3: Остальные эндпоинты

// POST /check-deposits - Основная функция проверки депозитов (БЕЗ ИЗМЕНЕНИЙ)
router.post('/check-deposits', async (req, res) => {
    const { player_id, sender_address } = req.body;
    
    console.log('🔒 ===============================================================');
    console.log('🔒 ЗАЩИЩЕННАЯ ПРОВЕРКА ДЕПОЗИТОВ С ВРЕМЕННЫМ ОКНОМ');
    console.log('🔒 Игрок:', player_id);
    console.log('🔒 Адрес отправителя:', sender_address || 'не указан');
    console.log('🔒 ===============================================================');
    
    if (!player_id) {
      return res.status(400).json({ error: 'Player ID обязателен' });
    }
  
    try {
      const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 
        'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
      
      // Получаем транзакции из блокчейна
      let transactions = [];
      try {
        transactions = await getTonTransactions(gameWalletAddress, 50);
        console.log(`🔗 Получено ${transactions.length} транзакций из блокчейна`);
      } catch (apiError) {
        console.error('💥 Все API недоступны:', apiError.message);
        return res.json({ 
          success: false, 
          error: 'TON API временно недоступен',
          details: 'Попробуйте через несколько минут'
        });
      }
      
      const processed = [];
      let skippedCount = 0;
      let rejectedCount = 0;
      let errorCount = 0;
      
      console.log('🔍 Анализ транзакций с проверкой временного окна...');
      
      // Обрабатываем каждую транзакцию
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        
        console.log(`\n📋 Транзакция ${i+1}/${transactions.length}:`);
        
        // Пропускаем исходящие транзакции
        if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') {
          console.log('⭕ Пропуск: исходящая или нулевая транзакция');
          continue;
        }
  
        const amount = parseFloat(tx.in_msg.value) / 1000000000;
        const hash = tx.transaction_id.hash;
        const fromAddress = tx.in_msg.source;
        const txTime = new Date(tx.utime * 1000);
        const minutesAgo = Math.floor((Date.now() - txTime.getTime()) / (1000 * 60));
        
        console.log(`💰 Сумма: ${amount} TON`);
        console.log(`🔗 Hash: ${hash.substring(0, 20)}...`);
        console.log(`👤 От: ${fromAddress ? fromAddress.substring(0, 15) + '...' : 'неизвестно'}`);
        console.log(`⏰ Время: ${minutesAgo} минут назад`);
        
        // Фильтр минимальной суммы
        if (amount < 0.005) {
          console.log('⭕ Пропуск: сумма меньше 0.005 TON');
          continue;
        }
        
        // 🔒 ПРОВЕРКА С ВРЕМЕННЫМ ОКНОМ
        const validationResult = await isDepositForPlayerWithTimeWindow(tx, player_id, fromAddress);
        
        if (!validationResult.valid) {
          console.log(`🚫 ОТКЛОНЕНО: ${validationResult.details}`);
          rejectedCount++;
          continue;
        }
        
        console.log(`✅ ПРИНЯТО: ${validationResult.details}`);
        console.log('🔄 Обработка депозита...');
        
        // ОБРАБАТЫВАЕМ ДЕПОЗИТ
        const result = await processDeposit(player_id, amount, hash, fromAddress, validationResult);
        
        if (result.success) {
          processed.push(result);
          console.log(`🎉 УСПЕХ! Обработано: ${amount} TON`);
        } else if (result.skipped) {
          skippedCount++;
          console.log(`⚠️ ПРОПУЩЕНО: ${result.error}`);
        } else {
          errorCount++;
          console.log(`❌ ОШИБКА: ${result.error}`);
        }
      }
      
      console.log('\n🔒 ===============================================================');
      console.log('🔒 ПРОВЕРКА ЗАВЕРШЕНА');
      console.log(`🔒 Успешно обработано: ${processed.length}`);
      console.log(`🔒 Уже обработано (пропущено): ${skippedCount}`);
      console.log(`🔒 Отклонено по безопасности: ${rejectedCount}`);
      console.log(`🔒 Ошибок: ${errorCount}`);
      console.log('🔒 ===============================================================');
      
      if (processed.length > 0) {
        const totalAmount = processed.reduce((sum, dep) => sum + dep.amount, 0);
        
        res.json({
          success: true,
          message: `УСПЕХ! Найдено и безопасно обработано ${processed.length} депозитов`,
          deposits_found: processed.length,
          total_amount: totalAmount.toFixed(8),
          rejected_for_security: rejectedCount,
          deposits: processed.map(dep => ({
            amount: dep.amount.toFixed(8),
            hash: dep.hash,
            new_balance: dep.new_balance.toFixed(8),
            old_balance: dep.old_balance.toFixed(8),
            deposit_id: dep.deposit_id,
            validation_method: dep.validation_method
          }))
        });
      } else {
        let message = 'Новых депозитов не найдено';
        if (rejectedCount > 0) {
          message += ` (${rejectedCount} отклонено по безопасности)`;
        }
        if (skippedCount > 0) {
          message += ` (${skippedCount} уже обработано)`;
        }
        
        res.json({
          success: true,
          message: message,
          deposits_found: 0,
          total_amount: '0',
          rejected_for_security: rejectedCount,
          skipped: skippedCount,
          errors: errorCount
        });
      }
  
    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА в проверке депозитов:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Внутренняя ошибка сервера',
        details: error.message 
      });
    }
  });
  
  // POST /manual-add - Ручное добавление депозита (только для админов) - БЕЗ ИЗМЕНЕНИЙ
  router.post('/manual-add', async (req, res) => {
    const { player_id, amount, transaction_hash, admin_key } = req.body;
    
    if (admin_key !== 'cosmo_admin_2025') {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    
    if (!player_id || !amount || !transaction_hash) {
      return res.status(400).json({ error: 'Отсутствуют обязательные поля' });
    }
  
    const validationInfo = {
      method: 'manual_admin',
      details: 'Ручное добавление администратором'
    };
  
    const result = await processDeposit(player_id, parseFloat(amount), transaction_hash, 'manual_admin', validationInfo);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Ручной депозит успешно добавлен',
        ...result
      });
    } else {
      res.status(500).json(result);
    }
  });
  
  // Очистка старых ожидаемых депозитов - БЕЗ ИЗМЕНЕНИЙ
  const cleanupExpiredDeposits = async () => {
    try {
      const result = await pool.query(
        'DELETE FROM expected_deposits WHERE expires_at < NOW() - INTERVAL \'1 hour\''
      );
      if (result.rowCount > 0) {
        console.log(`🧹 Очищено ${result.rowCount} устаревших ожидаемых депозитов`);
      }
    } catch (error) {
      console.error('Ошибка очистки ожидаемых депозитов:', error);
    }
  };
  
  // POST /debug-deposits - Диагностика депозитов - БЕЗ ИЗМЕНЕНИЙ  
  router.post('/debug-deposits', async (req, res) => {
    // ... весь код debug остается прежним ...
    const { player_id } = req.body;
    
    if (!player_id) {
      return res.status(400).json({ error: 'Player ID обязателен' });
    }
  
    try {
      const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 
        'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
      
      const playerResult = await pool.query(
        'SELECT telegram_id, first_name, ton FROM players WHERE telegram_id = $1',
        [player_id]
      );
      
      if (playerResult.rows.length === 0) {
        return res.json({ 
          success: false, 
          error: 'Игрок не найден',
          debug: { player_found: false }
        });
      }
      
      const player = playerResult.rows[0];
      
      const existingDeposits = await pool.query(
        'SELECT * FROM ton_deposits WHERE player_id = $1 ORDER BY created_at DESC LIMIT 10',
        [player_id]
      );
      
      const expectedDeposits = await pool.query(
        'SELECT * FROM expected_deposits WHERE player_id = $1 ORDER BY created_at DESC LIMIT 5',
        [player_id]
      );
      
      let transactions = [];
      let apiStatus = 'unknown';
      let apiError = null;
      try {
        transactions = await getTonTransactions(gameWalletAddress, 15);
        apiStatus = 'working';
      } catch (apiErrorCatch) {
        apiStatus = 'failed';
        apiError = apiErrorCatch.message;
      }
      
      const incomingTransactions = [];
      
      for (const tx of transactions) {
        if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') continue;
        
        const amount = parseFloat(tx.in_msg.value) / 1000000000;
        const hash = tx.transaction_id.hash;
        const fromAddress = tx.in_msg.source;
        const txTime = new Date(tx.utime * 1000);
        
        if (amount < 0.005) continue;
        
        const validationResult = await isDepositForPlayerWithTimeWindow(tx, player_id, fromAddress);
        
        incomingTransactions.push({
          amount: amount.toFixed(8),
          hash: hash.substring(0, 16) + '...',
          full_hash: hash,
          from: fromAddress ? fromAddress.substring(0, 10) + '...' : 'unknown',
          from_full: fromAddress,
          time: txTime.toISOString(),
          minutes_ago: Math.floor((Date.now() - txTime.getTime()) / (1000 * 60)),
          valid_for_player: validationResult.valid,
          validation_method: validationResult.method,
          validation_details: validationResult.details
        });
      }
      
      const processedHashes = existingDeposits.rows.map(dep => dep.transaction_hash);
      const unprocessedTransactions = incomingTransactions.filter(tx => 
        !processedHashes.includes(tx.full_hash)
      );
      const validUnprocessedTransactions = unprocessedTransactions.filter(tx => tx.valid_for_player);
      
      const debugReport = {
        success: true,
        player: {
          telegram_id: player.telegram_id,
          name: player.first_name,
          current_ton_balance: parseFloat(player.ton || '0'),
        },
        game_wallet: gameWalletAddress,
        api_status: apiStatus,
        api_error: apiError,
        expected_deposits: {
          count: expectedDeposits.rows.length,
          active_count: expectedDeposits.rows.filter(dep => !dep.processed && new Date(dep.expires_at) > new Date()).length,
          deposits: expectedDeposits.rows.map(dep => ({
            amount: parseFloat(dep.amount),
            from_address: dep.from_address ? dep.from_address.substring(0, 10) + '...' : 'unknown',
            created_minutes_ago: Math.floor((Date.now() - new Date(dep.created_at).getTime()) / (1000 * 60)),
            expires_minutes: Math.floor((new Date(dep.expires_at).getTime() - Date.now()) / (1000 * 60)),
            processed: dep.processed
          }))
        },
        database_deposits: {
          count: existingDeposits.rows.length,
          deposits: existingDeposits.rows.map(dep => ({
            amount: parseFloat(dep.amount),
            status: dep.status,
            created_at: dep.created_at,
            hash: dep.transaction_hash ? dep.transaction_hash.substring(0, 16) + '...' : 'no_hash'
          }))
        },
        blockchain_transactions: {
          count: incomingTransactions.length,
          recent_incoming: incomingTransactions.slice(0, 5),
          unprocessed_count: unprocessedTransactions.length,
          valid_unprocessed_count: validUnprocessedTransactions.length,
          valid_unprocessed: validUnprocessedTransactions.slice(0, 3)
        },
        recommendations: []
      };
      
      if (validUnprocessedTransactions.length > 0) {
        debugReport.recommendations.push(`НАЙДЕНО ${validUnprocessedTransactions.length} ВАЛИДНЫХ необработанных депозитов!`);
      } else if (unprocessedTransactions.length > 0) {
        debugReport.recommendations.push(`${unprocessedTransactions.length} необработанных транзакций отклонено системой безопасности`);
      } else {
        debugReport.recommendations.push("Все транзакции обработаны или нет новых депозитов");
      }
      
      if (expectedDeposits.rows.length === 0) {
        debugReport.recommendations.push("Нет ожидаемых депозитов. Отправляйте TON через приложение для регистрации ожидания.");
      }
      
      res.json(debugReport);
  
    } catch (error) {
      console.error('Ошибка диагностики:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Ошибка диагностики',
        details: error.message 
      });
    }
  });
  
  // GET /status - Статус системы депозитов - БЕЗ ИЗМЕНЕНИЙ
  router.get('/status', async (req, res) => {
    try {
      let tonApiStatus = 'unknown';
      try {
        const gameWallet = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
        await getTonTransactions(gameWallet, 1);
        tonApiStatus = 'working';
      } catch (apiError) {
        tonApiStatus = 'failed';
      }
      
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_deposits,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as deposits_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as deposits_1h,
          COALESCE(SUM(amount), 0) as total_amount,
          COALESCE(SUM(amount) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) as amount_24h,
          COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_count
        FROM ton_deposits
      `);
      
      const expectedStats = await pool.query(`
        SELECT 
          COUNT(*) as total_expected,
          COUNT(*) FILTER (WHERE NOT processed AND expires_at > NOW()) as active_expected,
          COUNT(*) FILTER (WHERE processed) as processed_expected
        FROM expected_deposits
      `);
      
      res.json({
        success: true,
        system_status: 'operational',
        ton_api_status: tonApiStatus,
        deposit_stats: stats.rows[0],
        expected_deposit_stats: expectedStats.rows[0],
        last_check: new Date().toISOString()
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        system_status: 'error',
        error: error.message
      });
    }
  });
  
  // Запускаем очистку каждые 10 минут
  setInterval(cleanupExpiredDeposits, 10 * 60 * 1000);
  
  module.exports = router;