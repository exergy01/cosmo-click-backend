/**
 * 🚀 РОУТЫ ДЛЯ КОРАБЛЕЙ - GALACTIC EMPIRE
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const shipsConfig = require('../../config/galactic-empire/ships.config');
const racesConfig = require('../../config/galactic-empire/races.config');

// =====================================================
// GET /api/galactic-empire/ships/available
// Получить список доступных кораблей для покупки
// =====================================================
router.get('/available', (req, res) => {
  const ships = Object.keys(shipsConfig).map(shipId => ({
    id: shipId,
    class: shipsConfig[shipId].class,
    tier: shipsConfig[shipId].tier,
    name: shipsConfig[shipId].name,
    nameRu: shipsConfig[shipId].nameRu,
    description: shipsConfig[shipId].description,
    descriptionRu: shipsConfig[shipId].descriptionRu,
    cost: shipsConfig[shipId].cost,
    baseStats: shipsConfig[shipId].baseStats,
    requirements: shipsConfig[shipId].requirements,
    limitPerFormation: shipsConfig[shipId].limitPerFormation,
    buildTime: shipsConfig[shipId].buildTime
  }));

  res.json(ships);
});

// =====================================================
// POST /api/galactic-empire/ships/buy
// Купить корабль (добавить в очередь постройки)
// =====================================================
router.post('/buy', async (req, res) => {
  try {
    const { telegramId, shipId } = req.body;

    // Валидация
    if (!telegramId || !shipId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Проверка что корабль существует
    if (!shipsConfig[shipId]) {
      return res.status(400).json({ error: 'Invalid ship type' });
    }

    const shipConfig = shipsConfig[shipId];

    await pool.query('BEGIN');

    // Получаем данные игрока
    const playerResult = await pool.query(`
      SELECT * FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Проверка уровня (пока заглушка - у нас level всегда >= 1)
    // TODO: добавить систему уровней позже

    // Проверка баланса Luminios
    if (player.luminios_balance < shipConfig.cost.luminios) {
      await pool.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient Luminios',
        required: shipConfig.cost.luminios,
        current: player.luminios_balance
      });
    }

    // Если это премиум корабль - проверяем лимит
    if (shipConfig.limitPerFormation === 1) {
      const existingPremium = await pool.query(`
        SELECT COUNT(*) as count
        FROM galactic_empire_ships
        WHERE player_id = $1 AND ship_class = 'premium'
      `, [telegramId]);

      if (parseInt(existingPremium.rows[0].count) > 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          error: 'Premium ship limit reached. Only one premium ship per formation.'
        });
      }
    }

    // Списываем Luminios
    await pool.query(`
      UPDATE galactic_empire_players
      SET luminios_balance = luminios_balance - $1
      WHERE telegram_id = $2
    `, [shipConfig.cost.luminios, telegramId]);

    // Вычисляем время завершения постройки
    const buildTime = shipConfig.buildTime || 5; // По умолчанию 5 секунд
    const finishAt = new Date(Date.now() + buildTime * 1000);

    // Добавляем в очередь постройки
    const queueResult = await pool.query(`
      INSERT INTO galactic_empire_build_queue (
        player_id,
        ship_type,
        ship_class,
        tier,
        finish_at
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      telegramId,
      shipId,
      shipConfig.class,
      shipConfig.tier,
      finishAt
    ]);

    await pool.query('COMMIT');

    const buildQueueEntry = queueResult.rows[0];
    const timeRemaining = Math.floor((new Date(buildQueueEntry.finish_at) - Date.now()) / 1000);

    res.json({
      success: true,
      buildQueue: buildQueueEntry,
      buildTime: buildTime,
      timeRemaining: timeRemaining,
      newBalance: player.luminios_balance - shipConfig.cost.luminios
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка покупки корабля:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/galactic-empire/ships/build-queue/:telegramId
// Получить очередь постройки игрока
// =====================================================
router.get('/build-queue/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const result = await pool.query(`
      SELECT * FROM galactic_empire_build_queue
      WHERE player_id = $1
      ORDER BY finish_at ASC
    `, [telegramId]);

    // Добавляем информацию о времени до завершения
    const queue = result.rows.map(entry => {
      const now = Date.now();
      const finishTime = new Date(entry.finish_at).getTime();
      const timeRemaining = Math.max(0, Math.floor((finishTime - now) / 1000));
      const isReady = timeRemaining === 0;

      return {
        ...entry,
        timeRemaining,
        isReady
      };
    });

    res.json(queue);

  } catch (error) {
    console.error('❌ Ошибка получения очереди постройки:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// POST /api/galactic-empire/ships/claim
// Забрать готовый корабль из очереди
// =====================================================
router.post('/claim', async (req, res) => {
  try {
    const { telegramId, queueId } = req.body;

    if (!telegramId || !queueId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await pool.query('BEGIN');

    // Получаем запись из очереди
    const queueResult = await pool.query(`
      SELECT * FROM galactic_empire_build_queue
      WHERE id = $1 AND player_id = $2
    `, [queueId, telegramId]);

    if (queueResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Build queue entry not found' });
    }

    const queueEntry = queueResult.rows[0];

    // Проверяем что постройка завершена
    const now = new Date();
    if (new Date(queueEntry.finish_at) > now) {
      await pool.query('ROLLBACK');
      const timeRemaining = Math.floor((new Date(queueEntry.finish_at) - now) / 1000);
      return res.status(400).json({
        error: 'Ship is not ready yet',
        timeRemaining
      });
    }

    // Получаем конфиг корабля
    const shipConfig = shipsConfig[queueEntry.ship_type];
    if (!shipConfig) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid ship type' });
    }

    // Получаем данные игрока для бонусов расы
    const playerResult = await pool.query(`
      SELECT * FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];
    const race = player.race;
    const raceBonuses = racesConfig[race].bonuses;

    // Вычисляем итоговые характеристики с учётом бонусов расы
    const finalStats = {
      hp: Math.floor(shipConfig.baseStats.hp * raceBonuses.hp),
      maxHp: Math.floor(shipConfig.baseStats.hp * raceBonuses.hp),
      attack: Math.floor(shipConfig.baseStats.attack * raceBonuses.attack),
      defense: Math.floor(shipConfig.baseStats.defense * raceBonuses.defense),
      speed: Math.floor(shipConfig.baseStats.speed * raceBonuses.speed)
    };

    // Создаём корабль
    const shipResult = await pool.query(`
      INSERT INTO galactic_empire_ships (
        player_id,
        ship_type,
        ship_class,
        tier,
        race,
        current_hp,
        max_hp,
        attack,
        defense,
        speed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      telegramId,
      queueEntry.ship_type,
      queueEntry.ship_class,
      queueEntry.tier,
      race,
      finalStats.hp,
      finalStats.maxHp,
      finalStats.attack,
      finalStats.defense,
      finalStats.speed
    ]);

    // Удаляем запись из очереди
    await pool.query(`
      DELETE FROM galactic_empire_build_queue
      WHERE id = $1
    `, [queueId]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      ship: shipResult.rows[0]
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка получения готового корабля:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/galactic-empire/ships/:telegramId
// Получить корабли игрока
// =====================================================
router.get('/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const result = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE player_id = $1
      ORDER BY
        CASE ship_class
          WHEN 'premium' THEN 1
          WHEN 'battleship' THEN 2
          WHEN 'cruiser' THEN 3
          WHEN 'destroyer' THEN 4
          WHEN 'frigate' THEN 5
        END,
        tier DESC,
        created_at DESC
    `, [telegramId]);

    res.json(result.rows);

  } catch (error) {
    console.error('❌ Ошибка получения кораблей:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
