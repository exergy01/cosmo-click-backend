const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { Telegraf } = require('telegraf');
const { notifyStarsDeposit } = require('../telegramBot');

const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// POST /create-invoice - Создание счета Stars
router.post('/create-invoice', async (req, res) => {
  const { telegram_id, amount, description } = req.body;
  
  console.log('Creating Stars invoice:', { telegram_id, amount });
  
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
      description: description || `Game balance top-up for ${amount} stars`,
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

    console.log('Stars invoice created:', { telegram_id, amount, invoice });
    
    res.json({
      success: true,
      invoice_url: invoice,
      amount: amount
    });
    
  } catch (err) {
    console.error('Stars invoice creation error:', err);
    
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

// POST /webhook - Webhook для обработки Stars платежей
router.post('/webhook', async (req, res) => {
  console.log('Stars webhook received:', req.body);
  
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
        
        // Проверяем дублирование
        const existingTx = await client.query(
          'SELECT id FROM star_transactions WHERE telegram_payment_id = $1',
          [payment.telegram_payment_charge_id]
        );
        
        if (existingTx.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.json({ success: true, message: 'Already processed' });
        }
        
        // Получаем данные игрока
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
        
        console.log('Stars payment processed:', { playerId, amount });
        
        // Отправляем уведомления
        await notifyStarsDeposit(playerData, amount);
        
        try {
          await bot.telegram.sendMessage(
            playerId,
            `🎉 Congratulations! Your balance has been topped up by ${amount} ⭐ Stars!`,
            {
              reply_markup: {
                inline_keyboard: [[{
                  text: '🎮 Open Game',
                  web_app: { url: 'https://cosmoclick-frontend.vercel.app' }
                }]]
              }
            }
          );
        } catch (msgErr) {
          console.error('Player notification error:', msgErr);
        }
        
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error('Database error in Stars processing:', dbErr);
        throw dbErr;
      } finally {
        client.release();
      }
      
      return res.json({ success: true });
    }
    
    // Handle other message types
    if (message && !message.successful_payment) {
      const messageBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      messageBot.start((ctx) => ctx.reply('Hello! Bot is running and ready to work.'));
      await messageBot.handleUpdate(req.body);
      return res.json({ success: true });
    }
    
    res.json({ success: true });
    
  } catch (err) {
    console.error('Stars webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;