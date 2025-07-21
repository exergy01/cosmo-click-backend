// routes/wallet.js - ИСПРАВЛЕННАЯ ВЕРСИЯ
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { Telegraf } = require('telegraf');

const router = express.Router();

// Получаем экземпляр бота ПРАВИЛЬНО
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// POST /api/wallet/connect - Подключение кошелька через TON Connect
router.post('/connect', async (req, res) => {
  const { telegram_id, wallet_address, signature } = req.body;
  
  console.log('💳 Подключение кошелька:', { telegram_id, wallet_address, signature });
  
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

    // Обновляем адрес кошелька
    await client.query(
      'UPDATE players SET telegram_wallet = $1, wallet_connected_at = NOW() WHERE telegram_id = $2',
      [wallet_address, telegram_id]
    );

    await client.query('COMMIT');
    
    console.log(`✅ Кошелек подключен для ${telegram_id}: ${wallet_address}`);
    
    res.json({
      success: true,
      message: 'Wallet connected successfully',
      wallet_address: wallet_address
    });
    
  } catch (err) {
    console.error('❌ Ошибка подключения кошелька:', err);
    await client.query('ROLLBACK');
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

    console.log(`✅ Кошелек отключен для ${telegram_id}`);

    res.json({
      success: true,
      message: 'Wallet disconnected successfully'
    });
    
  } catch (err) {
    console.error('❌ Ошибка отключения кошелька:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/prepare-withdrawal - Подготовка вывода средств
router.post('/prepare-withdrawal', async (req, res) => {
  const { telegram_id, amount } = req.body;
  
  console.log('💸 Подготовка вывода:', { telegram_id, amount });
  
  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const player = await getPlayer(telegram_id);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerBalance = parseFloat(player.ton || '0');
    const withdrawAmount = parseFloat(amount);

    console.log('💰 Проверка баланса:', { playerBalance, withdrawAmount });

    if (withdrawAmount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (withdrawAmount > playerBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Минимальная сумма вывода
    const MIN_WITHDRAWAL = 0.1;
    if (withdrawAmount < MIN_WITHDRAWAL) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Minimum withdrawal amount is ${MIN_WITHDRAWAL} TON` 
      });
    }

    // Создаем запись о предстоящем выводе
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (
        player_id, 
        amount, 
        status, 
        created_at
      ) VALUES ($1, $2, 'pending', NOW()) 
      RETURNING id`,
      [telegram_id, withdrawAmount]
    );

    const withdrawalId = withdrawalResult.rows[0].id;

    await client.query('COMMIT');

    console.log(`✅ Заявка на вывод создана: ${withdrawalId}`);

    res.json({
      success: true,
      withdrawal_id: withdrawalId,
      amount: withdrawAmount,
      payload: Buffer.from(`withdrawal:${withdrawalId}`).toString('base64')
    });

  } catch (err) {
    console.error('❌ Ошибка подготовки вывода:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/wallet/confirm-withdrawal - Подтверждение вывода после транзакции
router.post('/confirm-withdrawal', async (req, res) => {
  const { telegram_id, amount, transaction_hash, wallet_address } = req.body;
  
  console.log('✅ Подтверждение вывода:', { telegram_id, amount, transaction_hash });
  
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

    // Обновляем баланс игрока
    const newBalance = currentBalance - withdrawAmount;
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newBalance, telegram_id]
    );

    // Обновляем запись о выводе
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

    console.log(`✅ Вывод подтвержден для ${telegram_id}: ${withdrawAmount} TON`);

    res.json({
      success: true,
      message: 'Withdrawal confirmed',
      new_balance: newBalance
    });

  } catch (err) {
    console.error('❌ Ошибка подтверждения вывода:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/history/:telegramId - История операций с кошельком
router.get('/history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        id,
        amount,
        status,
        transaction_hash,
        wallet_address,
        created_at,
        completed_at
       FROM withdrawals 
       WHERE player_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [telegramId]
    );

    res.json({
      success: true,
      withdrawals: result.rows
    });

  } catch (err) {
    console.error('❌ Ошибка получения истории:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🌟 TELEGRAM STARS ENDPOINTS

// POST /api/wallet/create-stars-invoice - Создание счета на оплату Stars
router.post('/create-stars-invoice', async (req, res) => {
  const { telegram_id, amount, description } = req.body;
  
  console.log('⭐ Создание счета Stars:', { telegram_id, amount, description });
  
  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  if (amount < 1 || amount > 2500) {
    return res.status(400).json({ error: 'Amount must be between 1 and 2500 stars' });
  }

  try {
    // Проверяем, что игрок существует
    const player = await getPlayer(telegram_id);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    console.log('🤖 Создаем счет через Telegram Bot API...');
    
    // Создаем счет на оплату Stars через Bot API
    const invoice = await bot.telegram.createInvoiceLink({
      title: `CosmoClick: ${amount} Stars`,
      description: description || `Пополнение игрового баланса на ${amount} звезд`,
      payload: JSON.stringify({ 
        type: 'stars_deposit',
        player_id: telegram_id,
        amount: amount,
        timestamp: Date.now()
      }),
      provider_token: '', // Для Stars токен не нужен
      currency: 'XTR', // Специальная валюта для Stars
      prices: [{ label: `${amount} Stars`, amount: amount }]
    });

    console.log(`✅ Создан счет на ${amount} Stars для игрока ${telegram_id}`);
    console.log(`🔗 Invoice URL: ${invoice}`);
    
    res.json({
      success: true,
      invoice_url: invoice,
      amount: amount
    });
    
  } catch (err) {
    console.error('❌ Ошибка создания счета Stars:', err);
    console.error('📊 Детали ошибки:', {
      message: err.message,
      code: err.code,
      response: err.response?.body
    });
    
    // Более детальные ошибки для диагностики
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

// POST /api/wallet/webhook-stars - Webhook для обработки платежей Stars
router.post('/webhook-stars', async (req, res) => {
  console.log('🎯 Stars webhook получен:', JSON.stringify(req.body, null, 2));
  
  const { pre_checkout_query, successful_payment } = req.body;
  
  try {
    // Обработка pre_checkout_query (подтверждение платежа)
    if (pre_checkout_query) {
      console.log('🔍 Pre-checkout query:', pre_checkout_query);
      
      await bot.telegram.answerPreCheckoutQuery(pre_checkout_query.id, true);
      console.log('✅ Pre-checkout подтвержден');
      return res.json({ success: true });
    }
    
    // Обработка successful_payment (успешный платеж)
    if (successful_payment) {
      console.log('💰 Successful payment:', successful_payment);
      
      const payload = JSON.parse(successful_payment.invoice_payload);
      
      if (payload.type === 'stars_deposit') {
        const client = await pool.connect();
        
        try {
          await client.query('BEGIN');
          
          // Добавляем Stars игроку
          await client.query(
            'UPDATE players SET telegram_stars = telegram_stars + $1 WHERE telegram_id = $2',
            [payload.amount, payload.player_id]
          );
          
          // Записываем транзакцию
          await client.query(
            `INSERT INTO star_transactions (
              player_id, amount, transaction_type, description, 
              telegram_payment_id, created_at
            ) VALUES ($1, $2, 'deposit', $3, $4, NOW())`,
            [
              payload.player_id,
              payload.amount,
              `Пополнение ${payload.amount} Stars`,
              successful_payment.telegram_payment_charge_id
            ]
          );
          
          await client.query('COMMIT');
          
          console.log(`✅ Начислено ${payload.amount} Stars игроку ${payload.player_id}`);
          
          // Отправляем уведомление игроку
          try {
            await bot.telegram.sendMessage(
              payload.player_id,
              `🌟 Отлично! Ваш баланс пополнен на ${payload.amount} Stars!\n\n💰 Теперь вы можете использовать их для покупок в игре CosmoClick.`,
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
            console.error('❌ Ошибка отправки уведомления:', msgErr);
            // Не падаем - главное, что Stars начислены
          }
          
        } catch (dbErr) {
          await client.query('ROLLBACK');
          console.error('❌ Ошибка БД при начислении Stars:', dbErr);
          throw dbErr;
        } finally {
          client.release();
        }
      }
      
      return res.json({ success: true });
    }
    
    res.json({ success: true });
    
  } catch (err) {
    console.error('❌ Ошибка обработки Stars webhook:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /api/wallet/stars-history/:telegramId - История транзакций Stars
router.get('/stars-history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        id, amount, transaction_type, description,
        telegram_payment_id, status, created_at
       FROM star_transactions 
       WHERE player_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [telegramId]
    );

    res.json({
      success: true,
      transactions: result.rows
    });

  } catch (err) {
    console.error('❌ Ошибка получения истории Stars:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/process-deposit - Обработка пополнения TON (для будущего webhook'а)
router.post('/process-deposit', async (req, res) => {
  const { player_id, amount, transaction_hash } = req.body;
  
  console.log('💰 Обработка пополнения TON:', { player_id, amount, transaction_hash });
  
  if (!player_id || !amount || !transaction_hash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем, что транзакция не была уже обработана
    const existingTx = await client.query(
      'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
      [transaction_hash]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Transaction already processed' });
    }

    // Добавляем TON к балансу игрока
    const depositAmount = parseFloat(amount);
    await client.query(
      'UPDATE players SET ton = ton + $1 WHERE telegram_id = $2',
      [depositAmount, player_id]
    );

    // Записываем транзакцию пополнения
    await client.query(
      `INSERT INTO ton_deposits (
        player_id, amount, transaction_hash, status, created_at
      ) VALUES ($1, $2, $3, 'completed', NOW())`,
      [player_id, depositAmount, transaction_hash]
    );

    await client.query('COMMIT');

    console.log(`✅ Пополнение обработано: ${player_id} +${depositAmount} TON`);

    res.json({
      success: true,
      message: 'Deposit processed successfully',
      amount: depositAmount
    });

  } catch (err) {
    console.error('❌ Ошибка обработки пополнения:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;