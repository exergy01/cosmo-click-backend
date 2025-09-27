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

    // ✅ ПРОСТАЯ ЛОГИКА как в watch_ad из заданий
    const playerResult = await pool.query(
      'SELECT telegram_id, first_name, ccc, daily_bonus_streak, daily_bonus_last_claim FROM players WHERE telegram_id = $1',
      [telegramId]
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Игрок не найден'
      });
    }

    const player = playerResult.rows[0];
    const currentTime = new Date();
    const today = currentTime.toDateString();
    const lastClaimDate = player.daily_bonus_last_claim ? new Date(player.daily_bonus_last_claim).toDateString() : null;

    // Проверяем, можно ли забрать бонус сегодня
    if (lastClaimDate === today) {
      return res.status(400).json({
        success: false,
        error: 'Ежедневный бонус уже получен сегодня'
      });
    }

    // Рассчитываем новый стрик
    let newStreak = 1;
    let currentStreak = player.daily_bonus_streak || 0;

    if (lastClaimDate) {
      const yesterday = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000).toDateString();
      if (lastClaimDate === yesterday) {
        // Продолжаем стрик
        newStreak = currentStreak < 7 ? currentStreak + 1 : 1;
      }
      // Если пропустил день - стрик сбрасывается на 1
    }

    const bonusAmount = DAILY_BONUS_AMOUNTS[newStreak - 1];

    // ✅ ПРОСТАЯ ТРАНЗАКЦИЯ как в заданиях
    await pool.query('BEGIN');

    try {
      // Обновляем игрока одним запросом
      await pool.query(`
        UPDATE players
        SET daily_bonus_streak = $1,
            daily_bonus_last_claim = $2,
            ccc = ccc + $3
        WHERE telegram_id = $4
      `, [newStreak, currentTime, bonusAmount, telegramId]);

      await pool.query('COMMIT');

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

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
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