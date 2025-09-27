// routes/dailyBonus.js - Система ежедневных бонусов
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { logPlayerAction, updateLifetimeStats, logBalanceChange } = require('./shared/logger');

const router = express.Router();

// Конфигурация ежедневных бонусов (CCC за каждый день)
const DAILY_BONUS_AMOUNTS = [10, 20, 30, 40, 50, 60, 100];

// GET /api/daily-bonus/status/:telegramId - получить статус ежедневных бонусов
router.get('/status/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const player = await getPlayer(telegramId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // ✅ ПРОСТАЯ ЛОГИКА как в заданиях - используем поля игрока напрямую
    const currentTime = new Date();
    const today = currentTime.toDateString();

    let dailyBonusStreak = player.daily_bonus_streak || 0;
    let dailyBonusLastClaim = player.daily_bonus_last_claim;
    let canClaim = true;
    let nextDay = 1;

    // Логика как в quest_ad системе
    if (dailyBonusLastClaim) {
      const lastClaimDate = new Date(dailyBonusLastClaim).toDateString();
      const yesterday = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000).toDateString();

      if (lastClaimDate === today) {
        // Уже забрал сегодня
        canClaim = false;
        nextDay = dailyBonusStreak < 7 ? dailyBonusStreak + 1 : 1;
      } else if (lastClaimDate === yesterday) {
        // Можно продолжить стрик
        nextDay = dailyBonusStreak < 7 ? dailyBonusStreak + 1 : 1;
      } else {
        // Стрик сброшен - новый день после пропуска
        nextDay = 1;
      }
    }

    const nextBonusAmount = DAILY_BONUS_AMOUNTS[nextDay - 1];

    res.json({
      can_claim: canClaim,
      current_streak: dailyBonusStreak,
      next_day: nextDay,
      next_bonus_amount: nextBonusAmount,
      last_claim_date: dailyBonusLastClaim,
      bonus_schedule: DAILY_BONUS_AMOUNTS
    });

  } catch (err) {
    console.error('Error getting daily bonus status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/daily-bonus/test-simple/:telegramId - ПРОСТОЙ ТЕСТ без БД
router.post('/test-simple/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  console.log(`🧪 Simple test for ${telegramId}`);

  res.json({
    success: true,
    message: 'Простой тест работает!',
    telegramId: telegramId,
    timestamp: new Date().toISOString()
  });
});

// POST /api/daily-bonus/test-tomorrow/:telegramId - ТЕСТ завтрашнего дня
router.post('/test-tomorrow/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    console.log(`🧪 Tomorrow test for ${telegramId}`);

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: 'telegramId is required'
      });
    }

    // Устанавливаем дату как завтра для теста
    const tomorrowTime = new Date();
    tomorrowTime.setDate(tomorrowTime.getDate() + 1);

    console.log(`🧪 About to update DB for tomorrow test...`);
    await pool.query(`
      UPDATE players
      SET daily_bonus_last_claim = $1
      WHERE telegram_id = $2
    `, [tomorrowTime, telegramId]);
    console.log(`🧪 DB updated successfully for tomorrow test`);

    res.json({
      success: true,
      message: 'Дата установлена на завтра для тестирования',
      test_date: tomorrowTime.toISOString()
    });

  } catch (error) {
    console.error('Ошибка тестового endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// POST /api/daily-bonus/claim/:telegramId - забрать ежедневный бонус
router.post('/claim/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: 'telegramId is required'
      });
    }

    console.log(`🎁 Claim request for ${telegramId}`);

    // ✅ ПРОСТАЯ ЛОГИКА как в watch_ad из заданий
    const playerResult = await pool.query(
      'SELECT telegram_id, first_name, ccc, daily_bonus_streak, daily_bonus_last_claim FROM players WHERE telegram_id = $1',
      [telegramId]
    );

    console.log(`📊 Player query result: ${playerResult.rows.length} rows`);

    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Игрок не найден'
      });
    }

    const player = playerResult.rows[0];
    console.log(`👤 Player data:`, {
      telegram_id: player.telegram_id,
      daily_bonus_streak: player.daily_bonus_streak,
      daily_bonus_last_claim: player.daily_bonus_last_claim
    });

    const currentTime = new Date();
    console.log(`⏰ Current time:`, currentTime);

    const today = currentTime.toDateString();
    console.log(`📅 Today:`, today);

    const lastClaimDate = player.daily_bonus_last_claim ? new Date(player.daily_bonus_last_claim).toDateString() : null;
    console.log(`📅 Last claim date:`, lastClaimDate);

    // Проверяем, можно ли забрать бонус сегодня
    if (lastClaimDate === today) {
      console.log(`❌ Already claimed today`);
      return res.status(400).json({
        success: false,
        error: 'Ежедневный бонус уже получен сегодня'
      });
    }

    console.log(`🧮 Calculating streak...`);

    // Рассчитываем новый стрик
    let newStreak = 1;
    let currentStreak = player.daily_bonus_streak || 0;
    console.log(`📊 Current streak:`, currentStreak);

    if (lastClaimDate) {
      const yesterday = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000).toDateString();
      console.log(`📅 Yesterday:`, yesterday);

      if (lastClaimDate === yesterday) {
        // Продолжаем стрик
        newStreak = currentStreak < 7 ? currentStreak + 1 : 1;
        console.log(`✅ Continuing streak to:`, newStreak);
      } else {
        console.log(`🔄 Streak reset to 1`);
      }
      // Если пропустил день - стрик сбрасывается на 1
    } else {
      console.log(`🆕 First time claiming`);
    }

    const bonusAmount = DAILY_BONUS_AMOUNTS[newStreak - 1];
    console.log(`💰 Bonus amount for day ${newStreak}:`, bonusAmount);

    console.log(`💰 Начисляем бонус: день ${newStreak}, сумма ${bonusAmount} CCC`);

    // ✅ ПРОСТОЙ UPDATE БЕЗ ТРАНЗАКЦИЙ (транзакции блокируются!)
    try {
      console.log(`🔧 About to execute UPDATE with params:`, {
        newStreak,
        currentTime: currentTime.toISOString(),
        bonusAmount,
        telegramId
      });

      console.log(`🔧 Calling pool.query now...`);
      const updateResult = await pool.query(`
        UPDATE players
        SET daily_bonus_streak = $1,
            daily_bonus_last_claim = $2,
            ccc = ccc + $3
        WHERE telegram_id = $4
        RETURNING daily_bonus_streak, ccc
      `, [newStreak, currentTime, bonusAmount, telegramId]);

      console.log(`🔧 pool.query completed successfully`);

      console.log(`✅ Update successful:`, updateResult.rows[0]);

      console.log(`✅ Игрок ${telegramId} получил ежедневный бонус: день ${newStreak}, ${bonusAmount} CCC`);

      res.json({
        success: true,
        message: 'Ежедневный бонус получен',
        bonus_amount: bonusAmount,
        streak_day: newStreak,
        next_day: newStreak < 7 ? newStreak + 1 : 1,
        next_bonus_amount: DAILY_BONUS_AMOUNTS[newStreak < 7 ? newStreak : 0],
        is_max_streak: newStreak === 7
      });

    } catch (updateError) {
      console.error(`❌ Update failed:`, updateError);
      throw updateError;
    }

  } catch (error) {
    console.error('Ошибка получения ежедневного бонуса:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// GET /api/daily-bonus/leaderboard - топ игроков по ежедневным бонусам
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        telegram_id,
        first_name,
        username,
        daily_bonus_streak as current_streak,
        daily_bonus_last_claim as last_claim_date
      FROM players
      WHERE daily_bonus_streak > 0
      ORDER BY daily_bonus_streak DESC, daily_bonus_last_claim DESC
      LIMIT 50
    `);

    res.json({
      leaderboard: result.rows
    });

  } catch (err) {
    console.error('Error getting daily bonus leaderboard:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;