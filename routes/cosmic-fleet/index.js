// routes/cosmic-fleet/index.js - Главные роуты для Cosmic Fleet Commander
const express = require('express');
const router = express.Router();
const db = require('../../db');

// Константы
const EXCHANGE_RATE = 10; // 1 CCC = 10 Luminios
const DEBUG_TELEGRAM_IDS = [2097930691, 850758749, 1222791281, 123456789];

// Шаблоны кораблей (синхронизированы с фронтендом)
const SHIP_TEMPLATES = {
  'frigate_1': {
    id: 'frigate_1',
    name: 'Interceptor',
    class: 'frigate',
    baseHealth: 150,
    baseDamage: 35,
    baseSpeed: 90,
    price: 200
  },
  'frigate_2': {
    id: 'frigate_2',
    name: 'Scout',
    class: 'frigate',
    baseHealth: 200,
    baseDamage: 40,
    baseSpeed: 85,
    price: 350
  },
  'cruiser_1': {
    id: 'cruiser_1',
    name: 'Destroyer',
    class: 'cruiser',
    baseHealth: 450,
    baseDamage: 85,
    baseSpeed: 65,
    price: 800
  },
  'cruiser_2': {
    id: 'cruiser_2',
    name: 'Heavy Cruiser',
    class: 'cruiser',
    baseHealth: 600,
    baseDamage: 110,
    baseSpeed: 55,
    price: 1500
  },
  'battleship_1': {
    id: 'battleship_1',
    name: 'Battlecruiser',
    class: 'battleship',
    baseHealth: 1200,
    baseDamage: 220,
    baseSpeed: 40,
    price: 3500
  },
  'dreadnought_1': {
    id: 'dreadnought_1',
    name: 'Titan',
    class: 'dreadnought',
    baseHealth: 2500,
    baseDamage: 450,
    baseSpeed: 25,
    price: 8500
  }
};

// Middleware для проверки доступа
const checkDebugAccess = (req, res, next) => {
  const telegramId = parseInt(req.params.telegramId || req.body.telegramId);

  if (!DEBUG_TELEGRAM_IDS.includes(telegramId)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Cosmic Fleet is in development.'
    });
  }

  next();
};

// 🎯 GET /api/cosmic-fleet/user/:telegramId - Получить профиль игрока
router.get('/user/:telegramId', checkDebugAccess, async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);

    const playerQuery = `
      SELECT * FROM cosmic_fleet_players
      WHERE telegram_id = $1
    `;
    const playerResult = await db.query(playerQuery, [telegramId]);

    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Player not found'
      });
    }

    const player = playerResult.rows[0];

    // Конвертируем snake_case в camelCase для фронтенда
    const responsePlayer = {
      telegramId: player.telegram_id,
      luminiosBalance: player.luminios_balance,
      totalBattles: player.total_battles,
      wins: player.wins,
      losses: player.losses,
      rankPoints: player.rank_points,
      createdAt: player.created_at,
      updatedAt: player.updated_at
    };

    res.json(responsePlayer);
  } catch (error) {
    console.error('Error getting cosmic fleet player:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// 🎯 POST /api/cosmic-fleet/user/:telegramId/init - Инициализация игрока
router.post('/user/:telegramId/init', checkDebugAccess, async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);

    // Проверяем, существует ли игрок
    const checkQuery = `
      SELECT * FROM cosmic_fleet_players
      WHERE telegram_id = $1
    `;
    const checkResult = await db.query(checkQuery, [telegramId]);

    if (checkResult.rows.length > 0) {
      // Игрок уже существует, возвращаем его
      const player = checkResult.rows[0];
      return res.json({
        telegramId: player.telegram_id,
        luminiosBalance: player.luminios_balance,
        totalBattles: player.total_battles,
        wins: player.wins,
        losses: player.losses,
        rankPoints: player.rank_points,
        createdAt: player.created_at,
        updatedAt: player.updated_at
      });
    }

    // Создаем нового игрока
    const insertQuery = `
      INSERT INTO cosmic_fleet_players (telegram_id, luminios_balance)
      VALUES ($1, $2)
      RETURNING *
    `;
    const insertResult = await db.query(insertQuery, [telegramId, 1000]); // Начальный баланс 1000 Luminios

    const newPlayer = insertResult.rows[0];

    // Даем игроку стартовый корабль (фрегат)
    const startShipQuery = `
      INSERT INTO cosmic_fleet_ships (
        player_id, ship_template_id, ship_name, health, max_health, damage, speed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    const startTemplate = SHIP_TEMPLATES['frigate_1'];
    await db.query(startShipQuery, [
      newPlayer.id,
      'frigate_1',
      'Starter Interceptor',
      startTemplate.baseHealth,
      startTemplate.baseHealth,
      startTemplate.baseDamage,
      startTemplate.baseSpeed
    ]);

    res.json({
      telegramId: newPlayer.telegram_id,
      luminiosBalance: newPlayer.luminios_balance,
      totalBattles: newPlayer.total_battles,
      wins: newPlayer.wins,
      losses: newPlayer.losses,
      rankPoints: newPlayer.rank_points,
      createdAt: newPlayer.created_at,
      updatedAt: newPlayer.updated_at
    });
  } catch (error) {
    console.error('Error initializing cosmic fleet player:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// 🎯 GET /api/cosmic-fleet/fleet/:telegramId - Получить флот игрока
router.get('/fleet/:telegramId', checkDebugAccess, async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);

    // Получаем игрока
    const playerQuery = `
      SELECT id FROM cosmic_fleet_players
      WHERE telegram_id = $1
    `;
    const playerResult = await db.query(playerQuery, [telegramId]);

    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Player not found'
      });
    }

    const playerId = playerResult.rows[0].id;

    // Получаем корабли
    const shipsQuery = `
      SELECT * FROM cosmic_fleet_ships
      WHERE player_id = $1
      ORDER BY created_at ASC
    `;
    const shipsResult = await db.query(shipsQuery, [playerId]);

    // Конвертируем в формат фронтенда
    const ships = shipsResult.rows.map(ship => ({
      id: ship.id.toString(),
      name: ship.ship_name,
      class: SHIP_TEMPLATES[ship.ship_template_id]?.class || 'frigate',
      health: ship.health,
      maxHealth: ship.max_health,
      damage: ship.damage,
      speed: ship.speed,
      level: ship.level,
      experience: ship.experience,
      price: SHIP_TEMPLATES[ship.ship_template_id]?.price || 0,
      isOwned: true
    }));

    res.json(ships);
  } catch (error) {
    console.error('Error getting fleet:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;