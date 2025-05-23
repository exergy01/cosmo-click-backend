const express = require('express');
const pool = require('../db');
const router = express.Router();

router.get('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let player = playerResult.rows[0];
    if (!player) {
      const referralLink = `https://t.me/CosmoClickBot?start=${telegramId}`;
      await pool.query(
        'INSERT INTO players (telegram_id, username, ccc, cs, ton, referral_link, color, collected_by_system) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [telegramId, `User${telegramId}`, 2000.0, 993.0, 1.0, referralLink, '#00f0ff', JSON.stringify({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 })]
      );
      await pool.query(
        'INSERT INTO systems (telegram_id, system_id) VALUES ($1, $2)',
        [telegramId, 1]
      );
      const newPlayerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
      player = newPlayerResult.rows[0];
    }

    // Получение систем
    const systemsResult = await pool.query('SELECT system_id FROM systems WHERE telegram_id = $1', [telegramId]);
    const systems = systemsResult.rows.map(row => row.system_id);

    // Получение cargo_levels
    const cargoLevelsResult = await pool.query('SELECT system, level FROM cargo_levels WHERE telegram_id = $1', [telegramId]);
    const cargoLevels = cargoLevelsResult.rows;

    const token = `token_${telegramId}_${Date.now()}`;
    res.json({
      ...player,
      token,
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton),
      last_collection_time: player.last_collection_time || {},
      systems,
      cargo_levels: cargoLevels,
      color: player.color || '#00f0ff',
      collected_by_system: player.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  const { username, ccc, cs, ton, color } = req.body;
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (username !== undefined) {
      updateFields.push(`username = $${paramIndex++}`);
      updateValues.push(username);
    }
    if (ccc !== undefined) {
      updateFields.push(`ccc = $${paramIndex++}`);
      updateValues.push(ccc);
    }
    if (cs !== undefined) {
      updateFields.push(`cs = $${paramIndex++}`);
      updateValues.push(cs);
    }
    if (ton !== undefined) {
      updateFields.push(`ton = $${paramIndex++}`);
      updateValues.push(ton);
    }
    if (color !== undefined) {
      updateFields.push(`color = $${paramIndex++}`);
      updateValues.push(color);
    }

    if (updateFields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updateValues.push(telegramId);
    const updateQuery = `UPDATE players SET ${updateFields.join(', ')} WHERE telegram_id = $${paramIndex}`;
    await pool.query(updateQuery, updateValues);
    const updatedPlayerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let updatedPlayer = updatedPlayerResult.rows[0];

    // Получение систем
    const systemsResult = await pool.query('SELECT system_id FROM systems WHERE telegram_id = $1', [telegramId]);
    const systems = systemsResult.rows.map(row => row.system_id);

    // Получение cargo_levels
    const cargoLevelsResult = await pool.query('SELECT system, level FROM cargo_levels WHERE telegram_id = $1', [telegramId]);
    const cargoLevels = cargoLevelsResult.rows;

    res.json({
      ...updatedPlayer,
      ccc: parseFloat(updatedPlayer.ccc),
      cs: parseFloat(updatedPlayer.cs),
      ton: parseFloat(updatedPlayer.ton),
      last_collection_time: updatedPlayer.last_collection_time || {},
      systems,
      cargo_levels: cargoLevels,
      color: updatedPlayer.color || '#00f0ff',
      collected_by_system: updatedPlayer.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/language', async (req, res) => {
  const { telegramId, language } = req.body;
  try {
    const validLanguages = ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'];
    if (!validLanguages.includes(language)) {
      return res.status(400).json({ error: 'Invalid language' });
    }
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });

    await pool.query('UPDATE players SET language = $1 WHERE telegram_id = $2', [language, telegramId]);
    const updatedPlayerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let updatedPlayer = updatedPlayerResult.rows[0];

    // Получение систем
    const systemsResult = await pool.query('SELECT system_id FROM systems WHERE telegram_id = $1', [telegramId]);
    const systems = systemsResult.rows.map(row => row.system_id);

    // Получение cargo_levels
    const cargoLevelsResult = await pool.query('SELECT system, level FROM cargo_levels WHERE telegram_id = $1', [telegramId]);
    const cargoLevels = cargoLevelsResult.rows;

    res.json({
      ...updatedPlayer,
      ccc: parseFloat(updatedPlayer.ccc),
      cs: parseFloat(updatedPlayer.cs),
      ton: parseFloat(updatedPlayer.ton),
      last_collection_time: updatedPlayer.last_collection_time || {},
      systems,
      cargo_levels: cargoLevels,
      color: updatedPlayer.color || '#00f0ff',
      collected_by_system: updatedPlayer.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/color', async (req, res) => {
  const { telegramId, color } = req.body;
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const colorRegex = /^#[0-9A-Fa-f]{6}$/;
    if (!colorRegex.test(color)) {
      return res.status(400).json({ error: 'Invalid color format' });
    }

    await pool.query('UPDATE players SET color = $1 WHERE telegram_id = $2', [color, telegramId]);
    const updatedPlayerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let updatedPlayer = updatedPlayerResult.rows[0];

    // Получение систем
    const systemsResult = await pool.query('SELECT system_id FROM systems WHERE telegram_id = $1', [telegramId]);
    const systems = systemsResult.rows.map(row => row.system_id);

    // Получение cargo_levels
    const cargoLevelsResult = await pool.query('SELECT system, level FROM cargo_levels WHERE telegram_id = $1', [telegramId]);
    const cargoLevels = cargoLevelsResult.rows;

    res.json({
      ...updatedPlayer,
      ccc: parseFloat(updatedPlayer.ccc),
      cs: parseFloat(updatedPlayer.cs),
      ton: parseFloat(updatedPlayer.ton),
      last_collection_time: updatedPlayer.last_collection_time || {},
      systems,
      cargo_levels: cargoLevels,
      color: updatedPlayer.color || '#00f0ff',
      collected_by_system: updatedPlayer.collected_by_system || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;