// routes/wallet.js - ПОЛНАЯ ВЕРСИЯ С НОВЫМ ENDPOINT ДЛЯ ПРОВЕРКИ ДЕПОЗИТОВ
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const router = express.Router();

// Получаем экземпляр бота ПРАВИЛЬНО
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ===== ДОБАВИТЬ В НАЧАЛО routes/wallet.js =====
const { notifyStarsDeposit, notifyTonDeposit, notifyWithdrawalRequest } = require('./telegramBot');

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

// 🔥 НОВЫЙ ENDPOINT: Проверка конкретного депозита
router.post('/check-deposit', async (req, res) => {
  const { player_id, expected_amount, wallet_address } = req.body;
  
  console.log('🔍 Проверка депозита:', { player_id, expected_amount, wallet_address });
  
  if (!player_id || !expected_amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const gameWallet = process.env.GAME_WALLET_ADDRESS || wallet_address;
    
    // Получаем последние транзакции из блокчейна TON
    const response = await axios.get('https://toncenter.com/api/v2/getTransactions', {
      params: {
        address: gameWallet,
        limit: 20, // проверяем последние 20 транзакций
        archival: false
      },
      timeout: 10000
    });

    if (!response.data.ok) {
      console.log('❌ Ошибка API TON Center');
      return res.json({ success: false, error: 'TON API error' });
    }

    const transactions = response.data.result;
    console.log(`📊 Получено транзакций: ${transactions.length}`);
    
    let foundDeposit = null;
    
    for (const tx of transactions) {
      // Пропускаем исходящие транзакции
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') continue;

      const amount = parseFloat(tx.in_msg.value) / 1000000000; // конвертируем в TON
      const hash = tx.transaction_id.hash;
      
      console.log(`💰 Транзакция: ${amount} TON, комментарий: "${tx.in_msg.message || 'нет'}"`);

      // Проверяем сумму (с погрешностью 0.001)
      if (Math.abs(amount - expected_amount) > 0.001) continue;

      // Извлекаем telegram_id из комментария
      let commentPlayerId = null;
      if (tx.in_msg.message) {
        const match = tx.in_msg.message.match(/(\d{8,12})/);
        if (match) {
          commentPlayerId = match[1];
        }
      }

      // Проверяем что это наш игрок
      if (commentPlayerId !== player_id) continue;

      // Проверяем, не обрабатывали ли уже эту транзакцию
      const existingTx = await pool.query(
        'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
        [hash]
      );

      if (existingTx.rows.length > 0) {
        console.log('✅ Депозит уже был обработан ранее');
        return res.json({ success: true, message: 'Deposit already processed' });
      }

      foundDeposit = {
        amount: amount,
        hash: hash,
        player_id: commentPlayerId
      };
      break;
    }

    if (!foundDeposit) {
      console.log('❌ Депозит не найден в блокчейне');
      return res.json({ success: false, message: 'Deposit not found yet' });
    }

    // Обрабатываем найденный депозит
    console.log(`✅ Найден депозит: ${foundDeposit.amount} TON для игрока ${foundDeposit.player_id}`);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Получаем данные игрока для уведомления
      const playerResult = await client.query(
        'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
        [foundDeposit.player_id]
      );

      if (playerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.json({ success: false, error: 'Player not found' });
      }

      const playerData = playerResult.rows[0];
      const currentBalance = parseFloat(playerData.ton || '0');
      const newBalance = currentBalance + foundDeposit.amount;

      // Обновляем баланс игрока
      await client.query(
        'UPDATE players SET ton = $1 WHERE telegram_id = $2',
        [newBalance, foundDeposit.player_id]
      );

      // Записываем транзакцию депозита
      await client.query(
        `INSERT INTO ton_deposits (
          player_id, amount, transaction_hash, status, created_at
        ) VALUES ($1, $2, $3, 'completed', NOW())`,
        [foundDeposit.player_id, foundDeposit.amount, foundDeposit.hash]
      );

      // Записываем в историю баланса
      await client.query(
        `INSERT INTO balance_history (
          telegram_id, currency, old_balance, new_balance, 
          change_amount, reason, details, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          foundDeposit.player_id,
          'ton',
          currentBalance,
          newBalance,
          foundDeposit.amount,
          'auto_deposit_check',
          JSON.stringify({
            transaction_hash: foundDeposit.hash,
            auto_processed: true,
            check_triggered: true
          })
        ]
      );

      await client.query('COMMIT');

      console.log(`✅ Депозит успешно обработан: ${foundDeposit.player_id} +${foundDeposit.amount} TON`);
      console.log(`💰 Баланс обновлен: ${currentBalance} → ${newBalance}`);

      // Отправляем уведомление игроку
      try {
        await notifyTonDeposit(playerData, foundDeposit.amount, foundDeposit.hash);
      } catch (notifyErr) {
        console.error('❌ Ошибка отправки уведомления:', notifyErr);
      }

      res.json({
        success: true,
        message: 'Deposit processed successfully',
        amount: foundDeposit.amount,
        new_balance: newBalance
      });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Ошибка обработки депозита:', err);
      throw err;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Ошибка проверки депозита:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ДОБАВЬТЕ ЭТОТ ENDPOINT в ваш wallet.js после существующего /check-deposit

// POST /api/wallet/check-deposit-by-address - Проверка депозита по адресу отправителя
router.post('/check-deposit-by-address', async (req, res) => {
  const { player_id, expected_amount, sender_address, game_wallet } = req.body;
  
  console.log('🔍 Проверка депозита по адресу:', { 
    player_id, 
    expected_amount, 
    sender_address, 
    game_wallet 
  });
  
  if (!player_id || !expected_amount || !sender_address) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const gameWalletAddress = game_wallet || process.env.GAME_WALLET_ADDRESS;
    
    // Получаем последние транзакции игрового кошелька
    const response = await axios.get('https://toncenter.com/api/v2/getTransactions', {
      params: {
        address: gameWalletAddress,
        limit: 50, // больше транзакций для поиска
        archival: false
      },
      timeout: 10000
    });

    if (!response.data.ok) {
      console.log('❌ Ошибка TON API');
      return res.json({ success: false, error: 'TON API error' });
    }

    const transactions = response.data.result;
    console.log(`📊 Получено транзакций для анализа: ${transactions.length}`);
    
    let foundDeposit = null;
    
    for (const tx of transactions) {
      // Пропускаем исходящие транзакции
      if (!tx.in_msg || !tx.in_msg.value || tx.in_msg.value === '0') continue;

      const amount = parseFloat(tx.in_msg.value) / 1000000000;
      const hash = tx.transaction_id.hash;
      const fromAddress = tx.in_msg.source;
      
      console.log(`💰 Анализируем: ${amount} TON от ${fromAddress}`);

      // Проверяем сумму (с погрешностью 0.001)
      if (Math.abs(amount - expected_amount) > 0.001) {
        console.log(`   ❌ Сумма не совпадает: ожидали ${expected_amount}, получили ${amount}`);
        continue;
      }

      // Проверяем адрес отправителя
      if (fromAddress !== sender_address) {
        console.log(`   ❌ Адрес не совпадает: ожидали ${sender_address}, получили ${fromAddress}`);
        continue;
      }

      // Проверяем, не обрабатывали ли уже
      const existingTx = await pool.query(
        'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
        [hash]
      );

      if (existingTx.rows.length > 0) {
        console.log('   ✅ Депозит уже был обработан ранее');
        return res.json({ success: true, message: 'Deposit already processed' });
      }

      foundDeposit = {
        amount: amount,
        hash: hash,
        from_address: fromAddress,
        player_id: player_id
      };
      
      console.log(`   ✅ НАЙДЕН ПОДХОДЯЩИЙ ДЕПОЗИТ!`);
      break;
    }

    if (!foundDeposit) {
      console.log('❌ Подходящий депозит не найден');
      return res.json({ success: false, message: 'Deposit not found yet' });
    }

    // Обрабатываем найденный депозит
    console.log(`💰 Обрабатываем депозит: ${foundDeposit.amount} TON для игрока ${foundDeposit.player_id}`);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Получаем данные игрока
      const playerResult = await client.query(
        'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
        [foundDeposit.player_id]
      );

      if (playerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.json({ success: false, error: 'Player not found' });
      }

      const playerData = playerResult.rows[0];
      const currentBalance = parseFloat(playerData.ton || '0');
      const newBalance = currentBalance + foundDeposit.amount;

      // Обновляем баланс игрока
      await client.query(
        'UPDATE players SET ton = $1 WHERE telegram_id = $2',
        [newBalance, foundDeposit.player_id]
      );

      // Записываем транзакцию
      await client.query(
        `INSERT INTO ton_deposits (
          player_id, amount, transaction_hash, status, created_at
        ) VALUES ($1, $2, $3, 'completed', NOW())`,
        [foundDeposit.player_id, foundDeposit.amount, foundDeposit.hash]
      );

      // Записываем в историю баланса
      await client.query(
        `INSERT INTO balance_history (
          telegram_id, currency, old_balance, new_balance, 
          change_amount, reason, details, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          foundDeposit.player_id,
          'ton',
          currentBalance,
          newBalance,
          foundDeposit.amount,
          'auto_deposit_by_address',
          JSON.stringify({
            transaction_hash: foundDeposit.hash,
            from_address: foundDeposit.from_address,
            auto_processed: true
          })
        ]
      );

      await client.query('COMMIT');

      console.log(`✅ Депозит зачислен: ${foundDeposit.player_id} +${foundDeposit.amount} TON`);
      console.log(`💰 Новый баланс: ${currentBalance} → ${newBalance}`);

      // Уведомляем игрока
      try {
        await notifyTonDeposit(playerData, foundDeposit.amount, foundDeposit.hash);
      } catch (notifyErr) {
        console.error('❌ Ошибка уведомления:', notifyErr);
      }

      res.json({
        success: true,
        message: 'Deposit processed successfully',
        amount: foundDeposit.amount,
        new_balance: newBalance
      });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Ошибка обработки депозита:', err);
      throw err;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Ошибка проверки депозита по адресу:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/wallet/prepare-withdrawal - ОБНОВИТЬ prepare-withdrawal ФУНКЦИЯ
router.post('/prepare-withdrawal', async (req, res) => {
  const { telegram_id, amount } = req.body;
  
  console.log('💸 Подготовка вывода:', { telegram_id, amount });
  
  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Получаем данные игрока
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

    // Создаем заявку на вывод
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (
        player_id, amount, status, created_at
      ) VALUES ($1, $2, 'pending', NOW()) 
      RETURNING id`,
      [telegram_id, withdrawAmount]
    );

    const withdrawalId = withdrawalResult.rows[0].id;

    await client.query('COMMIT');

    console.log(`✅ Заявка на вывод создана: ${withdrawalId}`);

    // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ АДМИНУ О ЗАЯВКЕ НА ВЫВОД
    await notifyWithdrawalRequest(player, withdrawAmount, withdrawalId);

    res.json({
      success: true,
      withdrawal_id: withdrawalId,
      amount: withdrawAmount,
      message: 'Заявка на вывод создана и отправлена администратору'
    });

  } catch (err) {
    console.error('❌ Ошибка подготовки вывода:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ===== ДОБАВИТЬ process-deposit ФУНКЦИЯ С УВЕДОМЛЕНИЕМ =====
router.post('/process-deposit', async (req, res) => {
  const { player_id, amount, transaction_hash } = req.body;
  
  console.log('💰 Обработка пополнения TON:', { player_id, amount, transaction_hash });
  
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

    // Получаем данные игрока ДЛЯ УВЕДОМЛЕНИЯ
    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username FROM players WHERE telegram_id = $1',
      [player_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerData = playerResult.rows[0];
    const depositAmount = parseFloat(amount);

    // Добавляем TON к балансу игрока
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

    // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ АДМИНУ О ПОПОЛНЕНИИ TON
    await notifyTonDeposit(playerData, depositAmount, transaction_hash);

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

// routes/wallet.js - ИСПРАВЛЕННАЯ ВЕРСИЯ - ЧАСТЬ 2

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
// ===== ЗАМЕНИТЬ webhook-stars ФУНКЦИЯ =====
router.post('/webhook-stars', async (req, res) => {
  console.log('🎯 Stars webhook получен:', JSON.stringify(req.body, null, 2));
  
  const { pre_checkout_query, message } = req.body;
  
  try {
    // Обработка pre_checkout_query
    if (pre_checkout_query) {
      await bot.telegram.answerPreCheckoutQuery(pre_checkout_query.id, true);
      console.log('✅ Pre-checkout подтвержден');
      return res.json({ success: true });
    }
    
    // 🔥 ОБРАБОТКА УСПЕШНОГО ПЛАТЕЖА С УВЕДОМЛЕНИЕМ
    if (message && message.successful_payment) {
      const payment = message.successful_payment;
      const payload = JSON.parse(payment.invoice_payload);
      const playerId = payload.player_id;
      const amount = payment.total_amount;
      
      console.log(`💰 Обрабатываем платеж: ${amount} Stars для игрока ${playerId}`);
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Проверяем дублирование
        const existingTx = await client.query(
          'SELECT id FROM star_transactions WHERE telegram_payment_id = $1',
          [payment.telegram_payment_charge_id]
        );
        
        if (existingTx.rows.length > 0) {
          console.log('⚠️ Транзакция уже была обработана');
          await client.query('ROLLBACK');
          return res.json({ success: true, message: 'Already processed' });
        }
        
        // Получаем данные игрока ДЛЯ УВЕДОМЛЕНИЯ
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
        
        console.log(`✅ Начислено ${amount} Stars игроку ${playerId}`);
        
        // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ АДМИНУ
        await notifyStarsDeposit(playerData, amount);
        
        // Уведомляем игрока
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
          console.error('❌ Ошибка уведомления игрока:', msgErr);
        }
        
      } catch (dbErr) {
        console.error('❌ Ошибка БД при обработке Stars:', dbErr);
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }
      
      return res.json({ success: true });
    }
    
    // Обработка обычных сообщений
    if (message && !message.successful_payment) {
      console.log('📨 Обычное сообщение бота:', message.text || 'unknown');
      const messageBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      messageBot.start((ctx) => ctx.reply('Привет! Бот запущен и готов к работе.'));
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

// routes/wallet.js - ИСПРАВЛЕННАЯ ВЕРСИЯ - ЧАСТЬ 3 (ПРЕМИУМ с unified verification)

// ========================
// 🏆 ПРЕМИУМ ПОДПИСКИ - ИСПРАВЛЕННАЯ ВЕРСИЯ
// ========================

// GET /api/wallet/premium-status/:telegramId - Проверка премиум статуса (УБРАЛИ ДУБЛЬ)
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
      verified: player.verified || false // 🔥 ДОБАВИЛИ verified статус
    };

    // Проверяем навсегда
    if (player.premium_no_ads_forever) {
      premiumStatus = {
        active: true,
        forever: true,
        until: null,
        verified: player.verified || false
      };
    }
    // Проверяем временную подписку
    else if (player.premium_no_ads_until && new Date(player.premium_no_ads_until) > now) {
      premiumStatus = {
        active: true,
        forever: false,
        until: player.premium_no_ads_until,
        verified: player.verified || false
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

// POST /api/wallet/purchase-premium - ИСПРАВЛЕННАЯ покупка премиума с unified verification
router.post('/purchase-premium', async (req, res) => {
  const { telegram_id, package_type, payment_method, payment_amount } = req.body;
  
  console.log('🏆 Покупка премиума:', { telegram_id, package_type, payment_method, payment_amount });
  
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

    // 🔥 ГЛАВНОЕ ИЗМЕНЕНИЕ: Обновляем премиум статус + VERIFIED
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
          purchase_timestamp: new Date().toISOString(),
          verified_granted: true // 🔥 ОТМЕЧЕМ что verified был выдан
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
          subscription_id: subscriptionResult.rows[0].id,
          verified_granted: true // 🔥 ОТМЕЧЕМ что verified был выдан
        })
      ]
    );

    await client.query('COMMIT');

    const successMessage = package_type === 'no_ads_forever' 
      ? 'Поздравляем! Реклама отключена НАВСЕГДА! 🏆' 
      : 'Поздравляем! Реклама отключена на 30 дней! 🎉';

    console.log(`✅ Премиум куплен для ${telegram_id}: ${package_type} за ${payment_amount} ${payment_method} + verified = true`);

    res.json({
      success: true,
      message: successMessage,
      subscription_id: subscriptionResult.rows[0].id,
      verified_granted: true // 🔥 ВОЗВРАЩЕМ информацию о verified
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
      console.error('❌ Ошибка отправки уведомления о премиуме:', msgErr);
      // НЕ падаем - главное, что премиум активирован
    }

  } catch (err) {
    console.error('❌ Ошибка покупки премиума:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/premium-history/:telegramId - История премиум транзакций (УБРАЛИ ДУБЛЬ)
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

// POST /api/wallet/cleanup-expired-premium - ИСПРАВЛЕННАЯ очистка истекших подписок
router.post('/cleanup-expired-premium', async (req, res) => {
  try {
    console.log('🧹 Начинаем очистку истекших премиум подписок...');

    // Обновляем статус истекших подписок в таблице premium_subscriptions
    const expiredSubscriptions = await pool.query(
      `UPDATE premium_subscriptions 
       SET status = 'expired' 
       WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND end_date < NOW()
       RETURNING telegram_id`
    );

    // 🔥 ГЛАВНОЕ ИЗМЕНЕНИЕ: Очищаем премиум поля И СБРАСЫВАЕМ VERIFIED
    const cleanedPlayers = await pool.query(
      `UPDATE players 
       SET premium_no_ads_until = NULL,
           verified = FALSE
       WHERE premium_no_ads_until IS NOT NULL 
         AND premium_no_ads_until < NOW()
         AND premium_no_ads_forever = FALSE
       RETURNING telegram_id, first_name, username`
    );

    console.log('📊 === РЕЗУЛЬТАТЫ UNIFIED ОЧИСТКИ ===');
    console.log(`✅ Истекших подписок обновлено: ${expiredSubscriptions.rows.length}`);
    console.log(`✅ Игроков очищено: ${cleanedPlayers.rows.length}`);
    console.log(`✅ Verified статус сброшен у: ${cleanedPlayers.rows.length} игроков`);
    console.log('🏁 UNIFIED очистка истекших премиум подписок завершена успешно');

    res.json({
      success: true,
      message: 'Expired premium subscriptions and verification status cleaned up',
      expired_subscriptions: expiredSubscriptions.rows.length,
      cleaned_players: cleanedPlayers.rows.length,
      affected_players: cleanedPlayers.rows.map(p => p.telegram_id)
    });

  } catch (err) {
    console.error('❌ Ошибка очистки истекших подписок:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;