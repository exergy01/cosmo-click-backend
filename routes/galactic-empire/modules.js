/**
 * ⚙️ GALACTIC EMPIRE - MODULES API
 * API для работы с модулями кораблей
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const {
  MODULE_SLOTS,
  MODULE_TIERS,
  HIGH_SLOT_MODULES,
  MID_SLOT_MODULES,
  LOW_SLOT_MODULES,
  RIG_SLOT_MODULES,
  SHIP_SLOT_CONFIGURATION,
  MODULE_DROP_SYSTEM
} = require('../../config/galactic-empire/modules.config');

// =====================================================
// ПОЛУЧЕНИЕ ИНФОРМАЦИИ О МОДУЛЯХ
// =====================================================

/**
 * GET /api/galactic-empire/modules/catalog
 * Получить каталог всех доступных модулей
 */
router.get('/catalog', async (req, res) => {
  try {
    const allModules = {
      high_slot: HIGH_SLOT_MODULES,
      mid_slot: MID_SLOT_MODULES,
      low_slot: LOW_SLOT_MODULES,
      rig_slot: RIG_SLOT_MODULES
    };

    res.json({
      success: true,
      modules: allModules,
      tiers: MODULE_TIERS,
      slot_types: MODULE_SLOTS
    });
  } catch (error) {
    console.error('Error fetching module catalog:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/galactic-empire/modules/inventory/:playerId
 * Получить инвентарь модулей игрока
 */
router.get('/inventory/:playerId', async (req, res) => {
  const { playerId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM module_inventory
       WHERE player_id = $1
       ORDER BY tier DESC, module_id`,
      [playerId]
    );

    res.json({
      success: true,
      inventory: result.rows
    });
  } catch (error) {
    console.error('Error fetching module inventory:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/galactic-empire/modules/ship/:shipId
 * Получить установленные модули на корабле
 */
router.get('/ship/:shipId', async (req, res) => {
  const { shipId } = req.params;

  try {
    const modules = await pool.query(
      `SELECT * FROM ship_modules
       WHERE ship_id = $1
       ORDER BY slot_type, slot_index`,
      [shipId]
    );

    // Получаем информацию о корабле для определения доступных слотов
    const shipInfo = await pool.query(
      `SELECT ship_type FROM galactic_empire_ships WHERE id = $1`,
      [shipId]
    );

    if (shipInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Ship not found' });
    }

    const slotConfig = SHIP_SLOT_CONFIGURATION[shipInfo.rows[0].ship_type] || {
      highSlots: 2,
      midSlots: 2,
      lowSlots: 2,
      rigSlots: 1
    };

    res.json({
      success: true,
      installed_modules: modules.rows,
      available_slots: slotConfig
    });
  } catch (error) {
    console.error('Error fetching ship modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// УСТАНОВКА И СНЯТИЕ МОДУЛЕЙ
// =====================================================

/**
 * POST /api/galactic-empire/modules/install
 * Установить модуль на корабль
 */
router.post('/install', async (req, res) => {
  const { playerId, shipId, moduleId, tier, slotType, slotIndex } = req.body;

  if (!playerId || !shipId || !moduleId || !tier || !slotType || slotIndex === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Проверяем, что модуль есть в инвентаре игрока
    const inventoryCheck = await client.query(
      `SELECT quantity FROM module_inventory
       WHERE player_id = $1 AND module_id = $2 AND tier = $3`,
      [playerId, moduleId, tier]
    );

    if (inventoryCheck.rows.length === 0 || inventoryCheck.rows[0].quantity < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Module not found in inventory' });
    }

    // 2. Проверяем, что корабль принадлежит игроку
    const shipCheck = await client.query(
      `SELECT ship_type, player_id FROM galactic_empire_ships WHERE id = $1`,
      [shipId]
    );

    if (shipCheck.rows.length === 0 || shipCheck.rows[0].player_id !== playerId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Ship not found or not owned by player' });
    }

    // 3. Проверяем, что слот не занят
    const slotCheck = await client.query(
      `SELECT id FROM ship_modules
       WHERE ship_id = $1 AND slot_type = $2 AND slot_index = $3`,
      [shipId, slotType, slotIndex]
    );

    if (slotCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Slot already occupied' });
    }

    // 4. Проверяем лимит слотов
    const slotConfig = SHIP_SLOT_CONFIGURATION[shipCheck.rows[0].ship_type];
    const slotLimitMap = {
      'high_slot': slotConfig?.highSlots || 2,
      'mid_slot': slotConfig?.midSlots || 2,
      'low_slot': slotConfig?.lowSlots || 2,
      'rig_slot': slotConfig?.rigSlots || 1
    };

    if (slotIndex >= slotLimitMap[slotType]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid slot index for this ship type' });
    }

    // 5. Устанавливаем модуль
    const installResult = await client.query(
      `INSERT INTO ship_modules (ship_id, module_id, slot_type, slot_index, tier, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [shipId, moduleId, slotType, slotIndex, tier]
    );

    // 6. Убираем модуль из инвентаря
    await client.query(
      `UPDATE module_inventory
       SET quantity = quantity - 1
       WHERE player_id = $1 AND module_id = $2 AND tier = $3`,
      [playerId, moduleId, tier]
    );

    // 7. Удаляем запись если quantity = 0
    await client.query(
      `DELETE FROM module_inventory
       WHERE player_id = $1 AND module_id = $2 AND tier = $3 AND quantity = 0`,
      [playerId, moduleId, tier]
    );

    await client.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log(`✅ Module ${moduleId} (${tier}) installed on ship ${shipId}`);

    res.json({
      success: true,
      message: 'Module installed successfully',
      installed_module: installResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error installing module:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/galactic-empire/modules/uninstall
 * Снять модуль с корабля
 */
router.post('/uninstall', async (req, res) => {
  const { playerId, shipId, slotType, slotIndex } = req.body;

  if (!playerId || !shipId || !slotType || slotIndex === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Проверяем корабль
    const shipCheck = await client.query(
      `SELECT player_id FROM galactic_empire_ships WHERE id = $1`,
      [shipId]
    );

    if (shipCheck.rows.length === 0 || shipCheck.rows[0].player_id !== playerId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Ship not found or not owned by player' });
    }

    // 2. Получаем информацию о модуле
    const moduleInfo = await client.query(
      `SELECT * FROM ship_modules
       WHERE ship_id = $1 AND slot_type = $2 AND slot_index = $3`,
      [shipId, slotType, slotIndex]
    );

    if (moduleInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Module not found in this slot' });
    }

    const module = moduleInfo.rows[0];

    // 3. Проверяем, можно ли снять (риги снять нельзя!)
    if (slotType === MODULE_SLOTS.RIG) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rig modules cannot be removed once installed!' });
    }

    // 4. Удаляем модуль с корабля
    await client.query(
      `DELETE FROM ship_modules
       WHERE ship_id = $1 AND slot_type = $2 AND slot_index = $3`,
      [shipId, slotType, slotIndex]
    );

    // 5. Возвращаем модуль в инвентарь
    await client.query(
      `INSERT INTO module_inventory (player_id, module_id, tier, quantity, obtained_from)
       VALUES ($1, $2, $3, 1, 'uninstall')
       ON CONFLICT (player_id, module_id, tier)
       DO UPDATE SET quantity = module_inventory.quantity + 1`,
      [playerId, module.module_id, module.tier]
    );

    await client.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log(`✅ Module ${module.module_id} uninstalled from ship ${shipId}`);

    res.json({
      success: true,
      message: 'Module uninstalled successfully',
      returned_module: {
        module_id: module.module_id,
        tier: module.tier
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error uninstalling module:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// =====================================================
// АПГРЕЙД МОДУЛЕЙ
// =====================================================

/**
 * POST /api/galactic-empire/modules/upgrade
 * Апгрейдить модуль на следующий тир
 */
router.post('/upgrade', async (req, res) => {
  const { playerId, moduleId, fromTier } = req.body;

  if (!playerId || !moduleId || !fromTier) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Определяем следующий тир
    const tierMap = { 'T1': 'T2', 'T2': 'T3' };
    const toTier = tierMap[fromTier];

    if (!toTier) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Module is already at maximum tier (T3)' });
    }

    // 2. Получаем стоимость апгрейда
    const upgradeCostField = fromTier === 'T1' ? 'upgradeToT2Cost' : 'upgradeToT3Cost';
    const upgradeCost = MODULE_TIERS[fromTier][upgradeCostField];

    if (!upgradeCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot upgrade this tier' });
    }

    // 3. Проверяем наличие модуля в инвентаре
    const inventoryCheck = await client.query(
      `SELECT quantity FROM module_inventory
       WHERE player_id = $1 AND module_id = $2 AND tier = $3`,
      [playerId, moduleId, fromTier]
    );

    if (inventoryCheck.rows.length === 0 || inventoryCheck.rows[0].quantity < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Module not found in inventory' });
    }

    // 4. Проверяем ресурсы игрока
    const playerResources = await client.query(
      `SELECT luminios, materials FROM players WHERE telegram_id = $1 FOR UPDATE`,
      [playerId]
    );

    if (playerResources.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResources.rows[0];

    if (player.luminios < upgradeCost.luminios || player.materials < upgradeCost.materials) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient resources',
        required: upgradeCost,
        available: {
          luminios: player.luminios,
          materials: player.materials
        }
      });
    }

    // 5. Списываем ресурсы
    await client.query(
      `UPDATE players
       SET luminios = luminios - $1, materials = materials - $2
       WHERE telegram_id = $3`,
      [upgradeCost.luminios, upgradeCost.materials, playerId]
    );

    // 6. Удаляем старый модуль
    await client.query(
      `UPDATE module_inventory
       SET quantity = quantity - 1
       WHERE player_id = $1 AND module_id = $2 AND tier = $3`,
      [playerId, moduleId, fromTier]
    );

    await client.query(
      `DELETE FROM module_inventory
       WHERE player_id = $1 AND module_id = $2 AND tier = $3 AND quantity = 0`,
      [playerId, moduleId, fromTier]
    );

    // 7. Добавляем новый модуль
    await client.query(
      `INSERT INTO module_inventory (player_id, module_id, tier, quantity, obtained_from)
       VALUES ($1, $2, $3, 1, 'upgrade')
       ON CONFLICT (player_id, module_id, tier)
       DO UPDATE SET quantity = module_inventory.quantity + 1`,
      [playerId, moduleId, toTier]
    );

    // 8. Логируем апгрейд
    await client.query(
      `INSERT INTO module_upgrades (player_id, module_id, from_tier, to_tier, cost_luminios, cost_materials)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [playerId, moduleId, fromTier, toTier, upgradeCost.luminios, upgradeCost.materials]
    );

    await client.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log(`✅ Module ${moduleId} upgraded: ${fromTier} → ${toTier}`);

    res.json({
      success: true,
      message: `Module upgraded from ${fromTier} to ${toTier}`,
      upgraded_module: {
        module_id: moduleId,
        from_tier: fromTier,
        to_tier: toTier
      },
      cost: upgradeCost
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error upgrading module:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// =====================================================
// СИСТЕМА ДРОПА МОДУЛЕЙ
// =====================================================

/**
 * POST /api/galactic-empire/modules/reward-drop
 * Добавить модуль игроку после боя (дроп)
 * Используется внутри системы боёв
 */
router.post('/reward-drop', async (req, res) => {
  const { playerId, enemyFleetPower } = req.body;

  if (!playerId || !enemyFleetPower) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Определяем шанс дропа
    const dropChance = MODULE_DROP_SYSTEM.calculateDropChance(enemyFleetPower, true);

    if (Math.random() > dropChance) {
      return res.json({
        success: true,
        dropped: false,
        message: 'No module dropped this time'
      });
    }

    // 2. Определяем тир
    const tier = MODULE_DROP_SYSTEM.determineTier(0);

    // 3. Выбираем случайный модуль
    const droppedModule = MODULE_DROP_SYSTEM.getRandomModule(tier);

    if (!droppedModule) {
      return res.json({
        success: true,
        dropped: false,
        message: 'No suitable module found'
      });
    }

    // 4. Добавляем модуль в инвентарь
    await pool.query(
      `INSERT INTO module_inventory (player_id, module_id, tier, quantity, obtained_from)
       VALUES ($1, $2, $3, 1, 'battle_drop')
       ON CONFLICT (player_id, module_id, tier)
       DO UPDATE SET quantity = module_inventory.quantity + 1`,
      [playerId, droppedModule.id, tier]
    );

    if (process.env.NODE_ENV === 'development') console.log(`🎁 Module dropped: ${droppedModule.name} (${tier}) for player ${playerId}`);

    res.json({
      success: true,
      dropped: true,
      module: {
        id: droppedModule.id,
        name: droppedModule.name,
        nameRu: droppedModule.nameRu,
        tier: tier,
        slot: droppedModule.slot
      }
    });

  } catch (error) {
    console.error('Error processing module drop:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
