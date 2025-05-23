const express = require('express');
const router = express.Router();
const db = require('../db');
const { asteroidData, droneData, cargoData } = require('../shopData');

router.post('/buy', async (req, res) => {
  console.log('Received POST /api/shop/buy with headers:', req.headers);
  console.log('Request body:', req.body);

  const { telegramId, type, id, price, system, cargo_capacity } = req.body;

  if (!telegramId || !type || !id || !price || !system) {
    console.log('Missing required fields:', { telegramId, type, id, price, system });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.query('SELECT 1');
    console.log('Database connection OK');

    const playerQuery = await db.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let player = playerQuery.rows[0];

    if (!player) {
      console.log(`Player not found for telegramId: ${telegramId}`);
      return res.status(404).json({ error: 'Player not found' });
    }

    console.log('Player found:', player);

    let currency = 'cs';
    if ([5, 6, 7].includes(id)) currency = 'ton';
    const playerBalance = parseFloat(player[currency] || '0');
    const newBalance = Math.floor(playerBalance - price);

    if (playerBalance < price) {
      console.log(`Insufficient ${currency.toUpperCase()}: ${playerBalance} < ${price}`);
      return res.status(400).json({ error: `Insufficient ${currency.toUpperCase()}` });
    }

    // Получение текущих данных
    const dronesResult = await db.query('SELECT drone_id, system FROM drones WHERE telegram_id = $1', [telegramId]);
    const drones = dronesResult.rows.map(row => ({ id: row.drone_id, system: row.system }));

    const asteroidsResult = await db.query('SELECT asteroid_id, system FROM asteroids WHERE telegram_id = $1', [telegramId]);
    const asteroids = asteroidsResult.rows.map(row => ({ id: row.asteroid_id, system: row.system }));

    const systemsResult = await db.query('SELECT system_id FROM systems WHERE telegram_id = $1', [telegramId]);
    const systems = systemsResult.rows.map(row => row.system_id);

    const cargoLevelsResult = await db.query('SELECT system, level FROM cargo_levels WHERE telegram_id = $1', [telegramId]);
    const cargoLevels = cargoLevelsResult.rows;

    // Обновление баланса
    await db.query(`UPDATE players SET ${currency} = $1 WHERE telegram_id = $2`, [newBalance, telegramId]);

    if (type === 'drone') {
      const existingDrone = drones.find(d => d.id === id && d.system === system);
      if (existingDrone) {
        return res.status(400).json({ error: 'Drone already purchased' });
      }
      await db.query('INSERT INTO drones (telegram_id, drone_id, system) VALUES ($1, $2, $3)', [telegramId, id, system]);
    } else if (type === 'asteroid') {
      const existingAsteroid = asteroids.find(a => a.id === id && a.system === system);
      if (existingAsteroid) {
        return res.status(400).json({ error: 'Asteroid already purchased' });
      }
      await db.query('INSERT INTO asteroids (telegram_id, asteroid_id, system) VALUES ($1, $2, $3)', [telegramId, id, system]);
    } else if (type === 'cargo') {
      if (!cargo_capacity || isNaN(cargo_capacity)) {
        console.log('Invalid cargo_capacity:', cargo_capacity);
        return res.status(400).json({ error: 'Invalid or missing cargo_capacity' });
      }
      const currentCargo = cargoLevels.find(c => c.system === system);
      if (currentCargo && currentCargo.level >= id) {
        return res.status(400).json({ error: 'Cargo level already purchased' });
      }
      if (currentCargo) {
        await db.query('UPDATE cargo_levels SET level = $1 WHERE telegram_id = $2 AND system = $3', [id, telegramId, system]);
      } else {
        await db.query('INSERT INTO cargo_levels (telegram_id, system, level) VALUES ($1, $2, $3)', [telegramId, system, id]);
      }
      await db.query('UPDATE players SET cargo_capacity = $1 WHERE telegram_id = $2', [Number(cargo_capacity), telegramId]);
    } else if (type === 'system') {
      if (systems.includes(id)) {
        return res.status(400).json({ error: 'System already purchased' });
      }
      await db.query('INSERT INTO systems (telegram_id, system_id) VALUES ($1, $2)', [telegramId, id]);
      if (!cargoLevels.find(c => c.system === id)) {
        await db.query('INSERT INTO cargo_levels (telegram_id, system, level) VALUES ($1, $2, $3)', [telegramId, id, 0]);
      }
      // Удаление дронов и астероидов для новой системы
      await db.query('DELETE FROM drones WHERE telegram_id = $1 AND system = $2', [telegramId, id]);
      await db.query('DELETE FROM asteroids WHERE telegram_id = $1 AND system = $2', [telegramId, id]);
    } else {
      return res.status(400).json({ error: 'Invalid item type' });
    }

    // Получение обновленных данных
    const updatedPlayerResult = await db.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    player = updatedPlayerResult.rows[0];

    const updatedSystemsResult = await db.query('SELECT system_id FROM systems WHERE telegram_id = $1', [telegramId]);
    const updatedSystems = updatedSystemsResult.rows.map(row => row.system_id);

    const updatedCargoLevelsResult = await db.query('SELECT system, level FROM cargo_levels WHERE telegram_id = $1', [telegramId]);
    const updatedCargoLevels = updatedCargoLevelsResult.rows;

    res.json({
      ...player,
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton),
      mathccc: parseFloat(player.mathccc || '0'),
      systems: updatedSystems,
      cargo_levels: updatedCargoLevels,
      collected_by_system: player.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (error) {
    console.error('Error purchasing item:', error.message, error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

module.exports = router;