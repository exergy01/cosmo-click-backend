// routes/cosmic-fleet/ships.js - API для покупки и управления кораблями
const express = require('express');
const router = express.Router();
const db = require('../../db');

// Константы
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
  const telegramId = parseInt(req.body.telegramId);

  if (!DEBUG_TELEGRAM_IDS.includes(telegramId)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Cosmic Fleet is in development.'
    });
  }

  next();
};

// 🎯 POST /api/cosmic-fleet/ships/buy - Покупка корабля
router.post('/buy', checkDebugAccess, async (req, res) => {
  try {
    const { telegramId, shipTemplateId, price } = req.body;

    if (!telegramId || !shipTemplateId || !price) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data'
      });
    }

    const template = SHIP_TEMPLATES[shipTemplateId];
    if (!template || template.price !== price) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ship template or price'
      });
    }

    // Начинаем транзакцию
    await db.query('BEGIN');

    try {
      // 1. Получаем игрока и проверяем баланс
      const playerQuery = `
        SELECT id, luminios_balance FROM cosmic_fleet_players
        WHERE telegram_id = $1
      `;
      const playerResult = await db.query(playerQuery, [telegramId]);

      if (playerResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Player not found'
        });
      }

      const player = playerResult.rows[0];
      if (player.luminios_balance < price) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Insufficient Luminios balance'
        });
      }

      // 2. Списываем Luminios
      const deductQuery = `
        UPDATE cosmic_fleet_players
        SET luminios_balance = luminios_balance - $1
        WHERE id = $2
        RETURNING luminios_balance
      `;
      const deductResult = await db.query(deductQuery, [price, player.id]);
      const newLuminiosBalance = deductResult.rows[0].luminios_balance;

      // 3. Создаем корабль
      const shipQuery = `
        INSERT INTO cosmic_fleet_ships (
          player_id, ship_template_id, ship_name, health, max_health, damage, speed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      const shipResult = await db.query(shipQuery, [
        telegramId.toString(),
        shipTemplateId,
        template.name,
        template.baseHealth,
        template.baseHealth,
        template.baseDamage,
        template.baseSpeed
      ]);

      // 4. Записываем транзакцию покупки
      const transactionQuery = `
        INSERT INTO luminios_transactions (
          telegram_id, transaction_type, luminios_amount, description
        ) VALUES ($1, $2, $3, $4)
      `;
      await db.query(transactionQuery, [
        telegramId,
        'purchase',
        -price,
        `Purchased ship: ${template.name}`
      ]);

      await db.query('COMMIT');

      // Возвращаем новый корабль
      const newShip = {
        id: shipResult.rows[0].id.toString(),
        name: template.name,
        class: template.class,
        health: template.baseHealth,
        maxHealth: template.baseHealth,
        damage: template.baseDamage,
        speed: template.baseSpeed,
        level: 1,
        experience: 0,
        price: template.price,
        isOwned: true
      };

      res.json({
        success: true,
        ship: newShip,
        newLuminiosBalance
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error purchasing ship:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// 🎯 POST /api/cosmic-fleet/ships/repair - Ремонт корабля
router.post('/repair', checkDebugAccess, async (req, res) => {
  try {
    const { telegramId, shipId } = req.body;

    if (!telegramId || !shipId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data'
      });
    }

    // Начинаем транзакцию
    await db.query('BEGIN');

    try {
      // 1. Получаем корабль и игрока
      const shipQuery = `
        SELECT s.*, p.luminios_balance, p.id as player_id
        FROM cosmic_fleet_ships s
        JOIN cosmic_fleet_players p ON s.player_id = p.id
        WHERE s.id = $1 AND p.telegram_id = $2
      `;
      const shipResult = await db.query(shipQuery, [shipId, telegramId]);

      if (shipResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Ship not found'
        });
      }

      const ship = shipResult.rows[0];

      if (ship.health === ship.max_health) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Ship does not need repair'
        });
      }

      // Рассчитываем стоимость ремонта (20% от максимального здоровья в Luminios)
      const repairCost = Math.ceil(ship.max_health * 0.2);

      if (ship.luminios_balance < repairCost) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Insufficient Luminios for repair'
        });
      }

      // 2. Списываем Luminios
      const deductQuery = `
        UPDATE cosmic_fleet_players
        SET luminios_balance = luminios_balance - $1
        WHERE id = $2
      `;
      await db.query(deductQuery, [repairCost, ship.player_id]);

      // 3. Ремонтируем корабль
      const repairQuery = `
        UPDATE cosmic_fleet_ships
        SET health = max_health
        WHERE id = $1
        RETURNING *
      `;
      const repairResult = await db.query(repairQuery, [shipId]);

      // 4. Записываем транзакцию ремонта
      const transactionQuery = `
        INSERT INTO luminios_transactions (
          telegram_id, transaction_type, luminios_amount, description
        ) VALUES ($1, $2, $3, $4)
      `;
      await db.query(transactionQuery, [
        telegramId,
        'purchase',
        -repairCost,
        `Repaired ship: ${ship.ship_name}`
      ]);

      await db.query('COMMIT');

      // Возвращаем отремонтированный корабль
      const repairedShip = repairResult.rows[0];
      const template = SHIP_TEMPLATES[repairedShip.ship_template_id];

      res.json({
        success: true,
        ship: {
          id: repairedShip.id.toString(),
          name: repairedShip.ship_name,
          class: template?.class || 'frigate',
          health: repairedShip.health,
          maxHealth: repairedShip.max_health,
          damage: repairedShip.damage,
          speed: repairedShip.speed,
          level: repairedShip.level,
          experience: repairedShip.experience,
          price: template?.price || 0,
          isOwned: true
        },
        cost: repairCost
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error repairing ship:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;