/**
 * 🌌 GALACTIC EMPIRE v2.0 - ОСНОВНЫЕ API РОУТЫ
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const racesConfig = require('../../config/galactic-empire/races.config');
const gameConfig = require('../../config/galactic-empire/game.config');

// =====================================================
// GET /api/galactic-empire/player/:telegramId
// Получить данные игрока
// =====================================================
router.get('/player/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const result = await pool.query(`
      SELECT * FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = result.rows[0];

    // Получаем корабли
    const shipsResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE player_id = $1
      ORDER BY created_at DESC
    `, [telegramId]);

    // Получаем формации
    const formationsResult = await pool.query(`
      SELECT * FROM galactic_empire_formations
      WHERE player_id = $1
    `, [telegramId]);

    res.json({
      player,
      ships: shipsResult.rows,
      formations: formationsResult.rows
    });

  } catch (error) {
    console.error('❌ Ошибка получения данных игрока:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// POST /api/galactic-empire/select-race
// Выбор расы при первом входе
// =====================================================
router.post('/select-race', async (req, res) => {
  try {
    const { telegramId, race } = req.body;

    // Валидация
    if (!telegramId || !race) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Проверка что раса существует
    if (!racesConfig[race]) {
      return res.status(400).json({ error: 'Invalid race' });
    }

    await pool.query('BEGIN');

    // Проверяем что игрока ещё нет
    const existingPlayer = await pool.query(`
      SELECT telegram_id FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (existingPlayer.rows.length > 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Player already exists' });
    }

    // Создаём игрока
    await pool.query(`
      INSERT INTO galactic_empire_players (telegram_id, race, luminios_balance)
      VALUES ($1, $2, 1000)
    `, [telegramId, race]);

    // Создаём формацию для расы
    await pool.query(`
      INSERT INTO galactic_empire_formations (player_id, race)
      VALUES ($1, $2)
    `, [telegramId, race]);

    // Для Zerg - создаём запись о первом логине
    if (race === 'zerg') {
      await pool.query(`
        INSERT INTO galactic_empire_daily_logins (player_id, login_date)
        VALUES ($1, CURRENT_DATE)
        ON CONFLICT (player_id, login_date) DO NOTHING
      `, [telegramId]);
    }

    await pool.query('COMMIT');

    res.json({
      success: true,
      message: `Welcome to ${racesConfig[race].name}!`,
      race
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка выбора расы:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/galactic-empire/races
// Получить список всех рас
// =====================================================
router.get('/races', (req, res) => {
  const races = Object.keys(racesConfig).map(raceId => ({
    id: raceId,
    name: racesConfig[raceId].name,
    nameRu: racesConfig[raceId].nameRu,
    description: racesConfig[raceId].description,
    descriptionRu: racesConfig[raceId].descriptionRu,
    color: racesConfig[raceId].color,
    secondaryColor: racesConfig[raceId].secondaryColor,
    weaponType: racesConfig[raceId].weaponType,
    weaponName: racesConfig[raceId].weaponName,
    specialAbility: racesConfig[raceId].specialAbility
    // НЕ отдаём бонусы и секретные параметры!
  }));

  res.json(races);
});

// =====================================================
// GET /api/galactic-empire/config
// Получить игровой конфиг (публичные параметры)
// =====================================================
router.get('/config', (req, res) => {
  res.json({
    repair: {
      autoRepair: {
        hpPerInterval: gameConfig.repair.autoRepair.hpPerInterval,
        intervalMinutes: gameConfig.repair.autoRepair.intervalMinutes
      },
      quickRepair: {
        fullRepairDiscount: gameConfig.repair.quickRepair.fullRepairDiscount,
        percentOptions: gameConfig.repair.quickRepair.percentOptions
      }
    },
    battle: {
      maxRounds: gameConfig.battle.maxRounds,
      modes: gameConfig.battle.modes
    },
    races: {
      changeCost: gameConfig.races.selection.changeCost,
      dualRaceCost: gameConfig.races.dualRace.cost
    }
  });
});

// =====================================================
// DELETE /api/galactic-empire/player/:telegramId
// Сброс игрока (смена расы)
// =====================================================
router.delete('/player/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    await pool.query('BEGIN');

    // Удаляем бои
    await pool.query(`
      DELETE FROM galactic_empire_battles
      WHERE player1_id = $1 OR player2_id = $1
    `, [telegramId]);

    // Удаляем логины (для Zerg)
    await pool.query(`
      DELETE FROM galactic_empire_daily_logins
      WHERE player_id = $1
    `, [telegramId]);

    // Удаляем лут
    await pool.query(`
      DELETE FROM galactic_empire_loot
      WHERE player_id = $1
    `, [telegramId]);

    // Удаляем корабли
    await pool.query(`
      DELETE FROM galactic_empire_ships
      WHERE player_id = $1
    `, [telegramId]);

    // Удаляем формации
    await pool.query(`
      DELETE FROM galactic_empire_formations
      WHERE player_id = $1
    `, [telegramId]);

    // Удаляем данные игрока из GE
    await pool.query(`
      DELETE FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      message: 'Player data reset successfully'
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка сброса игрока:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
