const express = require('express');
const pool = require('../db');
const { sendNotification } = require('./telegramBot');
const router = express.Router();

router.post('/create', async (req, res) => {
  const { telegramId } = req.body;
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.referral_link) return res.status(400).json({ error: 'Referral link already exists' });

    const referralLink = `https://t.me/CosmoClickBot?start=${telegramId}`;
    await pool.query('UPDATE players SET referral_link = $1 WHERE telegram_id = $2', [referralLink, telegramId]);
    const updatedPlayer = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    res.json(updatedPlayer.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/join', async (req, res) => {
  const { telegramId, referrerId } = req.body;
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.referrer_id) return res.status(400).json({ error: 'Already referred' });

    const referrerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [referrerId]);
    const referrer = referrerResult.rows[0];
    if (!referrer) return res.status(404).json({ error: 'Referrer not found' });

    await pool.query('UPDATE players SET referrer_id = $1 WHERE telegram_id = $2', [referrerId, telegramId]);
    await pool.query('UPDATE players SET referrals_count = referrals_count + 1, cs = cs + 50 WHERE telegram_id = $1', [referrerId]);
    await pool.query(
      'INSERT INTO referrals (telegram_id, username, cs_earned, ton_earned) VALUES ($1, $2, $3, $4)',
      [telegramId, player.username, 0, 0]
    );
    await sendNotification(referrerId, 'New referral joined! You earned 50 CS.');
    const updatedPlayer = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    res.json(updatedPlayer.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const referralsResult = await pool.query(
      'SELECT r.*, p.username FROM referrals r JOIN players p ON r.telegram_id = p.telegram_id WHERE p.referrer_id = $1',
      [telegramId]
    );
    res.json(referralsResult.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/honor-board', async (req, res) => {
  try {
    const honorBoardResult = await pool.query(
      'SELECT p.telegram_id, p.username, p.referrals_count FROM players p WHERE p.referrals_count > 0 ORDER BY p.referrals_count DESC'
    );
    res.json(honorBoardResult.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;