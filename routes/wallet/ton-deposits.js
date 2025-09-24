const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { notifyTonDeposit } = require('../telegramBot');
const axios = require('axios');

const router = express.Router();

// Упрощенная система получения транзакций
const getTonTransactions = async (gameWalletAddress, limit = 50) => {
  console.log(`Getting TON transactions for ${gameWalletAddress}`);
  
  // ПРИОРИТЕТ: TONAPI с токеном
  if (process.env.TONAPI_TOKEN) {
    try {
      console.log('Trying TONAPI with token...');
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
          in_msg: tx.in_msg ? {
            source: tx.in_msg.source?.address || tx.in_msg.source,
            value: tx.in_msg.value
          } : null
        }));
        console.log(`TONAPI working! Got ${transactions.length} transactions`);
        return transactions;
      }
    } catch (error) {
      console.log('TONAPI failed:', error.message);
    }
  }

  // Резерв: TON Center с ключом
  if (process.env.TONCENTER_API_KEY) {
    try {
      console.log('Trying TON Center with API key...');
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
        console.log(`TON Center working! Got ${response.data.result.length} transactions`);
        return response.data.result;
      }
    } catch (error) {
      console.log('TON Center failed:', error.message);
    }
  }

  throw new Error('All TON APIs unavailable');
};

// Функция обработки одного депозита
async function processDeposit(playerId, amount, hash, fromAddress) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
      [playerId]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Player not found' };
    }

    const playerData = playerResult.rows[0];
    const currentBalance = parseFloat(playerData.ton || '0');
    const newBalance = currentBalance + amount;
    
    // Обновляем баланс игрока
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newBalance, playerId]
    );

    // Записываем транзакцию депозита
    await client.query(
      `INSERT INTO ton_deposits (
        player_id, amount, transaction_hash, status, created_at
      ) VALUES ($1, $2, $3, 'completed', NOW())`,
      [playerId, amount, hash]
    );

    // Записываем в историю баланса
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
        'auto_deposit',
        JSON.stringify({
          transaction_hash: hash,
          from_address: fromAddress,
          processed_by: 'refactored_system'
        })
      ]
    );

    await client.query('COMMIT');
    
    // Отправляем уведомление игроку
    try {
      await notifyTonDeposit(playerData, amount, hash);
    } catch (notifyErr) {
      console.log('Notification failed:', notifyErr.message);
    }
    
    return {
      success: true,
      amount,
      new_balance: newBalance,
      hash: hash.substring(0, 16) + '...'
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Deposit processing error:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

// POST /check-deposits - ЕДИНСТВЕННАЯ функция проверки депозитов
router.post('/check-deposits', async (req, res) => {
  const { player_id, sender_address } = req.body;
  
  console.log('Checking deposits for player:', { player_id, sender_address });
  
  if (!player_id) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  try {
    const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
    
    // Получаем транзакции
    let transactions = [];
    try {
      transactions = await getTonTransactions(gameWalletAddress, 100);
    } catch (apiError) {
      console.error('All APIs failed:', apiError.message);
      return res.json({ 
        success: false, 
        error: 'TON API temporarily unavailable',
        details: 'Try again in a few minutes or contact admin'
      });
    }

    console.log(`Analyzing ${transactions.length} transactions`);
    
    const processed = [];
    
    for (const tx of transactions) {
      // Пропускаем исходящие транзакции
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') {
        continue;
      }

      const amount = parseFloat(tx.in_msg.value) / 1000000000;
      const hash = tx.transaction_id.hash;
      const fromAddress = tx.in_msg.source;
      
      // Фильтры
      if (amount < 0.01) continue; // минимум 0.01 TON
      if (sender_address && fromAddress !== sender_address) continue;
      
      // Проверяем дублирование
      const existingTx = await pool.query(
        'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
        [hash]
      );

      if (existingTx.rows.length > 0) continue;
      
      console.log('Processing new deposit:', { amount, hash: hash.substring(0, 20) + '...' });
      
      // Обрабатываем депозит
      const result = await processDeposit(player_id, amount, hash, fromAddress);
      if (result.success) {
        processed.push(result);
      }
    }
    
    console.log(`Processing complete. Found ${processed.length} new deposits`);
    
    if (processed.length > 0) {
      const totalAmount = processed.reduce((sum, dep) => sum + dep.amount, 0);
      
      res.json({
        success: true,
        message: `Found and processed ${processed.length} deposits`,
        deposits_found: processed.length,
        total_amount: totalAmount.toFixed(8),
        deposits: processed.map(dep => ({
          amount: dep.amount.toFixed(8),
          hash: dep.hash,
          new_balance: dep.new_balance.toFixed(8)
        }))
      });
    } else {
      res.json({
        success: true,
        message: 'No new deposits found',
        deposits_found: 0,
        total_amount: '0'
      });
    }

  } catch (error) {
    console.error('Critical error in deposit check:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// POST /manual-add - Мануальное добавление депозита (только для админов)
router.post('/manual-add', async (req, res) => {
  const { player_id, amount, transaction_hash, admin_key } = req.body;
  
  if (admin_key !== 'cosmo_admin_2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  if (!player_id || !amount || !transaction_hash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Проверяем дублирование
  const existingTx = await pool.query(
    'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
    [transaction_hash]
  );

  if (existingTx.rows.length > 0) {
    return res.status(400).json({ error: 'Transaction already processed' });
  }

  const result = await processDeposit(player_id, parseFloat(amount), transaction_hash, 'manual_admin');
  
  if (result.success) {
    console.log('Manual deposit added:', { player_id, amount, transaction_hash });
    res.json({
      success: true,
      message: 'Manual deposit added successfully',
      ...result
    });
  } else {
    res.status(500).json(result);
  }
});

// POST /debug-deposits - Диагностика депозитов
router.post('/debug-deposits', async (req, res) => {
  const { player_id } = req.body;
  
  if (!player_id) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  try {
    const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
    
    // Проверяем игрока в базе
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
    
    // Проверяем существующие депозиты в базе
    const existingDeposits = await pool.query(
      'SELECT * FROM ton_deposits WHERE player_id = $1 ORDER BY created_at DESC LIMIT 10',
      [player_id]
    );
    
    // Получаем транзакции из блокчейна
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
    
    // Анализируем входящие транзакции
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
      recommendations: []
    };
    
    // Анализ и рекомендации
    if (existingDeposits.rows.length === 0) {
      debugReport.recommendations.push("No deposits found in database for this player");
    }
    
    if (incomingTransactions.length > 0 && existingDeposits.rows.length === 0) {
      debugReport.recommendations.push("Found blockchain transactions but no database records - processing issue");
    }
    
    const recentTransactions = incomingTransactions.filter(tx => tx.minutes_ago <= 30);
    if (recentTransactions.length > 0) {
      debugReport.recommendations.push(`Found ${recentTransactions.length} transactions in last 30 minutes - try processing`);
    }
    
    res.json(debugReport);

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Debug failed',
      details: error.message 
    });
  }
});

module.exports = router;