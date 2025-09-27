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

    console.log(`📅 Проверка статуса ежедневных бонусов для ${telegramId}`);

    const player = await getPlayer(telegramId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Получаем информацию о ежедневных бонусах
    const bonusResult = await pool.query(
      'SELECT * FROM daily_bonus_streaks WHERE telegram_id = $1',
      [telegramId]
    );

    let bonusData = bonusResult.rows[0];

    // Если записи нет, создаем новую
    if (!bonusData) {
      await pool.query(
        'INSERT INTO daily_bonus_streaks (telegram_id, current_streak, last_claim_date, total_claims) VALUES ($1, 0, NULL, 0)',
        [telegramId]
      );

      bonusData = {
        telegram_id: telegramId,
        current_streak: 0,
        last_claim_date: null,
        total_claims: 0
      };
    }

    const now = new Date();
    const today = now.toDateString();

    // Проверяем можно ли забрать бонус сегодня
    let canClaim = true;
    let nextDay = 1;

    if (bonusData.last_claim_date) {
      const lastClaimDate = new Date(bonusData.last_claim_date).toDateString();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();

      if (lastClaimDate === today) {
        // Уже забрал сегодня
        canClaim = false;
        nextDay = bonusData.current_streak < 7 ? bonusData.current_streak + 1 : 1;
      } else if (lastClaimDate === yesterday) {
        // Можно продолжить стрик
        nextDay = bonusData.current_streak < 7 ? bonusData.current_streak + 1 : 1;
      } else {
        // Стрик сброшен
        nextDay = 1;
      }
    }

    const nextBonusAmount = DAILY_BONUS_AMOUNTS[nextDay - 1];

    console.log(`📅 Статус бонусов: день ${nextDay}, можно забрать: ${canClaim}, сумма: ${nextBonusAmount} CCC`);

    res.json({
      can_claim: canClaim,
      current_streak: bonusData.current_streak,
      next_day: nextDay,
      next_bonus_amount: nextBonusAmount,
      last_claim_date: bonusData.last_claim_date,
      total_claims: bonusData.total_claims,
      bonus_schedule: DAILY_BONUS_AMOUNTS
    });

  } catch (err) {
    console.error('Error getting daily bonus status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/daily-bonus/claim/:telegramId - забрать ежедневный бонус
router.post('/claim/:telegramId', async (req, res) => {
  const { telegramId } = req.params;

  console.log(`🎁 Попытка забрать ежедневный бонус: ${telegramId}`);

  console.log(`🔗 Получение подключения к БД...`);
  const client = await pool.connect();
  console.log(`✅ Подключение получено, начинаем транзакцию...`);

  try {
    await client.query('BEGIN');
    console.log(`✅ Транзакция начата, проверяем игрока...`);

    // Проверяем игрока напрямую в транзакции
    const playerResult = await client.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    console.log(`✅ Игрок проверен: ${player ? 'найден' : 'НЕ найден'}`);


    if (!player) {
      console.log(`❌ Игрок не найден, откатываем транзакцию`);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    console.log(`🎯 Получаем статус ежедневных бонусов...`);
    // Получаем текущий статус бонусов
    const bonusResult = await client.query(
      'SELECT * FROM daily_bonus_streaks WHERE telegram_id = $1 FOR UPDATE',
      [telegramId]
    );
    console.log(`✅ Статус получен, записей найдено: ${bonusResult.rows.length}`);

    let bonusData = bonusResult.rows[0];

    // Если записи нет, создаем
    if (!bonusData) {
      console.log(`➕ Создаем новую запись для игрока ${telegramId}...`);
      await client.query(
        'INSERT INTO daily_bonus_streaks (telegram_id, current_streak, last_claim_date, total_claims) VALUES ($1, 0, NULL, 0)',
        [telegramId]
      );
      console.log(`✅ Запись создана`);

      bonusData = {
        telegram_id: telegramId,
        current_streak: 0,
        last_claim_date: null,
        total_claims: 0
      };
    }

    const now = new Date();
    const today = now.toDateString();

    // Проверяем можно ли забрать
    if (bonusData.last_claim_date) {
      const lastClaimDate = new Date(bonusData.last_claim_date).toDateString();

      if (lastClaimDate === today) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Daily bonus already claimed today' });
      }
    }

    // Вычисляем новый стрик
    let newStreak = 1;

    if (bonusData.last_claim_date) {
      const lastClaimDate = new Date(bonusData.last_claim_date).toDateString();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();

      if (lastClaimDate === yesterday) {
        // Продолжаем стрик
        newStreak = bonusData.current_streak < 7 ? bonusData.current_streak + 1 : 1;
      }
      // Если пропустил день - стрик сбрасывается на 1
    }

    const bonusAmount = DAILY_BONUS_AMOUNTS[newStreak - 1];

    console.log(`🎁 Начисляем бонус: день ${newStreak}, сумма ${bonusAmount} CCC`);

    // Сохраняем баланс до операции
    const balanceBefore = {
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton)
    };

    // Начисляем CCC
    const newCccBalance = parseFloat(player.ccc) + bonusAmount;

    await client.query(
      'UPDATE players SET ccc = $1 WHERE telegram_id = $2',
      [newCccBalance, telegramId]
    );

    // Обновляем статус ежедневных бонусов
    await client.query(
      'UPDATE daily_bonus_streaks SET current_streak = $1, last_claim_date = $2, total_claims = total_claims + 1 WHERE telegram_id = $3',
      [newStreak, now, telegramId]
    );

    // Логируем действие
    const actionId = await logPlayerAction(
      telegramId,
      'daily_bonus_claim',
      bonusAmount,
      null,
      null,
      {
        streak_day: newStreak,
        bonus_amount: bonusAmount,
        was_streak_reset: newStreak === 1 && bonusData.current_streak > 0
      },
      req
    );

    // Логируем изменение баланса
    const balanceAfter = {
      ccc: newCccBalance,
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton)
    };

    if (actionId) {
      await logBalanceChange(telegramId, actionId, balanceBefore, balanceAfter);
    }

    // Обновляем статистику
    await updateLifetimeStats(telegramId, 'daily_bonus_claim', 1);

    await client.query('COMMIT');

    console.log(`✅ Ежедневный бонус начислен: ${bonusAmount} CCC (день ${newStreak})`);

    res.json({
      success: true,
      bonus_amount: bonusAmount,
      streak_day: newStreak,
      next_day: newStreak < 7 ? newStreak + 1 : 1,
      next_bonus_amount: DAILY_BONUS_AMOUNTS[newStreak < 7 ? newStreak : 0],
      is_max_streak: newStreak === 7
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error claiming daily bonus:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/daily-bonus/leaderboard - топ игроков по ежедневным бонусам
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.telegram_id,
        p.first_name,
        p.username,
        dbs.current_streak,
        dbs.total_claims,
        dbs.last_claim_date
      FROM daily_bonus_streaks dbs
      JOIN players p ON dbs.telegram_id = p.telegram_id
      WHERE dbs.total_claims > 0
      ORDER BY dbs.current_streak DESC, dbs.total_claims DESC
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