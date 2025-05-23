const express = require('express');
const pool = require('../db');
const { asteroidData, droneData } = require('../shopData');
const router = express.Router();

router.post('/collect', async (req, res) => {
  const { telegramId, last_collection_time, system } = req.body;

  if (!telegramId || !last_collection_time || !system) {
    console.error('Missing parameters:', { telegramId, last_collection_time, system });
    return res.status(400).json({ error: 'Missing telegramId, last_collection_time, or system' });
  }

  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];

    if (!player) {
      console.error('Player not found for telegramId:', telegramId);
      return res.status(404).json({ error: 'Player not found' });
    }

    const currentCcc = Number(player.ccc) || 0;
    const collectedBySystem = player.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 };
    const currentTotalCollected = Number(collectedBySystem[system] || 0);

    const lastCollection = player.last_collection_time?.[system] ? new Date(player.last_collection_time[system]).getTime() : 0;
    const currentTime = new Date(last_collection_time).getTime();
    const timeElapsed = (currentTime - lastCollection) / 1000;

    const totalCccPerDay = player.drones
      .filter(d => d.system === system)
      .reduce((sum, d) => {
        const drone = droneData.find(item => item.id === d.id && item.system === system);
        return sum + (drone ? drone.cccPerDay : 0);
      }, 0);
    const miningSpeed = totalCccPerDay / (24 * 60 * 60);

    const asteroidTotal = player.asteroids
      .filter(a => a.system === system)
      .reduce((sum, a) => {
        const asteroid = asteroidData.find(item => item.id === a.id && item.system === system);
        return sum + (asteroid ? asteroid.totalCcc : 0);
      }, 0);
    const remainingCapacity = Math.max(0, asteroidTotal - currentTotalCollected);
    const cargoLimit = Number(player.cargo_capacity || 50);
    const cccToAdd = Math.min(miningSpeed * timeElapsed, remainingCapacity, cargoLimit);

    const newCcc = Number((currentCcc + cccToAdd).toFixed(5));
    const newCollectedBySystem = { ...collectedBySystem, [system]: Number((currentTotalCollected + cccToAdd).toFixed(5)) };
    const newLastCollectionTime = { ...player.last_collection_time, [system]: last_collection_time };

    console.log('Attempting to update player:', {
      telegramId, cccToAdd, newCcc, collectedBySystem: newCollectedBySystem, last_collection_time: newLastCollectionTime,
    });

    await pool.query(
      'UPDATE players SET ccc = $1, collected_by_system = $2, last_collection_time = $3 WHERE telegram_id = $4',
      [newCcc, newCollectedBySystem, newLastCollectionTime, telegramId]
    );

    // Сброс только для текущей системы
    const resetCollectedBySystem = { ...newCollectedBySystem, [system]: 0 };
    await pool.query(
      'UPDATE players SET collected_by_system = $1 WHERE telegram_id = $2',
      [resetCollectedBySystem, telegramId]
    );

    const updatedPlayerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const updatedPlayer = updatedPlayerResult.rows[0];

    const response = {
      ...updatedPlayer,
      ccc: Number(updatedPlayer.ccc || 0).toFixed(5),
      cs: Number(updatedPlayer.cs || 0).toFixed(5),
      ton: Number(updatedPlayer.ton || 0).toFixed(5),
      mathccc: Number(updatedPlayer.mathccc || 0).toFixed(5),
      last_collection_time: updatedPlayer.last_collection_time,
      collected_by_system: updatedPlayer.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    };
    console.log('Collection successful:', { telegramId, newCcc, collected_by_system: resetCollectedBySystem });
    res.json(response);
  } catch (err) {
    console.error('Error in /api/safe/collect:', {
      message: err.message, stack: err.stack, requestBody: req.body,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/update-counter', async (req, res) => {
  const { telegramId, last_collection_time, system } = req.body;
  if (!telegramId || !last_collection_time || !system) {
    console.error('Missing parameters for update-counter:', { telegramId, last_collection_time, system });
    return res.status(400).json({ error: 'Missing telegramId, last_collection_time, or system' });
  }

  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const lastCollection = player.last_collection_time?.[system] ? new Date(player.last_collection_time[system]).getTime() : 0;
    const currentTime = new Date(last_collection_time).getTime();
    const timeElapsed = (currentTime - lastCollection) / 1000;

    const totalCccPerDay = player.drones
      .filter(d => d.system === system)
      .reduce((sum, d) => {
        const drone = droneData.find(item => item.id === d.id && item.system === system);
        return sum + (drone ? drone.cccPerDay : 0);
      }, 0);
    const miningSpeed = totalCccPerDay / (24 * 60 * 60);

    const asteroidTotal = player.asteroids
      .filter(a => a.system === system)
      .reduce((sum, a) => {
        const asteroid = asteroidData.find(item => item.id === a.id && item.system === system);
        return sum + (asteroid ? asteroid.totalCcc : 0);
      }, 0);
    const currentTotalCollected = Number(player.collected_by_system?.[system] || 0);
    const remainingCapacity = Math.max(0, asteroidTotal - currentTotalCollected);
    const cargoLimit = Number(player.cargo_capacity || 50);

    const calculatedValue = miningSpeed * timeElapsed;
    let cccCounterValue = calculatedValue;
    if (calculatedValue > cargoLimit) cccCounterValue = cargoLimit;
    if (calculatedValue > remainingCapacity) cccCounterValue = remainingCapacity;

    res.json({
      cccCounter: Number(cccCounterValue.toFixed(5)),
      asteroidTotal: asteroidTotal,
      collected_by_system: player.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (err) {
    console.error('Error in /api/safe/update-counter:', {
      message: err.message, stack: err.stack, requestBody: req.body,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;