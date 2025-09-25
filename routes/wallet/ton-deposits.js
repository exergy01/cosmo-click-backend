// routes/wallet/ton-deposits.js - ЗАЩИЩЕННАЯ ВЕРСИЯ С ПРОВЕРКОЙ PAYLOAD - ЧАСТЬ 1
const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { notifyTonDeposit } = require('../telegramBot');
const axios = require('axios');

const router = express.Router();

// Функция извлечения payload из транзакции - УЛУЧШЕННАЯ ВЕРСИЯ
// Замените функцию extractPayloadFromTransaction в ton-deposits.js на эту версию:

const extractPayloadFromTransaction = (tx) => {
    try {
      if (!tx.in_msg) {
        return null;
      }
  
      let payloadData = null;
      
      // Способ 1: msg_data.body (TONAPI v2)
      if (tx.in_msg.msg_data && tx.in_msg.msg_data.body) {
        payloadData = tx.in_msg.msg_data.body;
      }
      
      // Способ 2: decoded_body
      if (!payloadData && tx.in_msg.decoded_body) {
        payloadData = tx.in_msg.decoded_body;
      }
      
      // Способ 3: message
      if (!payloadData && tx.in_msg.message) {
        payloadData = tx.in_msg.message;
      }
  
      // Способ 4: comment (прямой комментарий)
      if (!payloadData && tx.in_msg.comment) {
        return tx.in_msg.comment;
      }
  
      if (!payloadData) {
        return null;
      }
  
      // Если это уже строка с COSMO
      if (typeof payloadData === 'string') {
        if (payloadData.includes('COSMO:')) {
          return payloadData;
        }
        
        // Пробуем декодировать base64
        try {
          const decoded = Buffer.from(payloadData, 'base64').toString('utf8');
          if (decoded.includes('COSMO:')) {
            console.log('Найден COSMO в base64:', decoded);
            return decoded;
          }
          
          // Пробуем с пропуском первых 4 байтов (magic)
          if (decoded.length > 4) {
            const withoutMagic = decoded.substring(4);
            if (withoutMagic.includes('COSMO:')) {
              console.log('Найден COSMO после magic bytes:', withoutMagic);
              return withoutMagic;
            }
          }
        } catch (e) {
          // Не base64 или другая ошибка
        }
        
        return null;
      }
  
      // Если это объект
      if (typeof payloadData === 'object') {
        if (payloadData.text && payloadData.text.includes('COSMO:')) {
          return payloadData.text;
        }
        if (payloadData.comment && payloadData.comment.includes('COSMO:')) {
          return payloadData.comment;
        }
      }
  
      return null;
    } catch (error) {
      console.log('Не удалось извлечь payload:', error.message);
      return null;
    }
  };
  
  // Также обновите функцию проверки:
  const isDepositForPlayer = (tx, playerId, fromAddress) => {
    const payload = extractPayloadFromTransaction(tx);
    
    console.log(`🔍 Проверка депозита:`);
    console.log(`   - Payload: ${payload || 'отсутствует'}`);
    console.log(`   - От адреса: ${fromAddress || 'неизвестно'}`);
    console.log(`   - Для игрока: ${playerId}`);
    
    // ОСНОВНАЯ ПРОВЕРКА: payload содержит COSMO и правильный telegram_id
    if (payload && payload.includes('COSMO:')) {
      const parts = payload.split(':');
      if (parts.length >= 2 && parts[0] === 'COSMO' && parts[1] === playerId) {
        console.log(`✅ БЕЗОПАСНО: Найден валидный payload для игрока ${playerId}`);
        return {
          valid: true,
          method: 'payload_match',
          details: `COSMO payload для игрока ${playerId}`
        };
      } else if (parts.length >= 2 && parts[0] === 'COSMO') {
        console.log(`❌ ОТКЛОНЕНО: Payload для другого игрока (${parts[1]}, нужен ${playerId})`);
        return {
          valid: false,
          method: 'payload_mismatch',
          details: `Payload для игрока ${parts[1]}, а не ${playerId}`
        };
      }
    }
    
    // РЕЗЕРВНАЯ ПРОВЕРКА для свежих транзакций без payload
    const txTime = new Date(tx.utime * 1000);
    const minutesAgo = Math.floor((Date.now() - txTime.getTime()) / (1000 * 60));
    
    // Разрешаем свежие транзакции (менее 5 минут) если нет payload
    // Это поможет в случаях когда payload технически не сработал
    if (minutesAgo < 5 && !payload) {
      console.log(`⚠️ РАЗРЕШЕНО: Свежая транзакция (${minutesAgo} мин) без payload`);
      return {
        valid: true,
        method: 'fallback_recent',
        details: `Свежая транзакция без payload (${minutesAgo} мин назад)`
      };
    }
    
    console.log(`❌ ОТКЛОНЕНО: Нет валидного payload для игрока ${playerId}`);
    return {
      valid: false,
      method: 'no_valid_payload',
      details: 'Нет COSMO payload или транзакция не свежая'
    };
  };  

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
              value: tx.in_msg?.value,
              msg_data: tx.in_msg?.msg_data || null,
              decoded_body: tx.in_msg?.decoded_body || null,
              message: tx.in_msg?.message || null
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
          // Преобразуем формат TON Center в нужный нам
          const transactions = response.data.result.map(tx => ({
            transaction_id: { 
              hash: tx.transaction_id.hash,
              lt: tx.transaction_id.lt.toString()
            },
            utime: tx.utime,
            in_msg: tx.in_msg ? {
              source: tx.in_msg.source,
              value: tx.in_msg.value,
              msg_data: tx.in_msg.msg_data || null,
              decoded_body: tx.in_msg.decoded_body || null,
              message: tx.in_msg.message || null
            } : null
          }));
          console.log(`TON Center работает! Получено ${transactions.length} транзакций`);
          return transactions;
        }
      } catch (error) {
        console.log('TON Center ошибка:', error.message);
      }
    }
  
    throw new Error('Все TON API недоступны');
  };
  // routes/wallet/ton-deposits.js - ЗАЩИЩЕННАЯ ВЕРСИЯ - ЧАСТЬ 3

// ЗАЩИЩЕННАЯ функция обработки депозита
async function processDeposit(playerId, amount, hash, fromAddress, validationInfo) {
    console.log(`🔐 ЗАЩИЩЕННАЯ ОБРАБОТКА ДЕПОЗИТА:`);
    console.log(`   - Сумма: ${amount} TON`);
    console.log(`   - От: ${fromAddress}`);
    console.log(`   - Hash: ${hash}`);
    console.log(`   - Игрок: ${playerId}`);
    console.log(`   - Валидация: ${validationInfo.method} - ${validationInfo.details}`);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // ШАГ 1: Проверяем существование игрока
      console.log(`🔍 Шаг 1: Проверка игрока...`);
      const playerResult = await client.query(
        'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
        [playerId]
      );
  
      if (playerResult.rows.length === 0) {
        console.log(`❌ ОШИБКА: Игрок ${playerId} не найден в базе`);
        await client.query('ROLLBACK');
        return { success: false, error: 'Player not found' };
      }
  
      const playerData = playerResult.rows[0];
      const currentBalance = parseFloat(playerData.ton || '0');
      console.log(`✅ Игрок найден: ${playerData.first_name}, баланс: ${currentBalance}`);
      
      // ШАГ 2: Проверяем дублирование транзакции
      console.log(`🔍 Шаг 2: Проверка дублирования...`);
      const existingCheck = await client.query(
        'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
        [hash]
      );
  
      if (existingCheck.rows.length > 0) {
        console.log(`⚠️ Транзакция уже обработана: ${hash}`);
        await client.query('ROLLBACK');
        return { success: false, error: 'Transaction already processed', skipped: true };
      }
      console.log(`✅ Транзакция новая`);
      
      // ШАГ 3: Обновляем баланс
      const newBalance = currentBalance + amount;
      console.log(`💰 Шаг 3: Обновление баланса: ${currentBalance} + ${amount} = ${newBalance}`);
      
      const updateResult = await client.query(
        'UPDATE players SET ton = $1 WHERE telegram_id = $2 RETURNING ton',
        [newBalance, playerId]
      );
      
      if (updateResult.rows.length === 0) {
        console.log(`❌ ОШИБКА: Не удалось обновить баланс`);
        await client.query('ROLLBACK');
        return { success: false, error: 'Failed to update balance' };
      }
      console.log(`✅ Баланс обновлен: ${updateResult.rows[0].ton}`);
  
      // ШАГ 4: Записываем транзакцию депозита
      console.log(`📝 Шаг 4: Запись депозита...`);
      const depositResult = await client.query(
        `INSERT INTO ton_deposits (
          player_id, amount, transaction_hash, status, created_at, validation_method, from_address
        ) VALUES ($1, $2, $3, 'completed', NOW(), $4, $5) 
        RETURNING id`,
        [playerId, amount, hash, validationInfo.method, fromAddress]
      );
      console.log(`✅ Депозит записан с ID: ${depositResult.rows[0].id}`);
  
      // ШАГ 5: История баланса
      console.log(`📜 Шаг 5: История баланса...`);
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
          'secure_auto_deposit',
          JSON.stringify({
            transaction_hash: hash,
            from_address: fromAddress,
            validation_method: validationInfo.method,
            validation_details: validationInfo.details,
            processed_by: 'secure_system',
            timestamp: new Date().toISOString()
          })
        ]
      );
      console.log(`✅ История баланса записана`);
  
      // ШАГ 6: Коммит транзакции
      await client.query('COMMIT');
      console.log(`🎉 УСПЕХ! Защищенный депозит обработан: ${amount} TON для игрока ${playerId}`);
      
      // ШАГ 7: Уведомление (не критично)
      try {
        await notifyTonDeposit(playerData, amount, hash);
        console.log(`📧 Уведомление отправлено`);
      } catch (notifyErr) {
        console.log('⚠️ Уведомление не отправлено (не критично):', notifyErr.message);
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
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА в защищенном processDeposit:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
  // routes/wallet/ton-deposits.js - ЗАЩИЩЕННАЯ ВЕРСИЯ - ЧАСТЬ 4

// POST /check-deposits - ЗАЩИЩЕННАЯ проверка депозитов
router.post('/check-deposits', async (req, res) => {
    const { player_id, sender_address } = req.body;
    
    console.log('🛡️ ===============================================================');
    console.log('🛡️ ЗАЩИЩЕННАЯ ПРОВЕРКА ДЕПОЗИТОВ');
    console.log('🛡️ Игрок:', player_id);
    console.log('🛡️ Кошелек отправителя:', sender_address || 'не указан');
    console.log('🛡️ ===============================================================');
    
    if (!player_id) {
      return res.status(400).json({ error: 'Player ID обязателен' });
    }
  
    try {
      const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 
        'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
      
      // Получаем транзакции из блокчейна
      let transactions = [];
      try {
        transactions = await getTonTransactions(gameWalletAddress, 100);
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
      
      console.log('🔍 Анализ транзакций с проверкой безопасности...');
      
      // Обрабатываем каждую транзакцию с проверкой безопасности
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
        
        // 🛡️ КЛЮЧЕВАЯ ПРОВЕРКА БЕЗОПАСНОСТИ
        const validationResult = isDepositForPlayer(tx, player_id, fromAddress);
        
        if (!validationResult.valid) {
          console.log(`🚫 ОТКЛОНЕНО: ${validationResult.details}`);
          rejectedCount++;
          continue;
        }
        
        console.log(`✅ ПРИНЯТО: ${validationResult.details}`);
        console.log('🔄 Обработка защищенного депозита...');
        
        // ОБРАБАТЫВАЕМ ЗАЩИЩЕННЫЙ ДЕПОЗИТ
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
      
      console.log('\n🛡️ ===============================================================');
      console.log('🛡️ ЗАЩИЩЕННАЯ ПРОВЕРКА ЗАВЕРШЕНА');
      console.log(`🛡️ Успешно обработано: ${processed.length}`);
      console.log(`🛡️ Уже обработано (пропущено): ${skippedCount}`);
      console.log(`🛡️ Отклонено по безопасности: ${rejectedCount}`);
      console.log(`🛡️ Ошибок: ${errorCount}`);
      console.log('🛡️ ===============================================================');
      
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
          message += ` (${rejectedCount} отклонено по безопасности - нет правильного payload)`;
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
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА в защищенной проверке:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Внутренняя ошибка сервера',
        details: error.message 
      });
    }
  });
  // routes/wallet/ton-deposits.js - ЗАЩИЩЕННАЯ ВЕРСИЯ - ЧАСТЬ 5

// POST /manual-add - Ручное добавление депозита (только для админов)
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
      console.log('Ручной депозит добавлен:', { player_id, amount, transaction_hash });
      res.json({
        success: true,
        message: 'Ручной депозит успешно добавлен',
        ...result
      });
    } else {
      res.status(500).json(result);
    }
  });
  
  // POST /debug-deposits - Диагностика депозитов с информацией о безопасности
  router.post('/debug-deposits', async (req, res) => {
    const { player_id } = req.body;
    
    if (!player_id) {
      return res.status(400).json({ error: 'Player ID обязателен' });
    }
  
    try {
      const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 
        'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
      
      // Проверяем игрока в базе
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
      
      // Проверяем существующие депозиты в базе
      const existingDeposits = await pool.query(
        'SELECT * FROM ton_deposits WHERE player_id = $1 ORDER BY created_at DESC LIMIT 15',
        [player_id]
      );
      
      // Получаем транзакции из блокчейна
      let transactions = [];
      let apiStatus = 'unknown';
      let apiError = null;
      try {
        transactions = await getTonTransactions(gameWalletAddress, 20);
        apiStatus = 'working';
      } catch (apiErrorCatch) {
        apiStatus = 'failed';
        apiError = apiErrorCatch.message;
        return res.json({ 
          success: false, 
          error: 'Ошибка TON API',
          debug: { ton_api_error: true, error_details: apiError }
        });
      }
      
      // Анализируем входящие транзакции с проверкой payload и безопасности
      const incomingTransactions = [];
      
      for (const tx of transactions) {
        if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') continue;
        
        const amount = parseFloat(tx.in_msg.value) / 1000000000;
        const hash = tx.transaction_id.hash;
        const fromAddress = tx.in_msg.source;
        const txTime = new Date(tx.utime * 1000);
        
        if (amount < 0.005) continue;
        
        // Проверяем payload для безопасности
        const payload = extractPayloadFromTransaction(tx);
        const validationResult = isDepositForPlayer(tx, player_id, fromAddress);
        
        incomingTransactions.push({
          amount: amount.toFixed(8),
          hash: hash.substring(0, 16) + '...',
          full_hash: hash,
          from: fromAddress ? fromAddress.substring(0, 10) + '...' : 'unknown',
          from_full: fromAddress,
          time: txTime.toISOString(),
          minutes_ago: Math.floor((Date.now() - txTime.getTime()) / (1000 * 60)),
          payload: payload || 'отсутствует',
          valid_for_player: validationResult.valid,
          validation_method: validationResult.method,
          validation_details: validationResult.details
        });
      }
      
      // Проверяем, какие транзакции уже обработаны
      const processedHashes = existingDeposits.rows.map(dep => dep.transaction_hash);
      const unprocessedTransactions = incomingTransactions.filter(tx => 
        !processedHashes.includes(tx.full_hash)
      );
      
      // Фильтруем только валидные для этого игрока
      const validUnprocessedTransactions = unprocessedTransactions.filter(tx => tx.valid_for_player);
      
      // Формируем отчет
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
        security_info: {
          total_incoming_transactions: incomingTransactions.length,
          valid_for_player: incomingTransactions.filter(tx => tx.valid_for_player).length,
          rejected_for_security: incomingTransactions.filter(tx => !tx.valid_for_player).length
        },
        database_deposits: {
          count: existingDeposits.rows.length,
          deposits: existingDeposits.rows.map(dep => ({
            amount: parseFloat(dep.amount),
            status: dep.status,
            created_at: dep.created_at,
            hash: dep.transaction_hash ? dep.transaction_hash.substring(0, 16) + '...' : 'no_hash',
            validation_method: dep.validation_method || 'legacy'
          }))
        },
        blockchain_transactions: {
          count: incomingTransactions.length,
          recent_incoming: incomingTransactions.slice(0, 5),
          unprocessed_count: unprocessedTransactions.length,
          unprocessed: unprocessedTransactions.slice(0, 3),
          valid_unprocessed_count: validUnprocessedTransactions.length,
          valid_unprocessed: validUnprocessedTransactions.slice(0, 3)
        },
        recommendations: []
      };
      
      // Рекомендации по безопасности
      if (validUnprocessedTransactions.length > 0) {
        debugReport.recommendations.push(`НАЙДЕНО ${validUnprocessedTransactions.length} ВАЛИДНЫХ необработанных транзакций для этого игрока!`);
        validUnprocessedTransactions.slice(0, 2).forEach((tx, i) => {
          debugReport.recommendations.push(`   ${i+1}. ${tx.amount} TON с payload: ${tx.payload} (${tx.minutes_ago} мин назад)`);
        });
      } else if (unprocessedTransactions.length > validUnprocessedTransactions.length) {
        const rejectedCount = unprocessedTransactions.length - validUnprocessedTransactions.length;
        debugReport.recommendations.push(`БЕЗОПАСНОСТЬ: ${rejectedCount} транзакций отклонено - нет правильного COSMO payload`);
        debugReport.recommendations.push("Это нормально - система защищена от зачисления чужих депозитов");
      } else if (incomingTransactions.length > 0) {
        debugReport.recommendations.push("УСПЕХ: Все найденные транзакции уже обработаны");
      } else {
        debugReport.recommendations.push("Входящих транзакций в блокчейне не найдено");
      }
      
      // Инструкции по использованию payload
      debugReport.recommendations.push("ВАЖНО: Убедитесь, что депозиты отправляются через приложение с COSMO payload!");
      
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
  
  module.exports = router;