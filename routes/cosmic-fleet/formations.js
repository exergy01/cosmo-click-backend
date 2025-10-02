/**
 * 🚀 COSMIC FLEET - FORMATIONS API
 *
 * API для управления флотилиями игрока
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const economyConfig = require('../../config/cosmic-fleet/economy.config');

// GET /api/cosmic-fleet/formation/:telegramId
// Получить текущий состав флота игрока
router.get('/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    // Получаем формацию
    const formationResult = await pool.query(`
      SELECT * FROM cosmic_fleet_formations WHERE telegram_id = $1
    `, [telegramId]);

    if (formationResult.rows.length === 0) {
      // Создаём пустую формацию
      await pool.query(`
        INSERT INTO cosmic_fleet_formations (telegram_id, max_slots)
        VALUES ($1, $2)
      `, [telegramId, economyConfig.fleetSlots.baseSlots]);

      return res.json({
        ships: [],
        max_slots: economyConfig.fleetSlots.baseSlots
      });
    }

    const formation = formationResult.rows[0];

    // Загружаем корабли в слотах
    const shipIds = [
      formation.slot_1_ship_id,
      formation.slot_2_ship_id,
      formation.slot_3_ship_id,
      formation.slot_4_ship_id,
      formation.slot_5_ship_id
    ].filter(id => id !== null);

    let ships = [];
    if (shipIds.length > 0) {
      const shipsResult = await pool.query(`
        SELECT
          s.*,
          st.level,
          st.experience,
          st.upgrade_weapon,
          st.upgrade_shield,
          st.upgrade_engine
        FROM cosmic_fleet_ships s
        LEFT JOIN cosmic_fleet_ship_stats st ON s.id = st.ship_id
        WHERE s.id = ANY($1)
      `, [shipIds]);
      ships = shipsResult.rows;
    }

    // Формируем ответ - только корабли в слотах (без null)
    const formationShips = [];
    for (let i = 1; i <= formation.max_slots; i++) {
      const shipId = formation[`slot_${i}_ship_id`];
      const ship = ships.find(s => s.id === shipId);
      if (ship) {
        formationShips.push(ship);
      }
    }

    res.json({
      ships: formationShips,
      max_slots: formation.max_slots
    });

  } catch (error) {
    console.error('❌ Ошибка загрузки флота:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cosmic-fleet/formation/save
// Сохранить состав флота
router.post('/save', async (req, res) => {
  try {
    const { telegramId, slots } = req.body;

    // Валидация
    if (!telegramId || !Array.isArray(slots)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Получаем текущую формацию
    const formationResult = await pool.query(`
      SELECT max_slots FROM cosmic_fleet_formations WHERE telegram_id = $1
    `, [telegramId]);

    if (formationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Formation not found' });
    }

    const maxSlots = formationResult.rows[0].max_slots;

    // Проверяем что все корабли принадлежат игроку
    const shipIds = slots.filter(id => id !== null);
    if (shipIds.length > 0) {
      const ownershipCheck = await pool.query(`
        SELECT COUNT(*) as count
        FROM cosmic_fleet_ships
        WHERE id = ANY($1) AND player_id = $2
      `, [shipIds, telegramId.toString()]);

      if (parseInt(ownershipCheck.rows[0].count) !== shipIds.length) {
        return res.status(403).json({ error: 'Ships do not belong to player' });
      }
    }

    // Обновляем формацию
    const updateQuery = `
      UPDATE cosmic_fleet_formations
      SET
        slot_1_ship_id = $1,
        slot_2_ship_id = $2,
        slot_3_ship_id = $3,
        slot_4_ship_id = $4,
        slot_5_ship_id = $5,
        updated_at = NOW()
      WHERE telegram_id = $6
    `;

    await pool.query(updateQuery, [
      slots[0] || null,
      slots[1] || null,
      slots[2] || null,
      slots[3] || null,
      slots[4] || null,
      telegramId
    ]);

    res.json({
      success: true,
      message: 'Formation saved',
      slots
    });

  } catch (error) {
    console.error('❌ Ошибка сохранения флота:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cosmic-fleet/formation/set
// Установить формацию (новый API)
router.post('/set', async (req, res) => {
  try {
    const { telegramId, shipIds } = req.body;

    // Валидация
    if (!telegramId || !Array.isArray(shipIds)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Получаем или создаём формацию
    let formationResult = await pool.query(`
      SELECT max_slots FROM cosmic_fleet_formations WHERE telegram_id = $1
    `, [telegramId]);

    if (formationResult.rows.length === 0) {
      // Создаём пустую формацию
      await pool.query(`
        INSERT INTO cosmic_fleet_formations (telegram_id, max_slots)
        VALUES ($1, $2)
      `, [telegramId, economyConfig.fleetSlots.baseSlots]);

      formationResult = await pool.query(`
        SELECT max_slots FROM cosmic_fleet_formations WHERE telegram_id = $1
      `, [telegramId]);
    }

    const maxSlots = formationResult.rows[0].max_slots;

    // Проверяем что не превышает макс слотов
    if (shipIds.length > maxSlots) {
      return res.status(400).json({ error: 'Too many ships for available slots' });
    }

    // Проверяем что все корабли принадлежат игроку
    const validShipIds = shipIds.filter(id => id !== null);
    if (validShipIds.length > 0) {
      // DEBUG: Проверка владения
      const debugQuery = await pool.query(`
        SELECT id, player_id FROM cosmic_fleet_ships WHERE id = ANY($1)
      `, [validShipIds]);
      console.log('🔍 DEBUG ownership check:', {
        requestedShips: validShipIds,
        telegramId: telegramId.toString(),
        shipsInDB: debugQuery.rows
      });

      const ownershipCheck = await pool.query(`
        SELECT COUNT(*) as count
        FROM cosmic_fleet_ships
        WHERE id = ANY($1) AND player_id = $2
      `, [validShipIds, telegramId.toString()]);

      console.log('🔍 DEBUG ownership result:', {
        found: ownershipCheck.rows[0].count,
        expected: validShipIds.length
      });

      if (parseInt(ownershipCheck.rows[0].count) !== validShipIds.length) {
        return res.status(403).json({ error: 'Ships do not belong to player' });
      }
    }

    // Обновляем формацию (первые 5 слотов)
    const updateQuery = `
      UPDATE cosmic_fleet_formations
      SET
        slot_1_ship_id = $1,
        slot_2_ship_id = $2,
        slot_3_ship_id = $3,
        slot_4_ship_id = $4,
        slot_5_ship_id = $5,
        updated_at = NOW()
      WHERE telegram_id = $6
    `;

    await pool.query(updateQuery, [
      shipIds[0] || null,
      shipIds[1] || null,
      shipIds[2] || null,
      shipIds[3] || null,
      shipIds[4] || null,
      telegramId
    ]);

    res.json({
      success: true,
      message: 'Formation set',
      shipIds
    });

  } catch (error) {
    console.error('❌ Ошибка установки формации:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cosmic-fleet/formation/unlock-slot
// Купить дополнительный слот
router.post('/unlock-slot', async (req, res) => {
  try {
    const { telegramId } = req.body;

    // Получаем текущую формацию
    const formationResult = await pool.query(`
      SELECT max_slots FROM cosmic_fleet_formations WHERE telegram_id = $1
    `, [telegramId]);

    if (formationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Formation not found' });
    }

    const currentSlots = formationResult.rows[0].max_slots;

    // Проверяем что можно разблокировать
    if (currentSlots >= economyConfig.fleetSlots.maxSlots) {
      return res.status(400).json({ error: 'Max slots reached' });
    }

    // Находим цену
    const nextSlot = currentSlots + 1;
    const slotPrice = economyConfig.fleetSlots.slotPrices.find(p => p.slot === nextSlot);

    if (!slotPrice) {
      return res.status(400).json({ error: 'Invalid slot number' });
    }

    // Проверяем баланс Luminios
    const balanceResult = await pool.query(`
      SELECT balance FROM cosmic_fleet_players WHERE telegram_id = $1
    `, [telegramId]);

    if (balanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const balance = parseFloat(balanceResult.rows[0].balance);

    if (balance < slotPrice.luminios) {
      return res.status(400).json({
        error: 'Insufficient Luminios',
        required: slotPrice.luminios,
        current: balance
      });
    }

    // Начинаем транзакцию
    await pool.query('BEGIN');

    try {
      // Списываем Luminios
      await pool.query(`
        UPDATE cosmic_fleet_players
        SET balance = balance - $1
        WHERE telegram_id = $2
      `, [slotPrice.luminios, telegramId]);

      // Разблокируем слот
      await pool.query(`
        UPDATE cosmic_fleet_formations
        SET max_slots = $1, updated_at = NOW()
        WHERE telegram_id = $2
      `, [nextSlot, telegramId]);

      await pool.query('COMMIT');

      res.json({
        success: true,
        new_max_slots: nextSlot,
        luminios_spent: slotPrice.luminios,
        new_balance: balance - slotPrice.luminios
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Ошибка разблокировки слота:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
