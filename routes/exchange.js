const express = require('express');
const pool = require('../db');
const router = express.Router();

router.post('/convert', async (req, res) => {
  const { telegramId, amount, fromCurrency, toCurrency } = req.body;
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const rates = { ccc_to_cs: 1000, cs_to_ccc: 1000 }; // 1 CS = 1000 CCC
    let convertedAmount;

    if (fromCurrency === 'ccc' && toCurrency === 'cs') {
      if (player.ccc < amount) return res.status(400).json({ error: 'Insufficient CCC' });
      convertedAmount = amount / rates.ccc_to_cs;
      await pool.query('UPDATE players SET ccc = ccc - $1, cs = cs + $2 WHERE telegram_id = $3', [amount, convertedAmount, telegramId]);
    } else if (fromCurrency === 'cs' && toCurrency === 'ccc') {
      if (player.cs < amount) return res.status(400).json({ error: 'Insufficient CS' });
      convertedAmount = amount * rates.cs_to_ccc;
      await pool.query('UPDATE players SET cs = cs - $1, ccc = ccc + $2 WHERE telegram_id = $3', [amount, convertedAmount, telegramId]);
    } else {
      return res.status(400).json({ error: 'Invalid conversion' });
    }

    const updatedPlayerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const updatedPlayer = updatedPlayerResult.rows[0];

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
      systems,
      cargo_levels: cargoLevels
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;