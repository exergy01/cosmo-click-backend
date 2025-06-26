// ===== routes/admin.js =====
const express = require('express');
const pool = require('../db');

const router = express.Router();

// POST /api/admin/add-currency
router.post('/add-currency', async (req, res) => {
  const { telegramId, ccc, cs, ton } = req.body;
  try {
    const playerResult = await pool.query('SELECT ccc, cs, ton FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const updatedCcc = (parseFloat(player.ccc) || 0) + (parseFloat(ccc) || 0);
    const updatedCs = (parseFloat(player.cs) || 0) + (parseFloat(cs) || 0);
    const updatedTon = (parseFloat(player.ton) || 0) + (parseFloat(ton) || 0);
    await pool.query('UPDATE players SET ccc = $1, cs = $2, ton = $3 WHERE telegram_id = $4', [updatedCcc, updatedCs, updatedTon, telegramId]);
    res.status(200).json({ message: 'Currency added successfully' });
  } catch (err) {
    console.error('Error adding currency:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/reset-data
router.post('/reset-data', async (req, res) => {
  const { telegramId } = req.body;
  try {
    const initialCollectedBySystem = [1, 2, 3, 4, 5, 6, 7].reduce((acc, system) => { acc[system] = 0; return acc; }, {});
    const initialLastCollectionTime = [1, 2, 3, 4, 5, 6, 7].reduce((acc, system) => { acc[system] = new Date().toISOString(); return acc; }, {});
    await pool.query(
      'UPDATE players SET ccc = $1, cs = $2, ton = $3, auto_collect = $4, last_collection_time = $5, collected_by_system = $6, cargo_levels = $7, drones = $8, asteroids = $9, unlocked_systems = $10, current_system = $11, referrals_count = $12 WHERE telegram_id = $13',
      [0, 0, 0, false, initialLastCollectionTime, initialCollectedBySystem, [], [], [], [1], 1, 0, telegramId]
    );
    res.status(200).json({ message: 'Player data reset successfully' });
  } catch (err) {
    console.error('Error resetting player data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;