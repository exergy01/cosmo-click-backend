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

    console.log(`🚀 Загрузка флота игрока ${telegramId}`);

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
        telegram_id: telegramId,
        slots: [],
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

    // Формируем ответ
    const slots = [];
    for (let i = 1; i <= formation.max_slots; i++) {
      const shipId = formation[`slot_${i}_ship_id`];
      const ship = ships.find(s => s.id === shipId);
      slots.push({
        slot: i,
        ship: ship || null
      });
    }

    res.json({
      telegram_id: telegramId,
      slots,
      max_slots: formation.max_slots,
      created_at: formation.created_at,
      updated_at: formation.updated_at
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

    console.log(`💾 Сохранение флота игрока ${telegramId}:`, slots);

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
        WHERE id = ANY($1) AND player_id::VARCHAR = $2
      `, [shipIds, telegramId]);

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

    console.log(`✅ Флот сохранён для ${telegramId}`);

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

// POST /api/cosmic-fleet/formation/unlock-slot
// Купить дополнительный слот
router.post('/unlock-slot', async (req, res) => {
  try {
    const { telegramId } = req.body;

    console.log(`🔓 Разблокировка слота для ${telegramId}`);

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

      console.log(`✅ Слот ${nextSlot} разблокирован для ${telegramId}`);

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
