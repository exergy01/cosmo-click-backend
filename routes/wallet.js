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

  if (amount < 100 || amount > 150000) {
    return res.status(400).json({ error: 'Amount must be between 100 and 150000 stars' });
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

// POST /api/wallet/webhook-stars - ИСПРАВЛЕННАЯ ВЕРСИЯ
router.post('/webhook-stars', async (req, res) => {
  console.log('🎯 Stars webhook получен:', JSON.stringify(req.body, null, 2));
  
  const { pre_checkout_query, successful_payment, message } = req.body;
  
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
      // ... твой существующий код для начисления Stars
      return res.json({ success: true });
    }
    
    // ⚠️ ДОБАВИТЬ: Если это обычное сообщение - передаем боту
    if (message && !message.successful_payment) {
      console.log('📨 Обычное сообщение бота, передаем Telegraf:', message.text || 'unknown');
      
      // Создаем экземпляр бота для обработки обычных сообщений
      const { Telegraf } = require('telegraf');
      const messageBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      
      // Настраиваем команды
      messageBot.start((ctx) => {
        ctx.reply('Привет! Бот запущен и готов к работе. Запускай игру через Web App!');
      });
      
      messageBot.help((ctx) => {
        ctx.reply('Я бот для CosmoClick Game.');
      });
      
      // Обрабатываем сообщение
      await messageBot.handleUpdate(req.body);
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

// ДОБАВИТЬ В routes/wallet.js - ПРЕМИУМ ЭНДПОИНТЫ

// GET /api/wallet/premium-status/:telegramId - Проверка премиум статуса
router.get('/premium-status/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        premium_no_ads_until,
        premium_no_ads_forever
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
      until: null
    };

    // Проверяем навсегда
    if (player.premium_no_ads_forever) {
      premiumStatus = {
        active: true,
        forever: true,
        until: null
      };
    }
    // Проверяем временную подписку
    else if (player.premium_no_ads_until && new Date(player.premium_no_ads_until) > now) {
      premiumStatus = {
        active: true,
        forever: false,
        until: player.premium_no_ads_until
      };
    }

    console.log(`✅ Премиум статус для ${telegramId}:`, premiumStatus);

    res.json({
      success: true,
      premium: premiumStatus
    });

  } catch (err) {
    console.error('❌ Ошибка проверки премиум статуса:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/purchase-premium - Покупка премиума
router.post('/purchase-premium', async (req, res) => {
  const { telegram_id, package_type, payment_method, payment_amount } = req.body;
  
  console.log('👑 Покупка премиума:', { telegram_id, package_type, payment_method, payment_amount });
  
  if (!telegram_id || !package_type || !payment_method || !payment_amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Валидация пакета
  const validPackages = ['no_ads_30_days', 'no_ads_forever'];
  if (!validPackages.includes(package_type)) {
    return res.status(400).json({ error: 'Invalid package type' });
  }

  // Валидация метода оплаты
  const validPaymentMethods = ['stars', 'ton'];
  if (!validPaymentMethods.includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Валидация цен
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

    // Получаем игрока
    const playerResult = await client.query(
      'SELECT telegram_id, telegram_stars, ton FROM players WHERE telegram_id = $1',
      [telegram_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Проверяем баланс
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

    // Обновляем премиум статус
    if (package_type === 'no_ads_forever') {
      await client.query(
        `UPDATE players SET 
         premium_no_ads_forever = TRUE,
         premium_no_ads_until = NULL
         WHERE telegram_id = $1`,
        [telegram_id]
      );
    } else if (package_type === 'no_ads_30_days') {
      await client.query(
        `UPDATE players SET 
         premium_no_ads_until = GREATEST(
           COALESCE(premium_no_ads_until, NOW()),
           NOW() + INTERVAL '30 days'
         )
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

    // Записываем транзакцию
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        telegram_id,
        'purchase',
        package_type,
        payment_method,
        payment_amount,
        payment_method,
        `Premium subscription purchase: ${package_type}`,
        JSON.stringify({
          subscription_id: subscriptionResult.rows[0].id,
          purchase_timestamp: new Date().toISOString()
        })
      ]
    );

    // Записываем в историю баланса
    await client.query(
      `INSERT INTO balance_history (
        telegram_id,
        currency,
        old_balance,
        new_balance,
        change_amount,
        reason,
        details,
        timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        telegram_id,
        payment_method,
        payment_method === 'stars' ? parseInt(player.telegram_stars || '0') : parseFloat(player.ton || '0'),
        payment_method === 'stars' 
          ? parseInt(player.telegram_stars || '0') - payment_amount
          : parseFloat(player.ton || '0') - payment_amount,
        -payment_amount,
        'premium_purchase',
        JSON.stringify({
          package_type,
          subscription_id: subscriptionResult.rows[0].id
        })
      ]
    );

    await client.query('COMMIT');

    const successMessage = package_type === 'no_ads_forever' 
      ? 'Поздравляем! Реклама отключена НАВСЕГДА! 👑' 
      : 'Поздравляем! Реклама отключена на 30 дней! 🎉';

    console.log(`✅ Премиум куплен для ${telegram_id}: ${package_type} за ${payment_amount} ${payment_method}`);

    res.json({
      success: true,
      message: successMessage,
      subscription_id: subscriptionResult.rows[0].id
    });

    // Отправляем уведомление игроку
    try {
      const notificationMessage = package_type === 'no_ads_forever'
        ? `🎉 Поздравляем! Вы приобрели премиум подписку!\n\n👑 Реклама отключена НАВСЕГДА!\n\nТеперь вы можете наслаждаться игрой CosmoClick без отвлекающей рекламы.`
        : `🎉 Поздравляем! Вы приобрели премиум подписку!\n\n🚫 Реклама отключена на 30 дней!\n\nТеперь вы можете наслаждаться игрой CosmoClick без отвлекающей рекламы.`;

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
      console.error('❌ Ошибка отправки уведомления о премиуме:', msgErr);
      // Не падаем - главное, что премиум активирован
    }

  } catch (err) {
    console.error('❌ Ошибка покупки премиума:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/premium-history/:telegramId - История премиум транзакций
router.get('/premium-history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        status,
        created_at
       FROM premium_transactions 
       WHERE telegram_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [telegramId]
    );

    res.json({
      success: true,
      transactions: result.rows
    });

  } catch (err) {
    console.error('❌ Ошибка получения истории премиум:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/check-premium - Проверка премиум статуса (для фронтенда)
router.post('/check-premium', async (req, res) => {
  const { telegram_id } = req.body;
  
  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  try {
    const result = await pool.query(
      `SELECT check_premium_no_ads($1) as has_premium`,
      [telegram_id]
    );

    const hasPremium = result.rows[0].has_premium;

    res.json({
      success: true,
      has_premium: hasPremium
    });

  } catch (err) {
    console.error('❌ Ошибка проверки премиум функцией:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/cleanup-expired-premium - Очистка истекших подписок (для cron)
router.post('/cleanup-expired-premium', async (req, res) => {
  try {
    // Обновляем статус истекших подписок
    await pool.query(
      `UPDATE premium_subscriptions 
       SET status = 'expired' 
       WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND end_date < NOW()`
    );

    // Очищаем премиум статус у игроков с истекшими подписками
    await pool.query(
      `UPDATE players 
       SET premium_no_ads_until = NULL 
       WHERE premium_no_ads_until IS NOT NULL 
         AND premium_no_ads_until < NOW()
         AND premium_no_ads_forever = FALSE`
    );

    console.log('✅ Очистка истекших премиум подписок выполнена');

    res.json({
      success: true,
      message: 'Expired premium subscriptions cleaned up'
    });

  } catch (err) {
    console.error('❌ Ошибка очистки истекших подписок:', err);
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

// ДОБАВИТЬ В КОНЕЦ routes/wallet.js (перед module.exports = router;)

// ========================
// 👑 ПРЕМИУМ ПОДПИСКИ
// ========================

// GET /api/wallet/premium-status/:telegramId - Проверка премиум статуса
router.get('/premium-status/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        premium_no_ads_until,
        premium_no_ads_forever
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
      until: null
    };

    // Проверяем навсегда
    if (player.premium_no_ads_forever) {
      premiumStatus = {
        active: true,
        forever: true,
        until: null
      };
    }
    // Проверяем временную подписку
    else if (player.premium_no_ads_until && new Date(player.premium_no_ads_until) > now) {
      premiumStatus = {
        active: true,
        forever: false,
        until: player.premium_no_ads_until
      };
    }

    console.log(`✅ Премиум статус для ${telegramId}:`, premiumStatus);

    res.json({
      success: true,
      premium: premiumStatus
    });

  } catch (err) {
    console.error('❌ Ошибка проверки премиум статуса:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/purchase-premium - Покупка премиума
router.post('/purchase-premium', async (req, res) => {
  const { telegram_id, package_type, payment_method, payment_amount } = req.body;
  
  console.log('👑 Покупка премиума:', { telegram_id, package_type, payment_method, payment_amount });
  
  if (!telegram_id || !package_type || !payment_method || !payment_amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Валидация пакета
  const validPackages = ['no_ads_30_days', 'no_ads_forever'];
  if (!validPackages.includes(package_type)) {
    return res.status(400).json({ error: 'Invalid package type' });
  }

  // Валидация метода оплаты
  const validPaymentMethods = ['stars', 'ton'];
  if (!validPaymentMethods.includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Валидация цен
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

    // Получаем игрока
    const playerResult = await client.query(
      'SELECT telegram_id, telegram_stars, ton FROM players WHERE telegram_id = $1',
      [telegram_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Проверяем баланс
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

    // Обновляем премиум статус
    if (package_type === 'no_ads_forever') {
      await client.query(
        `UPDATE players SET 
         premium_no_ads_forever = TRUE,
         premium_no_ads_until = NULL
         WHERE telegram_id = $1`,
        [telegram_id]
      );
    } else if (package_type === 'no_ads_30_days') {
      await client.query(
        `UPDATE players SET 
         premium_no_ads_until = GREATEST(
           COALESCE(premium_no_ads_until, NOW()),
           NOW() + INTERVAL '30 days'
         )
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

    // Записываем транзакцию
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        telegram_id,
        'purchase',
        package_type,
        payment_method,
        payment_amount,
        payment_method,
        `Premium subscription purchase: ${package_type}`,
        JSON.stringify({
          subscription_id: subscriptionResult.rows[0].id,
          purchase_timestamp: new Date().toISOString()
        })
      ]
    );

    // Записываем в историю баланса
    await client.query(
      `INSERT INTO balance_history (
        telegram_id,
        currency,
        old_balance,
        new_balance,
        change_amount,
        reason,
        details,
        timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        telegram_id,
        payment_method,
        payment_method === 'stars' ? parseInt(player.telegram_stars || '0') : parseFloat(player.ton || '0'),
        payment_method === 'stars' 
          ? parseInt(player.telegram_stars || '0') - payment_amount
          : parseFloat(player.ton || '0') - payment_amount,
        -payment_amount,
        'premium_purchase',
        JSON.stringify({
          package_type,
          subscription_id: subscriptionResult.rows[0].id
        })
      ]
    );

    await client.query('COMMIT');

    const successMessage = package_type === 'no_ads_forever' 
      ? 'Поздравляем! Реклама отключена НАВСЕГДА! 👑' 
      : 'Поздравляем! Реклама отключена на 30 дней! 🎉';

    console.log(`✅ Премиум куплен для ${telegram_id}: ${package_type} за ${payment_amount} ${payment_method}`);

    res.json({
      success: true,
      message: successMessage,
      subscription_id: subscriptionResult.rows[0].id
    });

    // Отправляем уведомление игроку
    try {
      const notificationMessage = package_type === 'no_ads_forever'
        ? `🎉 Поздравляем! Вы приобрели премиум подписку!\n\n👑 Реклама отключена НАВСЕГДА!\n\nТеперь вы можете наслаждаться игрой CosmoClick без отвлекающей рекламы.`
        : `🎉 Поздравляем! Вы приобрели премиум подписку!\n\n🚫 Реклама отключена на 30 дней!\n\nТеперь вы можете наслаждаться игрой CosmoClick без отвлекающей рекламы.`;

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
      console.error('❌ Ошибка отправки уведомления о премиуме:', msgErr);
    }

  } catch (err) {
    console.error('❌ Ошибка покупки премиума:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/premium-history/:telegramId - История премиум транзакций
router.get('/premium-history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        status,
        created_at
       FROM premium_transactions 
       WHERE telegram_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [telegramId]
    );

    res.json({
      success: true,
      transactions: result.rows
    });

  } catch (err) {
    console.error('❌ Ошибка получения истории премиум:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;