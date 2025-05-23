const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const questResult = await db.query('SELECT * FROM quests WHERE telegram_id = $1', [telegramId]);
    res.json(questResult.rows);
  } catch (err) {
    console.error('Error fetching quests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/complete', async (req, res) => {
  const { telegramId, quest_id, reward_cs } = req.body;
  try {
    const questResult = await db.query(
      'INSERT INTO quests (telegram_id, quest_id, completed, reward_cs, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [telegramId, quest_id, true, reward_cs || 0, new Date().toISOString()]
    );
    res.json(questResult.rows[0]);
  } catch (err) {
    console.error('Error completing quest:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;