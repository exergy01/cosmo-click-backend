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
    const newBalance = Math.floor(playerBalance - price); // Преобразование в целое число

    if (playerBalance < price) {
      console.log(`Insufficient ${currency.toUpperCase()}: ${playerBalance} < ${price}`);
      return res.status(400).json({ error: `Insufficient ${currency.toUpperCase()}` });
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    updateFields.push(`${currency} = $${paramIndex++}`);
    updateValues.push(newBalance);

    if (type === 'drone') {
      const drones = Array.isArray(player.drones) ? player.drones : [];
      const existingDrone = drones.find(d => d.id === id && d.system === system);
      console.log('Existing drones:', drones, 'Checking for:', { id, system }, 'Found:', existingDrone);
      if (existingDrone) {
        return res.status(400).json({ error: 'Drone already purchased' });
      }
      updateFields.push(`drones = $${paramIndex++}`);
      updateValues.push(JSON.stringify([...drones, { id, system }]));
      console.log('Updated drones:', JSON.stringify([...drones, { id, system }]));
    } else if (type === 'asteroid') {
      const asteroids = Array.isArray(player.asteroids) ? player.asteroids : [];
      const existingAsteroid = asteroids.find(a => a.id === id && a.system === system);
      console.log('Existing asteroids:', asteroids, 'Checking for:', { id, system }, 'Found:', existingAsteroid);
      if (existingAsteroid) {
        return res.status(400).json({ error: 'Asteroid already purchased' });
      }
      updateFields.push(`asteroids = $${paramIndex++}`);
      updateValues.push(JSON.stringify([...asteroids, { id, system }]));
    } else if (type === 'cargo') {
      if (!cargo_capacity || isNaN(cargo_capacity)) {
        console.log('Invalid cargo_capacity:', cargo_capacity);
        return res.status(400).json({ error: 'Invalid or missing cargo_capacity' });
      }
      const cargoLevels = Array.isArray(player.cargo_levels) ? player.cargo_levels : [];
      const currentCargo = cargoLevels.find(c => c.system === system) || { system, level: 0 };
      if (currentCargo.level >= id) {
        return res.status(400).json({ error: 'Cargo level already purchased' });
      }
      const updatedCargoLevels = cargoLevels.filter(c => c.system !== system);
      updatedCargoLevels.push({ system, level: id });
      updateFields.push(`cargo_levels = $${paramIndex++}`);
      updateValues.push(JSON.stringify(updatedCargoLevels));
      updateFields.push(`cargo_capacity = $${paramIndex++}`);
      updateValues.push(Number(cargo_capacity));
    } else if (type === 'system') {
      const systems = Array.isArray(player.systems) ? player.systems : [];
      if (systems.includes(id)) {
        return res.status(400).json({ error: 'System already purchased' });
      }
      updateFields.push(`systems = $${paramIndex++}`);
      updateValues.push(JSON.stringify([...systems, id]));
      const cargoLevels = Array.isArray(player.cargo_levels) ? player.cargo_levels : [];
      if (!cargoLevels.find(c => c.system === id)) {
        cargoLevels.push({ system: id, level: 0 });
      }
      updateFields.push(`cargo_levels = $${paramIndex++}`);
      updateValues.push(JSON.stringify(cargoLevels));
      updateFields.push(`drones = $${paramIndex++}`);
      updateValues.push(JSON.stringify(Array.isArray(player.drones) ? player.drones.filter(d => d.system !== id) : []));
      updateFields.push(`asteroids = $${paramIndex++}`);
      updateValues.push(JSON.stringify(Array.isArray(player.asteroids) ? player.asteroids.filter(a => a.system !== id) : []));
    } else {
      return res.status(400).json({ error: 'Invalid item type' });
    }

    updateValues.push(telegramId);
    const updateQuery = `UPDATE players SET ${updateFields.join(', ')} WHERE telegram_id = $${paramIndex} RETURNING *`;
    console.log('Executing query:', updateQuery);
    console.log('With values:', updateValues);
    const result = await db.query(updateQuery, updateValues);

    player = result.rows[0];
    res.json({
      ...player,
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton),
      mathccc: parseFloat(player.mathccc || '0'),
      collected_by_system: player.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (error) {
    console.error('Error purchasing item:', error.message, error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

module.exports = router;