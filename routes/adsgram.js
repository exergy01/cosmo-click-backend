// routes/adsgram.js - ЗАМЕНИТЬ ВЕСЬ ФАЙЛ

const express = require('express');
const router = express.Router();
const pool = require('../db');

// Функция проверки премиум статуса
const checkPremiumStatus = async (telegramId) => {
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
      return { hasPremium: false, reason: 'Player not found' };
    }

    const player = result.rows[0];
    const now = new Date();
    
    // Проверяем навсегда
    if (player.premium_no_ads_forever) {
      return { 
        hasPremium: true, 
        type: 'forever',
        reason: 'Premium forever subscription' 
      };
    }
    
    // Проверяем временную подписку
    if (player.premium_no_ads_until && new Date(player.premium_no_ads_until) > now) {
      const daysLeft = Math.ceil((new Date(player.premium_no_ads_until) - now) / (1000 * 60 * 60 * 24));
      return { 
        hasPremium: true, 
        type: 'temporary',
        daysLeft: daysLeft,
        reason: `Premium subscription active for ${daysLeft} more days` 
      };
    }
    
    return { 
      hasPremium: false, 
      reason: 'No active premium subscription' 
    };
    
  } catch (err) {
    console.error('❌ Ошибка проверки премиум статуса:', err);
    return { 
      hasPremium: false, 
      reason: 'Error checking premium status' 
    };
  }
};

// Reward endpoint - с проверкой премиума
router.get('/reward', async (req, res) => {
  try {
    const { userid } = req.query;
    
    if (process.env.NODE_ENV === 'development') console.log('🎯 Adsgram reward received for user:', userid);

    if (!userid) {
      console.error('🎯❌ No userid provided');
      return res.status(400).json({
        success: false,
        error: 'No userid provided'
      });
    }

    // 👑 ПРОВЕРЯЕМ ПРЕМИУМ СТАТУС ПЕРЕД ОБРАБОТКОЙ РЕКЛАМЫ
    const premiumStatus = await checkPremiumStatus(userid);
    if (process.env.NODE_ENV === 'development') console.log(`👑 Premium status for ${userid}:`, premiumStatus);

    if (premiumStatus.hasPremium) {
      if (process.env.NODE_ENV === 'development') console.log(`👑 User ${userid} has premium - skipping ad reward processing`);
      return res.json({
        success: true,
        message: 'Premium user - ad skipped',
        userid: userid,
        premium: premiumStatus,
        timestamp: new Date().toISOString()
      });
    }

    // Проверяем что пользователь существует
    const userResult = await pool.query(
      'SELECT telegram_id, ad_views FROM players WHERE telegram_id = $1',
      [userid]
    );

    if (userResult.rows.length === 0) {
      console.error('🎯❌ User not found:', userid);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (process.env.NODE_ENV === 'development') console.log('🎯 User found, processing ad reward (non-premium user)...');

    // Увеличиваем счетчик рекламы в лимитах
    await pool.query(`
      INSERT INTO player_game_limits (telegram_id, game_type, daily_games, daily_ads_watched, last_reset_date)
      VALUES ($1, 'cosmic_shells', 0, 1, CURRENT_DATE)
      ON CONFLICT (telegram_id, game_type) 
      DO UPDATE SET 
        daily_ads_watched = CASE 
          WHEN player_game_limits.last_reset_date < CURRENT_DATE 
          THEN 1 
          ELSE player_game_limits.daily_ads_watched + 1 
        END,
        last_reset_date = CASE 
          WHEN player_game_limits.last_reset_date < CURRENT_DATE 
          THEN CURRENT_DATE 
          ELSE player_game_limits.last_reset_date 
        END
    `, [userid]);

    // Обновляем ad_views в таблице players
    await pool.query(`
      UPDATE players 
      SET ad_views = COALESCE(ad_views, 0) + 1
      WHERE telegram_id = $1
    `, [userid]);

    if (process.env.NODE_ENV === 'development') console.log('🎯✅ Adsgram reward processed successfully for non-premium user:', userid);

    // Успешный ответ для Adsgram
    res.json({
      success: true,
      message: 'Ad reward processed',
      userid: userid,
      premium: premiumStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎯❌ Adsgram reward error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Новый эндпоинт для проверки блокировки рекламы
router.get('/check-ad-block/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    const premiumStatus = await checkPremiumStatus(telegramId);
    
    if (process.env.NODE_ENV === 'development') console.log(`🎯 Ad block check for ${telegramId}:`, premiumStatus);
    
    res.json({
      success: true,
      blockAds: premiumStatus.hasPremium,
      premium: premiumStatus
    });
    
  } catch (error) {
    console.error('🎯❌ Ad block check error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error',
      blockAds: false // По умолчанию не блокируем при ошибке
    });
  }
});

// Простая статистика с премиум информацией
router.get('/stats/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const limitsResult = await pool.query(`
      SELECT daily_ads_watched 
      FROM player_game_limits 
      WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
    `, [telegramId]);

    const dailyAds = limitsResult.rows[0]?.daily_ads_watched || 0;

    // Проверяем премиум статус
    const premiumStatus = await checkPremiumStatus(telegramId);

    res.json({
      success: true,
      stats: {
        todayAds: dailyAds,
        maxAds: 20,
        premium: premiumStatus
      }
    });

  } catch (error) {
    console.error('🎯❌ Adsgram stats error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;