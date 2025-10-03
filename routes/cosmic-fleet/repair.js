/**
 * 🔧 COSMIC FLEET - REPAIR SYSTEM
 *
 * API для ремонта кораблей
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const gameConfig = require('../../config/cosmic-fleet/game.config');
const shipsConfig = require('../../config/cosmic-fleet/ships.config');

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

/**
 * Расчёт стоимости ремонта
 */
function calculateRepairCost(ship, repairType, repairValue) {
  const { price } = ship;
  const { maxHealth, health } = ship;

  // Базовая стоимость 1 HP
  const costPerHP = (price * gameConfig.repair.quickRepair.costMultiplier) / maxHealth;

  let hpToRepair = 0;
  let totalCost = 0;

  switch (repairType) {
    case 'full':
      // Полный ремонт со скидкой 10%
      hpToRepair = maxHealth - health;
      totalCost = Math.ceil(hpToRepair * costPerHP * (1 - gameConfig.repair.quickRepair.fullRepairDiscount));
      break;

    case 'percent':
      // Процентный ремонт (25%, 50%, 75%)
      const percentValue = parseInt(repairValue);
      if (!gameConfig.repair.quickRepair.percentOptions.includes(percentValue)) {
        throw new Error(`Invalid percent value. Allowed: ${gameConfig.repair.quickRepair.percentOptions.join(', ')}`);
      }
      hpToRepair = Math.min(
        Math.floor((maxHealth * percentValue) / 100),
        maxHealth - health
      );
      totalCost = Math.ceil(hpToRepair * costPerHP);
      break;

    case 'amount':
      // Ремонт на определённую сумму
      const amount = parseInt(repairValue);
      hpToRepair = Math.floor(amount / costPerHP);
      hpToRepair = Math.min(hpToRepair, maxHealth - health);
      totalCost = amount;
      break;

    default:
      throw new Error('Invalid repair type. Use: full, percent, amount');
  }

  return {
    hpToRepair,
    totalCost,
    costPerHP,
    newHealth: Math.min(health + hpToRepair, maxHealth)
  };
}

// =====================================================
// POST /api/cosmic-fleet/repair/calculate
// Расчёт стоимости ремонта (без применения)
// =====================================================
router.post('/calculate', async (req, res) => {
  try {
    const { shipId, telegramId, repairType, repairValue } = req.body;

    // Валидация
    if (!shipId || !telegramId || !repairType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Получаем корабль
    const shipResult = await pool.query(`
      SELECT s.*, p.luminios_balance
      FROM cosmic_fleet_ships s
      JOIN cosmic_fleet_players p ON s.player_id = p.telegram_id::text
      WHERE s.id = $1 AND p.telegram_id = $2
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];

    // Проверка - нужен ли ремонт
    if (ship.health >= ship.max_health) {
      return res.status(400).json({
        error: 'Ship is already at full health',
        currentHealth: ship.health,
        maxHealth: ship.max_health
      });
    }

    // Расчёт
    const repairDetails = calculateRepairCost(ship, repairType, repairValue);

    res.json({
      success: true,
      ship: {
        id: ship.id,
        name: ship.ship_name,
        currentHealth: ship.health,
        maxHealth: ship.max_health
      },
      repair: repairDetails,
      playerBalance: ship.luminios_balance
    });

  } catch (error) {
    console.error('❌ Ошибка расчёта ремонта:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// =====================================================
// POST /api/cosmic-fleet/repair/apply
// Применить ремонт
// =====================================================
router.post('/apply', async (req, res) => {
  try {
    const { shipId, telegramId, repairType, repairValue } = req.body;

    // Валидация
    if (!shipId || !telegramId || !repairType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await pool.query('BEGIN');

    // Получаем корабль с блокировкой
    const shipResult = await pool.query(`
      SELECT s.*, p.luminios_balance, p.telegram_id as player_telegram_id
      FROM cosmic_fleet_ships s
      JOIN cosmic_fleet_players p ON s.player_id = p.telegram_id::text
      WHERE s.id = $1 AND p.telegram_id = $2
      FOR UPDATE
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];

    // Проверка здоровья
    if (ship.health >= ship.max_health) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Ship is already at full health' });
    }

    // Расчёт ремонта
    const repairDetails = calculateRepairCost(ship, repairType, repairValue);

    // Проверка баланса
    if (ship.luminios_balance < repairDetails.totalCost) {
      await pool.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient Luminios balance',
        required: repairDetails.totalCost,
        available: ship.luminios_balance
      });
    }

    // Обновляем HP корабля
    await pool.query(`
      UPDATE cosmic_fleet_ships
      SET
        health = $1,
        last_auto_repair = NOW()
      WHERE id = $2
    `, [repairDetails.newHealth, shipId]);

    // Списываем Luminios
    await pool.query(`
      UPDATE cosmic_fleet_players
      SET luminios_balance = luminios_balance - $1
      WHERE telegram_id = $2
    `, [repairDetails.totalCost, telegramId]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      ship: {
        id: ship.id,
        name: ship.ship_name,
        oldHealth: ship.health,
        newHealth: repairDetails.newHealth,
        maxHealth: ship.max_health
      },
      repair: {
        hpRestored: repairDetails.hpToRepair,
        cost: repairDetails.totalCost
      },
      newBalance: ship.luminios_balance - repairDetails.totalCost
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка применения ремонта:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// =====================================================
// GET /api/cosmic-fleet/repair/auto-repair-status/:telegramId
// Статус авто-ремонта для всех кораблей
// =====================================================
router.get('/auto-repair-status/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const result = await pool.query(`
      SELECT
        id,
        ship_name,
        health,
        max_health,
        last_auto_repair,
        EXTRACT(EPOCH FROM (NOW() - last_auto_repair)) / 60 as minutes_since_repair,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - last_auto_repair)) / 60 / $1) as repairs_available
      FROM cosmic_fleet_ships
      WHERE player_id = $2
      AND health < max_health
    `, [gameConfig.repair.autoRepair.intervalMinutes, telegramId]);

    res.json({
      ships: result.rows,
      config: {
        hpPerInterval: gameConfig.repair.autoRepair.hpPerInterval,
        intervalMinutes: gameConfig.repair.autoRepair.intervalMinutes
      }
    });

  } catch (error) {
    console.error('❌ Ошибка получения статуса авто-ремонта:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/cosmic-fleet/repair/config
// Получить конфиг ремонта
// =====================================================
router.get('/config', (req, res) => {
  res.json({
    autoRepair: gameConfig.repair.autoRepair,
    quickRepair: gameConfig.repair.quickRepair
  });
});

module.exports = router;
