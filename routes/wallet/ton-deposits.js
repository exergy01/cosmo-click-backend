// routes/wallet/ton-deposits.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С РАБОЧЕЙ АВТООБРАБОТКОЙ
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

// ИСПРАВЛЕННАЯ функция обработки одного депозита
async function processDeposit(playerId, amount, hash, fromAddress) {
  console.log(`PROCESSING DEPOSIT: ${amount} TON from ${fromAddress} hash: ${hash.substring(0, 20)}...`);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Проверяем дублирование ПОСЛЕ получения игрока
    console.log(`Getting player data for: ${playerId}`);
    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
      [playerId]
    );

    if (playerResult.rows.length === 0) {
      console.log(`ERROR: Player not found: ${playerId}`);
      await client.query('ROLLBACK');
      return { success: false, error: 'Player not found' };
    }

    const playerData = playerResult.rows[0];
    const currentBalance = parseFloat(playerData.ton || '0');
    
    console.log(`Checking if transaction already processed: ${hash}`);
    const existingCheck = await client.query(
      'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
      [hash]
    );

    if (existingCheck.rows.length > 0) {
      console.log(`SKIPPED: Transaction already processed: ${hash}`);
      await client.query('ROLLBACK');
      return { success: false, error: 'Transaction already processed', skipped: true };
    }
    
    const newBalance = currentBalance + amount;
    console.log(`Balance update: ${currentBalance} + ${amount} = ${newBalance}`);
    
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
        'auto_deposit_fixed',
        JSON.stringify({
          transaction_hash: hash,
          from_address: fromAddress,
          processed_by: 'fixed_system',
          debug_info: 'auto_processed_after_fix'
        })
      ]
    );

    await client.query('COMMIT');
    
    console.log(`SUCCESS! Deposit processed! New balance: ${newBalance}`);
    
    // Отправляем уведомление игроку
    try {
      await notifyTonDeposit(playerData, amount, hash);
      console.log(`Notification sent to player`);
    } catch (notifyErr) {
      console.log('Notification failed:', notifyErr.message);
    }
    
    return {
      success: true,
      amount,
      new_balance: newBalance,
      hash: hash.substring(0, 16) + '...',
      old_balance: currentBalance
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('CRITICAL ERROR in deposit processing:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

// POST /check-deposits - ИСПРАВЛЕННАЯ функция проверки депозитов
router.post('/check-deposits', async (req, res) => {
  const { player_id, sender_address } = req.body;
  
  console.log('===============================================================');
  console.log('STARTING DEPOSIT CHECK FOR PLAYER:', player_id);
  console.log('SENDER ADDRESS FILTER:', sender_address);
  console.log('===============================================================');
  
  if (!player_id) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  try {
    const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
    
    // Получаем транзакции
    let transactions = [];
    try {
      transactions = await getTonTransactions(gameWalletAddress, 100);
      console.log(`Retrieved ${transactions.length} transactions from blockchain`);
    } catch (apiError) {
      console.error('All APIs failed:', apiError.message);
      return res.json({ 
        success: false, 
        error: 'TON API temporarily unavailable',
        details: 'Try again in a few minutes or contact admin'
      });
    }
    
    const processed = [];
    let skippedCount = 0;
    let totalAnalyzed = 0;
    
    console.log('Starting transaction analysis...');
    
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      totalAnalyzed++;
      
      console.log(`\nTransaction ${i+1}/${transactions.length}:`);
      
      // Пропускаем исходящие транзакции
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') {
        console.log('Skipping: outgoing or zero value transaction');
        continue;
      }

      const amount = parseFloat(tx.in_msg.value) / 1000000000;
      const hash = tx.transaction_id.hash;
      const fromAddress = tx.in_msg.source;
      const txTime = new Date(tx.utime * 1000);
      const minutesAgo = Math.floor((Date.now() - txTime.getTime()) / (1000 * 60));
      
      console.log(`Amount: ${amount} TON`);
      console.log(`Hash: ${hash.substring(0, 20)}...`);
      console.log(`From: ${fromAddress ? fromAddress.substring(0, 15) + '...' : 'unknown'}`);
      console.log(`Time: ${minutesAgo} minutes ago`);
      
      // ИСПРАВЛЕНО: Убираем слишком строгий фильтр минимальной суммы
      if (amount < 0.005) {
        console.log('Skipping: amount too small (< 0.005 TON)');
        continue;
      }
      
      // Фильтр по адресу отправителя (если указан)
      if (sender_address && fromAddress !== sender_address) {
        console.log(`Skipping: sender address doesn't match filter`);
        console.log(`   Expected: ${sender_address}`);
        console.log(`   Actual: ${fromAddress}`);
        continue;
      }
      
      console.log('Transaction passes filters, attempting to process...');
      
      // ГЛАВНОЕ ИСПРАВЛЕНИЕ: Обрабатываем депозит
      const result = await processDeposit(player_id, amount, hash, fromAddress);
      
      if (result.success) {
        processed.push(result);
        console.log(`SUCCESS! Processed deposit: ${amount} TON`);
      } else if (result.skipped) {
        skippedCount++;
        console.log(`SKIPPED: ${result.error}`);
      } else {
        console.log(`FAILED: ${result.error}`);
      }
    }
    
    console.log('\n=============================================================');
    console.log('DEPOSIT CHECK COMPLETE');
    console.log(`Transactions analyzed: ${totalAnalyzed}`);
    console.log(`Successfully processed: ${processed.length}`);
    console.log(`Already processed (skipped): ${skippedCount}`);
    console.log('=============================================================');
    
    if (processed.length > 0) {
      const totalAmount = processed.reduce((sum, dep) => sum + dep.amount, 0);
      
      res.json({
        success: true,
        message: `Found and processed ${processed.length} new deposits`,
        deposits_found: processed.length,
        total_amount: totalAmount.toFixed(8),
        deposits: processed.map(dep => ({
          amount: dep.amount.toFixed(8),
          hash: dep.hash,
          new_balance: dep.new_balance.toFixed(8),
          old_balance: dep.old_balance.toFixed(8)
        }))
      });
    } else {
      res.json({
        success: true,
        message: skippedCount > 0 ? 
          `No new deposits found (${skippedCount} already processed)` : 
          'No new deposits found',
        deposits_found: 0,
        total_amount: '0',
        analyzed: totalAnalyzed,
        skipped: skippedCount
      });
    }

  } catch (error) {
    console.error('CRITICAL ERROR in deposit check:', error);
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

// POST /debug-deposits - Диагностика депозитов С ДОПОЛНИТЕЛЬНОЙ ИНФОРМАЦИЕЙ
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
    let apiError = null;
    try {
      transactions = await getTonTransactions(gameWalletAddress, 20);
      apiStatus = 'working';
    } catch (apiErrorCatch) {
      apiStatus = 'failed';
      apiError = apiErrorCatch.message;
      return res.json({ 
        success: false, 
        error: 'TON API error',
        debug: { ton_api_error: true, error_details: apiError }
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
        full_hash: hash,
        from: fromAddress ? fromAddress.substring(0, 10) + '...' : 'unknown',
        from_full: fromAddress,
        time: txTime.toISOString(),
        minutes_ago: Math.floor((Date.now() - txTime.getTime()) / (1000 * 60))
      });
    }
    
    // Проверяем, какие транзакции уже обработаны
    const processedHashes = existingDeposits.rows.map(dep => dep.transaction_hash);
    const unprocessedTransactions = incomingTransactions.filter(tx => 
      !processedHashes.includes(tx.full_hash)
    );
    
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
        unprocessed: unprocessedTransactions.slice(0, 3)
      },
      recommendations: []
    };
    
    // РАСШИРЕННЫЕ рекомендации
    if (existingDeposits.rows.length === 0) {
      debugReport.recommendations.push("ERROR: No deposits found in database for this player");
    }
    
    if (unprocessedTransactions.length > 0) {
      debugReport.recommendations.push(`CRITICAL: FOUND ${unprocessedTransactions.length} UNPROCESSED transactions! System should process these automatically.`);
      unprocessedTransactions.slice(0, 2).forEach((tx, i) => {
        debugReport.recommendations.push(`   ${i+1}. ${tx.amount} TON from ${tx.from} (${tx.minutes_ago} min ago)`);
      });
    }
    
    if (incomingTransactions.length > 0 && unprocessedTransactions.length === 0) {
      debugReport.recommendations.push("SUCCESS: All blockchain transactions are already processed in database");
    }
    
    const recentTransactions = incomingTransactions.filter(tx => tx.minutes_ago <= 60);
    if (recentTransactions.length > 0) {
      debugReport.recommendations.push(`URGENT: Found ${recentTransactions.length} transactions in last hour - should be processed immediately`);
    }
    
    // Проверяем, есть ли транзакции которые должны быть обработаны но не обработаны
    if (apiStatus === 'working' && unprocessedTransactions.length > 0) {
      debugReport.recommendations.push("SYSTEM BUG DETECTED: API working but transactions not auto-processed. Check deposit processing logic.");
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