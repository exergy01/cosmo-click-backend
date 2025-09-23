// routes/wallet.js - ПОЛНАЯ ВЕРСИЯ С TONAPI - ЧАСТЬ 1/4
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

const { notifyStarsDeposit, notifyTonDeposit, notifyWithdrawalRequest } = require('./telegramBot');

// ======================
// СИСТЕМА ЛОГИРОВАНИЯ
// ======================
const logDeposit = (level, message, data = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  if (level === 'ERROR' && Object.keys(data).length > 0) {
    console.log(`[${timestamp}] [ERROR_DATA]:`, JSON.stringify(data, null, 2));
  }
};

// ======================
// ОБНОВЛЕННАЯ СИСТЕМА ПОЛУЧЕНИЯ ТРАНЗАКЦИЙ - TONAPI
// ======================
const getTonTransactions = async (gameWalletAddress, limit = 50) => {
  logDeposit('INFO', `Получение транзакций для ${gameWalletAddress} через TONAPI`);
  
  // 1. Пробуем TONAPI с токеном
  if (process.env.TONAPI_TOKEN) {
    try {
      logDeposit('INFO', 'Пробуем TONAPI с токеном...');
      const response = await axios.get(`https://tonapi.io/v2/blockchain/accounts/${gameWalletAddress}/transactions`, {
        params: { 
          limit: Math.min(limit, 100),
          sort_order: 'desc'
        },
        headers: {
          'Authorization': `Bearer ${process.env.TONAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });

      if (response.data && response.data.transactions) {
        const transactions = response.data.transactions.map(tx => ({
          transaction_id: { 
            hash: tx.hash,
            lt: tx.lt.toString()
          },
          utime: tx.utime,
          in_msg: tx.in_msg ? {
            source: tx.in_msg.source?.address || tx.in_msg.source,
            value: tx.in_msg.value
          } : null
        }));
        logDeposit('SUCCESS', `TONAPI работает! Получено: ${transactions.length} транзакций`);
        return transactions;
      }
      throw new Error('TONAPI: Invalid response format');
    } catch (error) {
      logDeposit('ERROR', `TONAPI недоступен`, { error: error.message, status: error.response?.status });
    }
  }

  // 2. Пробуем TON Center с API ключом (резерв)
  if (process.env.TONCENTER_API_KEY) {
    try {
      logDeposit('INFO', 'Пробуем TON Center с API ключом...');
      const response = await axios.get('https://toncenter.com/api/v2/getTransactions', {
        params: {
          address: gameWalletAddress,
          limit: Math.min(limit, 100),
          archival: true
        },
        headers: {
          'X-API-Key': process.env.TONCENTER_API_KEY
        },
        timeout: 20000
      });

      if (response.data.ok && response.data.result) {
        logDeposit('SUCCESS', `TON Center работает! Получено: ${response.data.result.length} транзакций`);
        return response.data.result;
      }
      throw new Error(response.data.error || 'TON Center API error');
    } catch (error) {
      logDeposit('ERROR', `TON Center недоступен`, { error: error.message });
    }
  }

  // 3. Последняя попытка - TON Center без ключа
  try {
    logDeposit('INFO', 'Последняя попытка: TON Center без ключа...');
    const response = await axios.get('https://toncenter.com/api/v2/getTransactions', {
      params: {
        address: gameWalletAddress,
        limit: Math.min(limit, 10),
        archival: true
      },
      timeout: 30000
    });

    if (response.data.ok && response.data.result) {
      logDeposit('SUCCESS', `TON Center без ключа работает! Получено: ${response.data.result.length} транзакций`);
      return response.data.result;
    }
    throw new Error(response.data.error || 'TON Center API error');
  } catch (error) {
    logDeposit('ERROR', `TON Center без ключа недоступен`, { error: error.message });
  }

  // Все API недоступны
  throw new Error('Все TON API недоступны');
};
// routes/wallet.js - ЧАСТЬ 2/4 - ПОДКЛЮЧЕНИЕ/ОТКЛЮЧЕНИЕ КОШЕЛЬКА

// ======================
// ПОДКЛЮЧЕНИЕ/ОТКЛЮЧЕНИЕ КОШЕЛЬКА
// ======================

// POST /api/wallet/connect - Подключение кошелька через TON Connect
router.post('/connect', async (req, res) => {
  const { telegram_id, wallet_address, signature } = req.body;
  
  logDeposit('INFO', 'Подключение кошелька', { telegram_id, wallet_address });
  
  if (!telegram_id || !wallet_address) {
    return res.status(400).json({ error: 'Telegram ID and wallet address are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const player = await getPlayer(telegram_id);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    await client.query(
      'UPDATE players SET telegram_wallet = $1, wallet_connected_at = NOW() WHERE telegram_id = $2',
      [wallet_address, telegram_id]
    );

    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Wallet connected successfully',
      wallet_address: wallet_address
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    logDeposit('ERROR', 'Ошибка подключения кошелька', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/wallet/disconnect - Отключение кошелька
router.post('/disconnect', async (req, res) => {
  const { telegram_id } = req.body;
  
  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  try {
    await pool.query(
      'UPDATE players SET telegram_wallet = NULL, wallet_connected_at = NULL WHERE telegram_id = $1',
      [telegram_id]
    );

    res.json({
      success: true,
      message: 'Wallet disconnected successfully'
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================
// ОСНОВНЫЕ ФУНКЦИИ ДЕПОЗИТОВ TON
// ======================

// POST /api/wallet/check-deposit-by-address - Проверка депозитов по адресу
router.post('/check-deposit-by-address', async (req, res) => {
  const { player_id, expected_amount, sender_address, game_wallet } = req.body;
  
  logDeposit('INFO', 'Проверка депозитов по адресу', { player_id, expected_amount, sender_address });
  
  if (!player_id) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  try {
    const gameWalletAddress = game_wallet || process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
    
    // Получаем транзакции через улучшенную систему с TONAPI
    let transactions = [];
    try {
      transactions = await getTonTransactions(gameWalletAddress, 50);
    } catch (apiError) {
      logDeposit('ERROR', 'Все TON API недоступны', { error: apiError.message });
      return res.json({ 
        success: false, 
        error: 'TON API временно недоступны',
        details: 'Попробуйте через несколько минут или обратитесь к администратору'
      });
    }

    logDeposit('INFO', `Анализируем ${transactions.length} транзакций`);
    
    let foundDeposits = [];
    let totalProcessed = 0;
    
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      // Пропускаем исходящие транзакции
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') {
        continue;
      }

      const amount = parseFloat(tx.in_msg.value) / 1000000000;
      const hash = tx.transaction_id.hash;
      const fromAddress = tx.in_msg.source;
      const txTime = new Date(tx.utime * 1000);
      const minutesAgo = Math.floor((Date.now() - txTime.getTime()) / (1000 * 60));
      
      logDeposit('INFO', `Анализируем транзакцию #${i+1}`, {
        amount: amount,
        from: fromAddress ? fromAddress.substring(0, 10) + '...' : 'unknown',
        hash: hash.substring(0, 20) + '...',
        minutes_ago: minutesAgo
      });
      
      // Пропускаем слишком маленькие транзакции
      if (amount < 0.005) {
        logDeposit('DEBUG', 'Пропуск: слишком маленькая сумма', { amount });
        continue;
      }
      
      // Если указана ожидаемая сумма - проверяем
      if (expected_amount && Math.abs(amount - expected_amount) > 0.001) {
        logDeposit('DEBUG', 'Пропуск: сумма не совпадает', { 
          expected: expected_amount, 
          actual: amount 
        });
        continue;
      }
      
      // Если указан адрес отправителя - проверяем
      if (sender_address && fromAddress !== sender_address) {
        logDeposit('DEBUG', 'Пропуск: адрес не совпадает', { 
          expected: sender_address, 
          actual: fromAddress 
        });
        continue;
      }
      
      // Проверяем, не обрабатывали ли уже эту транзакцию
      logDeposit('INFO', 'Проверяем, не обработана ли уже эта транзакция...', { hash });
      const existingTx = await pool.query(
        'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
        [hash]
      );

      if (existingTx.rows.length > 0) {
        logDeposit('WARNING', 'Транзакция уже была обработана ранее', { hash });
        if (foundDeposits.length === 0) {
          return res.json({ success: true, message: 'Deposit already processed' });
        }
        continue;
      }

      logDeposit('SUCCESS', 'НОВАЯ ТРАНЗАКЦИЯ! Начинаем обработку...', { amount, hash });
      
      // Обрабатываем найденный депозит
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const playerResult = await client.query(
          'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
          [player_id]
        );

        if (playerResult.rows.length === 0) {
          await client.query('ROLLBACK');
          logDeposit('ERROR', `Игрок ${player_id} не найден в базе`);
          continue;
        }

        const playerData = playerResult.rows[0];
        const currentBalance = parseFloat(playerData.ton || '0');
        const newBalance = currentBalance + amount;
        
        logDeposit('INFO', 'Обновляем баланс игрока', {
          current_balance: currentBalance,
          adding: amount,
          new_balance: newBalance
        });

        // Обновляем баланс игрока
        await client.query(
          'UPDATE players SET ton = $1 WHERE telegram_id = $2',
          [newBalance, player_id]
        );

        // Записываем транзакцию депозита
        await client.query(
          `INSERT INTO ton_deposits (
            player_id, amount, transaction_hash, status, created_at
          ) VALUES ($1, $2, $3, 'completed', NOW())`,
          [player_id, amount, hash]
        );

        // Записываем в историю баланса
        await client.query(
          `INSERT INTO balance_history (
            telegram_id, currency, old_balance, new_balance, 
            change_amount, reason, details, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            player_id,
            'ton',
            currentBalance,
            newBalance,
            amount,
            'auto_deposit_by_address',
            JSON.stringify({
              transaction_hash: hash,
              from_address: fromAddress,
              auto_processed: true,
              transaction_time: txTime.toISOString()
            })
          ]
        );

        await client.query('COMMIT');
        
        foundDeposits.push({
          amount: amount,
          hash: hash,
          from_address: fromAddress,
          new_balance: newBalance,
          transaction_time: txTime
        });
        
        totalProcessed++;
        
        logDeposit('SUCCESS', 'ДЕПОЗИТ УСПЕШНО ОБРАБОТАН!', {
          player_id,
          amount,
          new_balance: newBalance
        });
        
        // Отправляем уведомление игроку
        try {
          await notifyTonDeposit(playerData, amount, hash);
        } catch (notifyErr) {
          logDeposit('ERROR', 'Ошибка отправки уведомления', { error: notifyErr.message });
        }

      } catch (dbErr) {
        await client.query('ROLLBACK');
        logDeposit('ERROR', 'Ошибка обработки депозита в БД', { error: dbErr.message });
        throw dbErr;
      } finally {
        client.release();
      }
    }

    logDeposit('INFO', 'ИТОГОВЫЙ РЕЗУЛЬТАТ', {
      total_transactions_analyzed: transactions.length,
      new_deposits_found: totalProcessed,
      total_amount_credited: foundDeposits.reduce((sum, dep) => sum + dep.amount, 0).toFixed(8)
    });

    if (totalProcessed > 0) {
      const totalAmount = foundDeposits.reduce((sum, dep) => sum + dep.amount, 0);
      const lastDeposit = foundDeposits[foundDeposits.length - 1];
      
      res.json({
        success: true,
        message: `Найдено и обработано ${totalProcessed} депозитов`,
        deposits_found: totalProcessed,
        total_amount: totalAmount.toFixed(8),
        new_balance: lastDeposit.new_balance.toFixed(8),
        deposits: foundDeposits.map(dep => ({
          amount: dep.amount.toFixed(8),
          hash: dep.hash.substring(0, 16) + '...',
          from: dep.from_address ? dep.from_address.substring(0, 10) + '...' : 'unknown'
        }))
      });
    } else {
      res.json({
        success: false,
        message: 'Deposit not found yet'
      });
    }

  } catch (error) {
    logDeposit('ERROR', 'КРИТИЧЕСКАЯ ОШИБКА', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});
// routes/wallet.js - ЧАСТЬ 3/4 - УНИВЕРСАЛЬНАЯ ПРОВЕРКА И МАНУАЛЬНЫЕ ДЕПОЗИТЫ

// POST /api/wallet/check-all-deposits - Универсальный поиск всех депозитов
router.post('/check-all-deposits', async (req, res) => {
  const { player_id, sender_address } = req.body;
  
  logDeposit('INFO', 'Универсальный поиск депозитов', { player_id, sender_address });
  
  if (!player_id) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  try {
    const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
    
    // Получаем больше транзакций для поиска
    let transactions = [];
    try {
      transactions = await getTonTransactions(gameWalletAddress, 100);
    } catch (apiError) {
      return res.json({ success: false, error: 'TON API недоступны' });
    }
    
    let foundDeposits = [];
    let totalProcessed = 0;
    
    for (const tx of transactions) {
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') continue;

      const amount = parseFloat(tx.in_msg.value) / 1000000000;
      const hash = tx.transaction_id.hash;
      const fromAddress = tx.in_msg.source;
      
      // Фильтр по адресу отправителя (если указан)
      if (sender_address && fromAddress !== sender_address) continue;
      
      // Пропускаем слишком маленькие транзакции
      if (amount < 0.005) continue;

      // Проверяем, не обрабатывали ли уже
      const existingTx = await pool.query(
        'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
        [hash]
      );

      if (existingTx.rows.length > 0) continue;

      logDeposit('INFO', 'НОВАЯ! Обрабатываем...', { amount, hash: hash.substring(0, 20) });

      // Обрабатываем депозит
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const playerResult = await client.query(
          'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
          [player_id]
        );

        if (playerResult.rows.length === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        const playerData = playerResult.rows[0];
        const currentBalance = parseFloat(playerData.ton || '0');
        const newBalance = currentBalance + amount;

        // Обновляем баланс
        await client.query(
          'UPDATE players SET ton = $1 WHERE telegram_id = $2',
          [newBalance, player_id]
        );

        // Записываем депозит
        await client.query(
          `INSERT INTO ton_deposits (
            player_id, amount, transaction_hash, status, created_at
          ) VALUES ($1, $2, $3, 'completed', NOW())`,
          [player_id, amount, hash]
        );

        // История баланса
        await client.query(
          `INSERT INTO balance_history (
            telegram_id, currency, old_balance, new_balance, 
            change_amount, reason, details, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            player_id,
            'ton',
            currentBalance,
            newBalance,
            amount,
            'universal_deposit_check',
            JSON.stringify({
              transaction_hash: hash,
              from_address: fromAddress,
              universal_check: true
            })
          ]
        );

        await client.query('COMMIT');
        
        foundDeposits.push({
          amount: amount,
          hash: hash,
          from_address: fromAddress
        });
        
        totalProcessed++;
        logDeposit('SUCCESS', 'Обработан', { amount_ton: amount });
        
        // Уведомление
        try {
          await notifyTonDeposit(playerData, amount, hash);
        } catch (notifyErr) {
          logDeposit('ERROR', 'Ошибка уведомления', { error: notifyErr.message });
        }

      } catch (dbErr) {
        await client.query('ROLLBACK');
        logDeposit('ERROR', 'Ошибка DB', { error: dbErr.message });
      } finally {
        client.release();
      }
    }

    if (totalProcessed > 0) {
      const totalAmount = foundDeposits.reduce((sum, dep) => sum + dep.amount, 0);
      
      res.json({
        success: true,
        message: `Найдено и обработано ${totalProcessed} депозитов`,
        deposits_found: totalProcessed,
        total_amount: totalAmount.toFixed(8),
        deposits: foundDeposits.map(dep => ({
          amount: dep.amount.toFixed(8),
          hash: dep.hash.substring(0, 10) + '...',
          from: dep.from_address ? dep.from_address.substring(0, 8) + '...' : 'unknown'
        }))
      });
    } else {
      res.json({
        success: true,
        message: 'Новых депозитов не обнаружено',
        deposits_found: 0,
        total_amount: '0'
      });
    }

  } catch (error) {
    logDeposit('ERROR', 'Ошибка универсального поиска', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// ======================
// ДИАГНОСТИКА ДЕПОЗИТОВ
// ======================
router.post('/debug-deposits', async (req, res) => {
  const { player_id } = req.body;
  
  if (!player_id) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  try {
    const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
    
    // 1. Проверяем игрока в базе
    const playerResult = await pool.query(
      'SELECT telegram_id, first_name, ton FROM players WHERE telegram_id = $1',
      [player_id]
    );
    
    if (playerResult.rows.length === 0) {
      return res.json({ 
        success: false, 
        error: 'Player not found',
        debug: { player_found: false }
      });
    }
    
    const player = playerResult.rows[0];
    
    // 2. Проверяем существующие депозиты в базе
    const existingDeposits = await pool.query(
      'SELECT * FROM ton_deposits WHERE player_id = $1 ORDER BY created_at DESC LIMIT 10',
      [player_id]
    );
    
    // 3. Получаем транзакции из блокчейна через TONAPI
    let transactions = [];
    let apiStatus = 'unknown';
    try {
      transactions = await getTonTransactions(gameWalletAddress, 20);
      apiStatus = 'working';
    } catch (apiError) {
      apiStatus = 'failed';
      return res.json({ 
        success: false, 
        error: 'TON API error',
        debug: { ton_api_error: true, error_details: apiError.message }
      });
    }
    
    // 4. Анализируем входящие транзакции
    const incomingTransactions = [];
    
    for (const tx of transactions) {
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') continue;
      
      const amount = parseFloat(tx.in_msg.value) / 1000000000;
      const hash = tx.transaction_id.hash;
      const fromAddress = tx.in_msg.source;
      const txTime = new Date(tx.utime * 1000);
      
      if (amount < 0.005) continue;
      
      incomingTransactions.push({
        amount: amount.toFixed(8),
        hash: hash.substring(0, 16) + '...',
        from: fromAddress ? fromAddress.substring(0, 10) + '...' : 'unknown',
        time: txTime.toISOString(),
        minutes_ago: Math.floor((Date.now() - txTime.getTime()) / (1000 * 60))
      });
    }
    
    // 5. Проверяем историю баланса
    const balanceHistory = await pool.query(
      'SELECT * FROM balance_history WHERE telegram_id = $1 AND currency = $2 ORDER BY timestamp DESC LIMIT 5',
      [player_id, 'ton']
    );
    
    // 6. Формируем отчет
    const debugReport = {
      success: true,
      player: {
        telegram_id: player.telegram_id,
        name: player.first_name,
        current_ton_balance: parseFloat(player.ton || '0'),
      },
      game_wallet: gameWalletAddress,
      api_status: apiStatus,
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
        recent_incoming: incomingTransactions.slice(0, 5)
      },
      balance_history: {
        count: balanceHistory.rows.length,
        recent: balanceHistory.rows.map(bh => ({
          old_balance: parseFloat(bh.old_balance),
          new_balance: parseFloat(bh.new_balance),
          change: parseFloat(bh.change_amount),
          reason: bh.reason,
          timestamp: bh.timestamp
        }))
      },
      recommendations: []
    };
    
    // 7. Анализ и рекомендации
    if (existingDeposits.rows.length === 0) {
      debugReport.recommendations.push("❌ В базе нет записей о депозитах для этого игрока");
    }
    
    if (incomingTransactions.length > 0 && existingDeposits.rows.length === 0) {
      debugReport.recommendations.push("⚠️ В блокчейне есть транзакции, но в базе нет записей - проблема с обработкой");
    }
    
    if (balanceHistory.rows.length === 0) {
      debugReport.recommendations.push("❌ Нет записей об изменениях баланса TON");
    }
    
    const recentTransactions = incomingTransactions.filter(tx => tx.minutes_ago <= 30);
    if (recentTransactions.length > 0) {
      debugReport.recommendations.push(`💡 Найдено ${recentTransactions.length} транзакций за последние 30 минут - попробуйте обработать`);
    }
    
    res.json(debugReport);

  } catch (error) {
    logDeposit('ERROR', 'Ошибка диагностики', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: 'Debug failed',
      details: error.message 
    });
  }
});

// ======================
// МАНУАЛЬНОЕ ДОБАВЛЕНИЕ ДЕПОЗИТА
// ======================
router.post('/manual-add-deposit', async (req, res) => {
  const { player_id, amount, transaction_hash, admin_key } = req.body;
  
  // Простая проверка админ ключа
  if (admin_key !== 'cosmo_admin_2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  if (!player_id || !amount || !transaction_hash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем дублирование
    const existingTx = await pool.query(
      'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
      [transaction_hash]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Transaction already processed' });
    }

    // Получаем данные игрока
    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
      [player_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerData = playerResult.rows[0];
    const currentBalance = parseFloat(playerData.ton || '0');
    const depositAmount = parseFloat(amount);
    const newBalance = currentBalance + depositAmount;

    // Добавляем TON к балансу игрока
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newBalance, player_id]
    );

    // Записываем транзакцию пополнения
    await client.query(
      `INSERT INTO ton_deposits (
        player_id, amount, transaction_hash, status, created_at
      ) VALUES ($1, $2, $3, 'completed', NOW())`,
      [player_id, depositAmount, transaction_hash]
    );

    // История баланса
    await client.query(
      `INSERT INTO balance_history (
        telegram_id, currency, old_balance, new_balance, 
        change_amount, reason, details, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        player_id,
        'ton',
        currentBalance,
        newBalance,
        depositAmount,
        'manual_deposit',
        JSON.stringify({
          transaction_hash: transaction_hash,
          manual_addition: true,
          admin_added: true
        })
      ]
    );

    await client.query('COMMIT');

    // Отправляем уведомление игроку
    try {
      await notifyTonDeposit(playerData, depositAmount, transaction_hash);
    } catch (notifyErr) {
      logDeposit('ERROR', 'Ошибка отправки уведомления', { error: notifyErr.message });
    }

    res.json({
      success: true,
      message: 'Manual deposit added successfully',
      amount: depositAmount,
      new_balance: newBalance
    });

  } catch (err) {
    logDeposit('ERROR', 'Ошибка мануального добавления депозита', { error: err.message });
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});
// routes/wallet.js - ЧАСТЬ 4/4 - ВЫВОД, STARS, ПРЕМИУМ И ИСТОРИЯ

// ======================
// ВЫВОД TON
// ======================

// POST /api/wallet/prepare-withdrawal - Подготовка вывода
router.post('/prepare-withdrawal', async (req, res) => {
  const { telegram_id, amount } = req.body;
  
  logDeposit('INFO', 'Подготовка вывода', { telegram_id, amount });
  
  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
      [telegram_id]
    );
    
    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];
    const playerBalance = parseFloat(player.ton || '0');
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount <= 0 || withdrawAmount > playerBalance || withdrawAmount < 0.1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (
        player_id, amount, status, created_at
      ) VALUES ($1, $2, 'pending', NOW()) 
      RETURNING id`,
      [telegram_id, withdrawAmount]
    );

    const withdrawalId = withdrawalResult.rows[0].id;
    await client.query('COMMIT');

    await notifyWithdrawalRequest(player, withdrawAmount, withdrawalId);

    res.json({
      success: true,
      withdrawal_id: withdrawalId,
      amount: withdrawAmount,
      message: 'Заявка на вывод создана и отправлена администратору'
    });

  } catch (err) {
    logDeposit('ERROR', 'Ошибка подготовки вывода', { error: err.message });
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/wallet/confirm-withdrawal - Подтверждение вывода
router.post('/confirm-withdrawal', async (req, res) => {
  const { telegram_id, amount, transaction_hash, wallet_address } = req.body;
  
  logDeposit('INFO', 'Подтверждение вывода', { telegram_id, amount, transaction_hash });
  
  if (!telegram_id || !amount || !transaction_hash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const player = await getPlayer(telegram_id);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const withdrawAmount = parseFloat(amount);
    const currentBalance = parseFloat(player.ton || '0');

    if (withdrawAmount > currentBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const newBalance = currentBalance - withdrawAmount;
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newBalance, telegram_id]
    );

    await client.query(
      `UPDATE withdrawals 
       SET status = 'completed', 
           transaction_hash = $1,
           wallet_address = $2,
           completed_at = NOW()
       WHERE player_id = $3 
         AND amount = $4 
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [transaction_hash, wallet_address, telegram_id, withdrawAmount]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Withdrawal confirmed',
      new_balance: newBalance
    });

  } catch (err) {
    logDeposit('ERROR', 'Ошибка подтверждения вывода', { error: err.message });
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ======================
// STARS СИСТЕМА
// ======================

// POST /api/wallet/create-stars-invoice - Создание счета Stars
router.post('/create-stars-invoice', async (req, res) => {
  const { telegram_id, amount, description } = req.body;
  
  logDeposit('INFO', 'Создание счета Stars', { telegram_id, amount, description });
  
  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  if (amount < 100 || amount > 150000) {
    return res.status(400).json({ error: 'Amount must be between 100 and 150000 stars' });
  }
  
  try {
    const player = await getPlayer(telegram_id);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const invoice = await bot.telegram.createInvoiceLink({
      title: `CosmoClick: ${amount} Stars`,
      description: description || `Пополнение игрового баланса на ${amount} звезд`,
      payload: JSON.stringify({ 
        type: 'stars_deposit',
        player_id: telegram_id,
        amount: amount,
        timestamp: Date.now()
      }),
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: `${amount} Stars`, amount: amount }]
    });

    logDeposit('SUCCESS', 'Создан счет Stars', { telegram_id, amount, invoice_url: invoice });
    
    res.json({
      success: true,
      invoice_url: invoice,
      amount: amount
    });
    
  } catch (err) {
    logDeposit('ERROR', 'Ошибка создания счета Stars', { 
      error: err.message,
      telegram_id,
      amount
    });
    
    let errorMessage = 'Failed to create Stars invoice';
    if (err.message?.includes('bot token')) {
      errorMessage = 'Bot token is invalid';
    } else if (err.message?.includes('Unauthorized')) {
      errorMessage = 'Bot is not authorized';
    } else if (err.message?.includes('Bad Request')) {
      errorMessage = 'Invalid request parameters';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: err.message
    });
  }
});

// POST /api/wallet/webhook-stars - Webhook Stars
router.post('/webhook-stars', async (req, res) => {
  logDeposit('INFO', 'Stars webhook получен', { body: req.body });
  
  const { pre_checkout_query, message } = req.body;
  
  try {
    if (pre_checkout_query) {
      await bot.telegram.answerPreCheckoutQuery(pre_checkout_query.id, true);
      return res.json({ success: true });
    }
    
    if (message && message.successful_payment) {
      const payment = message.successful_payment;
      const payload = JSON.parse(payment.invoice_payload);
      const playerId = payload.player_id;
      const amount = payment.total_amount;
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const existingTx = await client.query(
          'SELECT id FROM star_transactions WHERE telegram_payment_id = $1',
          [payment.telegram_payment_charge_id]
        );
        
        if (existingTx.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.json({ success: true, message: 'Already processed' });
        }
        
        const playerResult = await client.query(
          'SELECT telegram_id, first_name, username FROM players WHERE telegram_id = $1',
          [playerId]
        );
        
        if (playerResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Player not found' });
        }
        
        const playerData = playerResult.rows[0];
        
        // Начисляем Stars
        await client.query(
          'UPDATE players SET telegram_stars = COALESCE(telegram_stars, 0) + $1 WHERE telegram_id = $2',
          [amount, playerId]
        );
        
        // Записываем транзакцию
        await client.query(
          `INSERT INTO star_transactions (
            player_id, amount, transaction_type, description,
            telegram_payment_id, status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            playerId,
            amount,
            'deposit',
            `Stars purchase: ${amount} stars`,
            payment.telegram_payment_charge_id,
            'completed'
          ]
        );
        
        await client.query('COMMIT');
        
        await notifyStarsDeposit(playerData, amount);
        
        try {
          await bot.telegram.sendMessage(
            playerId,
            `🎉 Поздравляем! Ваш баланс пополнен на ${amount} ⭐ Stars!`,
            {
              reply_markup: {
                inline_keyboard: [[{
                  text: '🎮 Открыть игру',
                  web_app: { url: 'https://cosmoclick-frontend.vercel.app' }
                }]]
              }
            }
          );
        } catch (msgErr) {
          logDeposit('ERROR', 'Ошибка уведомления игрока', { error: msgErr.message });
        }
        
      } catch (dbErr) {
        await client.query('ROLLBACK');
        logDeposit('ERROR', 'Ошибка БД при обработке Stars', { error: dbErr.message });
        throw dbErr;
      } finally {
        client.release();
      }
      
      return res.json({ success: true });
    }
    
    if (message && !message.successful_payment) {
      const messageBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      messageBot.start((ctx) => ctx.reply('Привет! Бот запущен и готов к работе.'));
      await messageBot.handleUpdate(req.body);
      return res.json({ success: true });
    }
    
    res.json({ success: true });
    
  } catch (err) {
    logDeposit('ERROR', 'Ошибка обработки Stars webhook', { error: err.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ======================
// ПРЕМИУМ СИСТЕМА
// ======================

// GET /api/wallet/premium-status/:telegramId - Проверка премиум статуса
router.get('/premium-status/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        premium_no_ads_until,
        premium_no_ads_forever,
        verified
       FROM players 
       WHERE telegram_id = $1`,
      [telegramId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = result.rows[0];
    const now = new Date();
    
    let premiumStatus = {
      active: false,
      forever: false,
      until: null,
      verified: player.verified || false
    };

    if (player.premium_no_ads_forever) {
      premiumStatus = {
        active: true,
        forever: true,
        until: null,
        verified: player.verified || false
      };
    } else if (player.premium_no_ads_until && new Date(player.premium_no_ads_until) > now) {
      premiumStatus = {
        active: true,
        forever: false,
        until: player.premium_no_ads_until,
        verified: player.verified || false
      };
    }

    res.json({
      success: true,
      premium: premiumStatus
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/purchase-premium - Покупка премиума
router.post('/purchase-premium', async (req, res) => {
  const { telegram_id, package_type, payment_method, payment_amount } = req.body;
  
  if (!telegram_id || !package_type || !payment_method || !payment_amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const validPackages = ['no_ads_30_days', 'no_ads_forever'];
  if (!validPackages.includes(package_type)) {
    return res.status(400).json({ error: 'Invalid package type' });
  }

  const validPaymentMethods = ['stars', 'ton'];
  if (!validPaymentMethods.includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  const priceValidation = {
    'no_ads_30_days': { stars: 150, ton: 1 },
    'no_ads_forever': { stars: 1500, ton: 10 }
  };

  const expectedAmount = priceValidation[package_type][payment_method];
  if (parseFloat(payment_amount) !== expectedAmount) {
    return res.status(400).json({ error: 'Invalid payment amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const playerResult = await client.query(
      'SELECT telegram_id, telegram_stars, ton FROM players WHERE telegram_id = $1',
      [telegram_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    if (payment_method === 'stars') {
      const currentStars = parseInt(player.telegram_stars || '0');
      if (currentStars < payment_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Недостаточно Stars! У вас: ${currentStars}, нужно: ${payment_amount}` 
        });
      }
    } else if (payment_method === 'ton') {
      const currentTON = parseFloat(player.ton || '0');
      if (currentTON < payment_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Недостаточно TON! У вас: ${currentTON.toFixed(4)}, нужно: ${payment_amount}` 
        });
      }
    }

    // Списываем средства
    if (payment_method === 'stars') {
      await client.query(
        'UPDATE players SET telegram_stars = telegram_stars - $1 WHERE telegram_id = $2',
        [payment_amount, telegram_id]
      );
    } else if (payment_method === 'ton') {
      await client.query(
        'UPDATE players SET ton = ton - $1 WHERE telegram_id = $2',
        [payment_amount, telegram_id]
      );
    }

    // Обновляем премиум статус + VERIFIED
    if (package_type === 'no_ads_forever') {
      await client.query(
        `UPDATE players SET 
         premium_no_ads_forever = TRUE,
         premium_no_ads_until = NULL,
         verified = TRUE
         WHERE telegram_id = $1`,
        [telegram_id]
      );
    } else if (package_type === 'no_ads_30_days') {
      await client.query(
        `UPDATE players SET 
         premium_no_ads_until = GREATEST(
           COALESCE(premium_no_ads_until, NOW()),
           NOW() + INTERVAL '30 days'
         ),
         verified = TRUE
         WHERE telegram_id = $1`,
        [telegram_id]
      );
    }

    // Добавляем запись в подписки
    const subscriptionResult = await client.query(
      `INSERT INTO premium_subscriptions (
        telegram_id, 
        subscription_type, 
        payment_method, 
        payment_amount,
        end_date,
        transaction_id
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        telegram_id,
        package_type,
        payment_method,
        payment_amount,
        package_type === 'no_ads_forever' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        `prem_${Date.now()}_${telegram_id}`
      ]
    );

    await client.query('COMMIT');

    const successMessage = package_type === 'no_ads_forever' 
      ? 'Поздравляем! Реклама отключена НАВСЕГДА! 🏆' 
      : 'Поздравляем! Реклама отключена на 30 дней! 🎉';

    res.json({
      success: true,
      message: successMessage,
      subscription_id: subscriptionResult.rows[0].id,
      verified_granted: true
    });

    // Отправляем уведомление игроку
    try {
      const notificationMessage = package_type === 'no_ads_forever'
        ? `🎉 Поздравляем! Вы приобрели премиум подписку!\n\n🏆 Реклама отключена НАВСЕГДА!\n✅ Ваш аккаунт теперь верифицирован!\n\nТеперь вы можете наслаждаться игрой CosmoClick без отвлекающей рекламы.`
        : `🎉 Поздравляем! Вы приобрели премиум подписку!\n\n🚫 Реклама отключена на 30 дней!\n✅ Ваш аккаунт теперь верифицирован!\n\nТеперь вы можете наслаждаться игрой CosmoClick без отвлекающей рекламы.`;

      await bot.telegram.sendMessage(
        telegram_id,
        notificationMessage,
        {
          reply_markup: {
            inline_keyboard: [[{
              text: '🎮 Открыть игру',
              web_app: { url: 'https://cosmoclick-frontend.vercel.app' }
            }]]
          }
        }
      );
    } catch (msgErr) {
      logDeposit('ERROR', 'Ошибка отправки уведомления о премиуме', { error: msgErr.message });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ======================
// ИСТОРИЯ ТРАНЗАКЦИЙ
// ======================

// GET /api/wallet/history/:telegramId - История транзакций игрока
router.get('/history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  const { limit = 20, offset = 0 } = req.query;
  
  try {
    // Депозиты TON
    const tonDeposits = await pool.query(`
      SELECT 
        'deposit' as type,
        'ton' as currency,
        amount,
        transaction_hash,
        status,
        created_at,
        'Пополнение TON' as description
      FROM ton_deposits 
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Депозиты Stars
    const starDeposits = await pool.query(`
      SELECT 
        'deposit' as type,
        'stars' as currency,
        amount,
        telegram_payment_id as transaction_hash,
        status,
        created_at,
        description
      FROM star_transactions 
      WHERE player_id = $1 AND transaction_type = 'deposit'
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Выводы
    const withdrawals = await pool.query(`
      SELECT 
        'withdrawal' as type,
        'ton' as currency,
        amount,
        transaction_hash,
        status,
        created_at,
        'Вывод TON' as description
      FROM withdrawals 
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Покупки премиума
    const premiumPurchases = await pool.query(`
      SELECT 
        'premium' as type,
        payment_method as currency,
        payment_amount as amount,
        transaction_id as transaction_hash,
        'completed' as status,
        created_at,
        CASE 
          WHEN subscription_type = 'no_ads_forever' THEN 'Премиум навсегда'
          ELSE 'Премиум на 30 дней'
        END as description
      FROM premium_subscriptions 
      WHERE telegram_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Объединяем все транзакции
    const allTransactions = [
      ...tonDeposits.rows,
      ...starDeposits.rows,
      ...withdrawals.rows,
      ...premiumPurchases.rows
    ];
    
    // Сортируем по дате
    allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Ограничиваем результат
    const limitedTransactions = allTransactions.slice(0, parseInt(limit));
    
    const formattedTransactions = limitedTransactions.map(tx => ({
      type: tx.type,
      currency: tx.currency,
      amount: parseFloat(tx.amount),
      hash: tx.transaction_hash ? tx.transaction_hash.substring(0, 16) + '...' : 'N/A',
      full_hash: tx.transaction_hash,
      status: tx.status,
      date: tx.created_at,
      description: tx.description || 'Транзакция',
      formatted_date: new Date(tx.created_at).toLocaleString('ru-RU')
    }));
    
    res.json({
      success: true,
      transactions: formattedTransactions,
      total_count: allTransactions.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (err) {
    logDeposit('ERROR', 'Ошибка получения истории', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;