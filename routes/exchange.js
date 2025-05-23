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

    await pool.query(
      'INSERT INTO exchange_history (telegram_id, from_currency, to_currency, amount, converted_amount) VALUES ($1, $2, $3, $4, $5)',
      [telegramId, fromCurrency, toCurrency, amount, convertedAmount]
    );
    const updatedPlayer = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    res.json({
      ...updatedPlayer.rows[0],
      ccc: parseFloat(updatedPlayer.rows[0].ccc),
      cs: parseFloat(updatedPlayer.rows[0].cs),
      ton: parseFloat(updatedPlayer.rows[0].ton)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;