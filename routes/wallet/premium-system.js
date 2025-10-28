const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { Telegraf } = require('telegraf');

const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// GET /status/:telegramId - Проверка премиум статуса
router.get('/status/:telegramId', async (req, res) => {
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
    console.error('Premium status check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /purchase - Покупка премиума
router.post('/purchase', async (req, res) => {
  const { telegram_id, package_type, payment_method, payment_amount } = req.body;
  
  if (process.env.NODE_ENV === 'development') console.log('Premium purchase request:', { telegram_id, package_type, payment_method, payment_amount });
  
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

    // Проверяем достаточность средств
    if (payment_method === 'stars') {
      const currentStars = parseInt(player.telegram_stars || '0');
      if (currentStars < payment_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Insufficient Stars! You have: ${currentStars}, need: ${payment_amount}` 
        });
      }
    } else if (payment_method === 'ton') {
      const currentTON = parseFloat(player.ton || '0');
      if (currentTON < payment_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Insufficient TON! You have: ${currentTON.toFixed(4)}, need: ${payment_amount}` 
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

    if (process.env.NODE_ENV === 'development') console.log('Premium purchased successfully:', { telegram_id, package_type, payment_method });

    const successMessage = package_type === 'no_ads_forever' 
      ? 'Congratulations! Ads disabled FOREVER!' 
      : 'Congratulations! Ads disabled for 30 days!';

    res.json({
      success: true,
      message: successMessage,
      subscription_id: subscriptionResult.rows[0].id,
      verified_granted: true
    });

    // Отправляем уведомление игроку
    try {
      const notificationMessage = package_type === 'no_ads_forever'
        ? `🎉 Congratulations! You purchased premium subscription!\n\n🏆 Ads disabled FOREVER!\n✅ Your account is now verified!\n\nNow you can enjoy CosmoClick without distracting ads.`
        : `🎉 Congratulations! You purchased premium subscription!\n\n🚫 Ads disabled for 30 days!\n✅ Your account is now verified!\n\nNow you can enjoy CosmoClick without distracting ads.`;

      await bot.telegram.sendMessage(
        telegram_id,
        notificationMessage,
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
      console.error('Premium notification error:', msgErr);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Premium purchase error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;