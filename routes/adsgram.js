// routes/adsgram.js - ПРОСТОЙ вариант как у друга

const express = require('express');
const router = express.Router();
const pool = require('../db');

// Reward endpoint - как у друга с userid в URL
router.get('/reward', async (req, res) => {
  try {
    const { userid } = req.query; // Берем из URL параметра как у друга
    
    console.log('🎯 Adsgram reward received for user:', userid);
    console.log('🎯 Query params:', req.query);
    console.log('🎯 IP:', req.ip);

    // Проверяем что userid есть
    if (!userid) {
      console.error('🎯❌ No userid provided');
      return res.status(400).json({
        success: false,
        error: 'No userid provided'
      });
    }

    // Проверяем что пользователь существует
    const userResult = await pool.query(
      'SELECT telegram_id FROM players WHERE telegram_id = $1',
      [userid]
    );

    if (userResult.rows.length === 0) {
      console.error('🎯❌ User not found:', userid);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('🎯 User found, processing reward...');

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

    console.log('🎯✅ Adsgram reward processed successfully for user:', userid);

    // Успешный ответ для Adsgram
    res.json({
      success: true,
      message: 'Reward processed',
      userid: userid,
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

// Простая статистика
router.get('/stats/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const limitsResult = await pool.query(`
      SELECT daily_ads_watched 
      FROM player_game_limits 
      WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
    `, [telegramId]);

    const dailyAds = limitsResult.rows[0]?.daily_ads_watched || 0;

    res.json({
      success: true,
      stats: {
        todayAds: dailyAds,
        maxAds: 20
      }
    });

  } catch (error) {
    console.error('🎯❌ Adsgram stats error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;