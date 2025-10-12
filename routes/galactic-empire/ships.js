/**
 * 🚀 РОУТЫ ДЛЯ КОРАБЛЕЙ - GALACTIC EMPIRE
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const shipsConfig = require('../../config/galactic-empire/ships.config');
const racesConfig = require('../../config/galactic-empire/races.config');
const tierConfig = require('../../config/galactic-empire/tier.config');
const moduleConfig = require('../../config/galactic-empire/module.config');
const { updateShipsHP, updateLastLogin } = require('../../utils/ship-regeneration');

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
// Купить корабль (создать сразу, но с таймером постройки)
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

    // Получаем расу игрока и её бонусы
    const race = player.race;
    const raceBonuses = racesConfig[race].bonuses;

    // Вычисляем итоговые характеристики с учётом бонусов расы
    // Используем правильные множители из config
    const finalStats = {
      hp: Math.floor(shipConfig.baseStats.hp * (raceBonuses.hull || raceBonuses.armor || 1.0)),
      maxHp: Math.floor(shipConfig.baseStats.hp * (raceBonuses.hull || raceBonuses.armor || 1.0)),
      attack: Math.floor(shipConfig.baseStats.attack * (raceBonuses.alphaDamage || raceBonuses.versatility || 1.0)),
      defense: Math.floor(shipConfig.baseStats.defense * (raceBonuses.armor || raceBonuses.versatility || 1.0)),
      speed: Math.floor(shipConfig.baseStats.speed * (raceBonuses.speed || raceBonuses.versatility || 1.0))
    };

    // ✅ ОЧЕРЕДЬ ПОСТРОЙКИ: Проверяем есть ли корабли в постройке
    const queueResult = await pool.query(`
      SELECT built_at FROM galactic_empire_ships
      WHERE player_id = $1 AND built_at > NOW()
      ORDER BY built_at DESC
      LIMIT 1
    `, [telegramId]);

    // Вычисляем время завершения постройки
    const buildTime = shipConfig.buildTime || 5; // По умолчанию 5 секунд
    let builtAt;

    if (queueResult.rows.length > 0) {
      // Если есть корабли в очереди - строим после последнего
      const lastShipBuiltAt = new Date(queueResult.rows[0].built_at);
      builtAt = new Date(lastShipBuiltAt.getTime() + buildTime * 1000);
    } else {
      // Если очередь пуста - строим сразу
      builtAt = new Date(Date.now() + buildTime * 1000);
    }

    // Создаём корабль сразу, но с built_at в будущем
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
        speed,
        built_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      telegramId,
      shipId,
      shipConfig.class,
      shipConfig.tier,
      race,
      finalStats.hp,
      finalStats.maxHp,
      finalStats.attack,
      finalStats.defense,
      finalStats.speed,
      builtAt
    ]);

    // Списываем Luminios
    await pool.query(`
      UPDATE galactic_empire_players
      SET luminios_balance = luminios_balance - $1
      WHERE telegram_id = $2
    `, [shipConfig.cost.luminios, telegramId]);

    await pool.query('COMMIT');

    const ship = shipResult.rows[0];
    const timeRemaining = Math.floor((new Date(ship.built_at) - Date.now()) / 1000);

    res.json({
      success: true,
      ship: ship,
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
      hp: Math.floor(shipConfig.baseStats.hp * (raceBonuses.hull || raceBonuses.armor || 1.0)),
      maxHp: Math.floor(shipConfig.baseStats.hp * (raceBonuses.hull || raceBonuses.armor || 1.0)),
      attack: Math.floor(shipConfig.baseStats.attack * (raceBonuses.alphaDamage || raceBonuses.versatility || 1.0)),
      defense: Math.floor(shipConfig.baseStats.defense * (raceBonuses.armor || raceBonuses.versatility || 1.0)),
      speed: Math.floor(shipConfig.baseStats.speed * (raceBonuses.speed || raceBonuses.versatility || 1.0))
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
// POST /api/galactic-empire/ships/repair
// Отремонтировать корабль (стоимость 25% от недостающего HP)
// =====================================================
router.post('/repair', async (req, res) => {
  try {
    const { telegramId, shipId } = req.body;

    if (!telegramId || !shipId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await pool.query('BEGIN');

    // Получаем данные корабля
    const shipResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE id = $1 AND player_id = $2
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];

    // Проверяем что корабль повреждён
    if (ship.current_hp >= ship.max_hp) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Ship is already at full HP' });
    }

    // Вычисляем стоимость ремонта (25% от недостающего HP)
    const hpMissing = ship.max_hp - ship.current_hp;
    const repairCost = Math.ceil(hpMissing * 0.25);

    // Получаем баланс игрока
    const playerResult = await pool.query(`
      SELECT luminios_balance FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerBalance = playerResult.rows[0].luminios_balance;

    // Проверяем баланс
    if (playerBalance < repairCost) {
      await pool.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient Luminios',
        required: repairCost,
        current: playerBalance
      });
    }

    // Восстанавливаем HP
    await pool.query(`
      UPDATE galactic_empire_ships
      SET current_hp = max_hp, updated_at = NOW()
      WHERE id = $1
    `, [shipId]);

    // Списываем Luminios
    await pool.query(`
      UPDATE galactic_empire_players
      SET luminios_balance = luminios_balance - $1
      WHERE telegram_id = $2
    `, [repairCost, telegramId]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      shipId,
      repairCost,
      newBalance: playerBalance - repairCost,
      restoredHP: hpMissing
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка ремонта корабля:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// POST /api/galactic-empire/ships/upgrade
// Начать апгрейд корабля на следующий tier
// =====================================================
router.post('/upgrade', async (req, res) => {
  try {
    const { telegramId, shipId } = req.body;

    if (!telegramId || !shipId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await pool.query('BEGIN');

    // Получаем корабль
    const shipResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE id = $1 AND player_id = $2
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];

    // Проверяем что корабль не в процессе апгрейда
    if (ship.upgrade_finish_at && new Date(ship.upgrade_finish_at) > new Date()) {
      await pool.query('ROLLBACK');
      const timeRemaining = Math.floor((new Date(ship.upgrade_finish_at) - new Date()) / 1000);
      return res.status(400).json({
        error: 'Ship is already upgrading',
        timeRemaining
      });
    }

    // Проверяем что не достигнут максимальный tier
    if (ship.tier >= 3) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Ship is already at max tier' });
    }

    const targetTier = ship.tier + 1;

    // Получаем стоимость апгрейда
    const upgradeCost = tierConfig.getUpgradeCost(ship.tier, targetTier);
    if (!upgradeCost) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid upgrade path' });
    }

    // Проверяем баланс игрока
    const playerResult = await pool.query(`
      SELECT luminios_balance FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerBalance = playerResult.rows[0].luminios_balance;

    if (playerBalance < upgradeCost.luminios) {
      await pool.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient Luminios',
        required: upgradeCost.luminios,
        current: playerBalance
      });
    }

    // Начинаем апгрейд
    const now = new Date();
    const finishAt = new Date(now.getTime() + upgradeCost.seconds * 1000);

    await pool.query(`
      UPDATE galactic_empire_ships
      SET
        upgrade_started_at = $1,
        upgrade_finish_at = $2,
        upgrade_target_tier = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [now, finishAt, targetTier, shipId]);

    // Списываем Luminios
    await pool.query(`
      UPDATE galactic_empire_players
      SET luminios_balance = luminios_balance - $1
      WHERE telegram_id = $2
    `, [upgradeCost.luminios, telegramId]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      shipId,
      currentTier: ship.tier,
      targetTier,
      cost: upgradeCost.luminios,
      upgradeTime: upgradeCost.seconds,
      finishAt: finishAt.toISOString(),
      newBalance: playerBalance - upgradeCost.luminios
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка апгрейда корабля:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// POST /api/galactic-empire/ships/upgrade/accelerate
// Ускорить апгрейд за TON (мгновенное завершение)
// =====================================================
router.post('/upgrade/accelerate', async (req, res) => {
  try {
    const { telegramId, shipId } = req.body;

    if (!telegramId || !shipId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await pool.query('BEGIN');

    // Получаем корабль
    const shipResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE id = $1 AND player_id = $2
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];

    // Проверяем что корабль в процессе апгрейда
    if (!ship.upgrade_finish_at || new Date(ship.upgrade_finish_at) <= new Date()) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Ship is not upgrading or upgrade is already complete' });
    }

    // Получаем стоимость ускорения в TON
    const upgradeCost = tierConfig.getUpgradeCost(ship.tier, ship.upgrade_target_tier);
    if (!upgradeCost) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid upgrade data' });
    }

    const tonCost = upgradeCost.tonAccelerate;

    // TODO: Здесь должна быть проверка TON платежа
    // Пока просто завершаем апгрейд

    // Завершаем апгрейд мгновенно
    await pool.query(`
      UPDATE galactic_empire_ships
      SET
        tier = upgrade_target_tier,
        upgrade_started_at = NULL,
        upgrade_finish_at = NULL,
        upgrade_target_tier = NULL,
        updated_at = NOW()
      WHERE id = $1
    `, [shipId]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      shipId,
      newTier: ship.upgrade_target_tier,
      tonCost,
      message: 'Upgrade accelerated successfully'
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка ускорения апгрейда:', error);
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

    // Получаем игрока для определения расы и last_login
    const playerResult = await pool.query(`
      SELECT race, last_login FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Обновляем HP кораблей (регенерация + штрафы)
    await updateShipsHP(pool, telegramId, player.race, player.last_login);

    // Обновляем last_login
    await updateLastLogin(pool, telegramId);

    // Автоматически завершаем готовые апгрейды
    await pool.query(`
      UPDATE galactic_empire_ships
      SET
        tier = upgrade_target_tier,
        upgrade_started_at = NULL,
        upgrade_finish_at = NULL,
        upgrade_target_tier = NULL
      WHERE player_id = $1
        AND upgrade_finish_at IS NOT NULL
        AND upgrade_finish_at <= NOW()
    `, [telegramId]);

    // Получаем обновлённые корабли
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

// =====================================================
// POST /api/galactic-empire/ships/module/equip
// Установить модуль на корабль
// =====================================================
router.post('/module/equip', async (req, res) => {
  try {
    const { telegramId, shipId, slotNumber, moduleType, moduleTier } = req.body;

    // Валидация
    if (!telegramId || !shipId || !slotNumber || !moduleType || !moduleTier) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (slotNumber < 1 || slotNumber > 3) {
      return res.status(400).json({ error: 'Invalid slot number (1-3)' });
    }

    // Проверка валидности модуля
    if (!moduleConfig.isValidModule(moduleType, moduleTier)) {
      return res.status(400).json({ error: 'Invalid module type or tier' });
    }

    await pool.query('BEGIN');

    // Проверяем что корабль принадлежит игроку
    const shipResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE id = $1 AND player_id = $2
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];
    const slotColumn = `module_slot_${slotNumber}`;

    // Проверяем наличие модуля в инвентаре
    const moduleResult = await pool.query(`
      SELECT * FROM galactic_empire_modules
      WHERE player_id = $1 AND module_type = $2 AND module_tier = $3
    `, [telegramId, moduleType, moduleTier]);

    if (moduleResult.rows.length === 0 || moduleResult.rows[0].quantity <= 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Module not in inventory' });
    }

    // Если в слоте уже есть модуль, возвращаем его в инвентарь
    const currentModule = ship[slotColumn];
    if (currentModule) {
      const [oldType, oldTierStr] = currentModule.split('_');
      const oldTier = parseInt(oldTierStr);

      await pool.query(`
        INSERT INTO galactic_empire_modules (player_id, module_type, module_tier, quantity)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (player_id, module_type, module_tier)
        DO UPDATE SET quantity = galactic_empire_modules.quantity + 1
      `, [telegramId, oldType, oldTier]);
    }

    // Устанавливаем новый модуль
    const moduleKey = `${moduleType}_${moduleTier}`;
    await pool.query(`
      UPDATE galactic_empire_ships
      SET ${slotColumn} = $1
      WHERE id = $2
    `, [moduleKey, shipId]);

    // Уменьшаем количество модулей в инвентаре
    await pool.query(`
      UPDATE galactic_empire_modules
      SET quantity = quantity - 1
      WHERE player_id = $1 AND module_type = $2 AND module_tier = $3
    `, [telegramId, moduleType, moduleTier]);

    // Удаляем модуль из инвентаря если количество стало 0
    await pool.query(`
      DELETE FROM galactic_empire_modules
      WHERE player_id = $1 AND module_type = $2 AND module_tier = $3 AND quantity <= 0
    `, [telegramId, moduleType, moduleTier]);

    // Записываем в историю
    await pool.query(`
      INSERT INTO galactic_empire_module_history
      (player_id, ship_id, module_type, module_tier, action, slot_number)
      VALUES ($1, $2, $3, $4, 'equip', $5)
    `, [telegramId, shipId, moduleType, moduleTier, slotNumber]);

    await pool.query('COMMIT');

    res.json({ success: true, slotNumber, module: moduleKey });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка установки модуля:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// POST /api/galactic-empire/ships/module/unequip
// Снять модуль с корабля
// =====================================================
router.post('/module/unequip', async (req, res) => {
  try {
    const { telegramId, shipId, slotNumber } = req.body;

    // Валидация
    if (!telegramId || !shipId || !slotNumber) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (slotNumber < 1 || slotNumber > 3) {
      return res.status(400).json({ error: 'Invalid slot number (1-3)' });
    }

    await pool.query('BEGIN');

    // Проверяем что корабль принадлежит игроку
    const shipResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE id = $1 AND player_id = $2
    `, [shipId, telegramId]);

    if (shipResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Ship not found' });
    }

    const ship = shipResult.rows[0];
    const slotColumn = `module_slot_${slotNumber}`;
    const currentModule = ship[slotColumn];

    // Проверяем что в слоте есть модуль
    if (!currentModule) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Slot is empty' });
    }

    // Парсим модуль
    const [moduleType, moduleTierStr] = currentModule.split('_');
    const moduleTier = parseInt(moduleTierStr);

    // Возвращаем модуль в инвентарь
    await pool.query(`
      INSERT INTO galactic_empire_modules (player_id, module_type, module_tier, quantity)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (player_id, module_type, module_tier)
      DO UPDATE SET quantity = galactic_empire_modules.quantity + 1
    `, [telegramId, moduleType, moduleTier]);

    // Очищаем слот
    await pool.query(`
      UPDATE galactic_empire_ships
      SET ${slotColumn} = NULL
      WHERE id = $1
    `, [shipId]);

    // Записываем в историю
    await pool.query(`
      INSERT INTO galactic_empire_module_history
      (player_id, ship_id, module_type, module_tier, action, slot_number)
      VALUES ($1, $2, $3, $4, 'unequip', $5)
    `, [telegramId, shipId, moduleType, moduleTier, slotNumber]);

    await pool.query('COMMIT');

    res.json({ success: true, slotNumber, returnedModule: currentModule });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка снятия модуля:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/galactic-empire/modules/:telegramId
// Получить инвентарь модулей игрока
// =====================================================
router.get('/modules/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const result = await pool.query(`
      SELECT * FROM galactic_empire_modules
      WHERE player_id = $1
      ORDER BY module_type, module_tier
    `, [telegramId]);

    res.json(result.rows);

  } catch (error) {
    console.error('❌ Ошибка получения модулей:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
