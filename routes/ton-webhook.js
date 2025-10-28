// routes/ton-webhook.js - WEBHOOK ДЛЯ ДЕПОЗИТОВ
const express = require('express');
const pool = require('../db');
const { notifyTonDeposit } = require('./telegramBot');

const router = express.Router();

// POST /api/ton-webhook/transaction - Прием уведомлений о транзакциях
router.post('/transaction', async (req, res) => {
  const { hash, account, amount, lt, utime, source } = req.body;
  
  if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Получена транзакция', {
    hash: hash?.substring(0, 16) + '...',
    account,
    amount,
    source
  });
  
  if (!hash || !account || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const gameWalletAddress = process.env.GAME_WALLET_ADDRESS || 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
  
  // Проверяем, что это транзакция на игровой кошелек
  if (account !== gameWalletAddress) {
    if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Транзакция не для игрового кошелька');
    return res.json({ success: true, message: 'Not game wallet' });
  }

  const tonAmount = parseFloat(amount) / 1000000000; // nano -> TON
  
  // Пропускаем слишком маленькие транзакции
  if (tonAmount < 0.01) {
    if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Транзакция слишком маленькая');
    return res.json({ success: true, message: 'Amount too small' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем дублирование
    const existingTx = await client.query(
      'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
      [hash]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Транзакция уже обработана');
      return res.json({ success: true, message: 'Already processed' });
    }

    // Пытаемся найти игрока по комментарию или другим способом
    let playerId = null;
    
    // 1. Проверяем комментарий в транзакции
    if (req.body.comment) {
      const match = req.body.comment.match(/(\d{8,12})/);
      if (match) {
        playerId = match[1];
      }
    }
    
    // 2. Если ID не найден в комментарии, ищем по связанному кошельку
    if (!playerId && source) {
      const playerResult = await client.query(
        'SELECT telegram_id FROM players WHERE telegram_wallet = $1',
        [source]
      );
      
      if (playerResult.rows.length > 0) {
        playerId = playerResult.rows[0].telegram_id;
      }
    }
    
    // 3. Если игрок не найден, сохраняем как неопознанный депозит
    if (!playerId) {
      await client.query(
        `INSERT INTO ton_deposits (
          player_id, amount, transaction_hash, status, created_at
        ) VALUES ($1, $2, $3, 'unidentified', NOW())`,
        ['unknown', tonAmount, hash]
      );
      
      await client.query('COMMIT');
      if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Неопознанный депозит сохранен');
      
      // Отправляем уведомление админу
      // TODO: Добавить уведомление админу о неопознанном депозите
      
      return res.json({ 
        success: true, 
        message: 'Unidentified deposit saved',
        amount: tonAmount
      });
    }

    // 4. Обрабатываем депозит для найденного игрока
    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
      [playerId]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Игрок не найден в базе');
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerData = playerResult.rows[0];
    const currentBalance = parseFloat(playerData.ton || '0');
    const newBalance = currentBalance + tonAmount;

    // Обновляем баланс игрока
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newBalance, playerId]
    );

    // Записываем депозит
    await client.query(
      `INSERT INTO ton_deposits (
        player_id, amount, transaction_hash, status, created_at
      ) VALUES ($1, $2, $3, 'completed', NOW())`,
      [playerId, tonAmount, hash]
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
        tonAmount,
        'webhook_deposit',
        JSON.stringify({
          transaction_hash: hash,
          source_address: source,
          webhook_processed: true,
          utime: utime
        })
      ]
    );

    await client.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log('WEBHOOK: Депозит успешно обработан', {
      player: playerId,
      amount: tonAmount,
      new_balance: newBalance
    });

    // Отправляем уведомление игроку
    try {
      await notifyTonDeposit(playerData, tonAmount, hash);
    } catch (notifyErr) {
      console.error('WEBHOOK: Ошибка уведомления', notifyErr.message);
    }

    res.json({
      success: true,
      message: 'Deposit processed',
      player_id: playerId,
      amount: tonAmount,
      new_balance: newBalance
    });

  } catch (err) {
    console.error('WEBHOOK: Ошибка обработки', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/ton-webhook/status - Проверка работы webhook
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'TON Webhook is running',
    timestamp: new Date().toISOString(),
    game_wallet: process.env.GAME_WALLET_ADDRESS
  });
});

module.exports = router;