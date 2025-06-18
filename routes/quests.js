// ===== routes/quests.js =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { logPlayerAction, detectSuspiciousActivity, updateLifetimeStats, logBalanceChange } = require('./shared/logger');

const router = express.Router();

// GET /api/quests/:telegramId
router.get('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  if (!telegramId) return res.status(400).json({ error: 'Telegram ID is required' });
  try {
    const result = await pool.query('SELECT * FROM player_quests WHERE telegram_id = $1 ORDER BY quest_id', [telegramId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching quests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quests/complete
router.post('/complete', async (req, res) => {
  const { telegramId, questId } = req.body;
  if (!telegramId || !questId) return res.status(400).json({ error: 'Telegram ID and Quest ID are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'complete_quest', 0, null);
    if (suspicious) {
      console.log(`🚨 Подозрительная активность при выполнении квеста: ${telegramId}`);
    }

    const questResult = await client.query('SELECT * FROM quests WHERE quest_id = $1', [questId]);
    const quest = questResult.rows[0];
    if (!quest) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quest not found' });
    }
    const playerQuestResult = await client.query('SELECT * FROM player_quests WHERE telegram_id = $1 AND quest_id = $2', [telegramId, questId]);
    if (playerQuestResult.rows.length > 0 && playerQuestResult.rows[0].completed) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quest already completed' });
    }

    // 📊 СОХРАНЯЕМ БАЛАНС ДО ОПЕРАЦИИ
    const balanceBefore = {
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton)
    };

    await client.query(
      'INSERT INTO player_quests (telegram_id, quest_id, completed, reward_cs, timestamp) VALUES ($1, $2, TRUE, $3, NOW()) ON CONFLICT (telegram_id, quest_id) DO UPDATE SET completed = TRUE, reward_cs = $3, timestamp = NOW()',
      [telegramId, questId, quest.reward_cs]
    );
    const updatedCs = parseFloat(player.cs) + parseFloat(quest.reward_cs);
    await client.query('UPDATE players SET cs = $1 WHERE telegram_id = $2', [updatedCs, telegramId]);

    // 📝 ЛОГИРОВАНИЕ ВЫПОЛНЕНИЯ КВЕСТА
    const actionId = await logPlayerAction(
      telegramId, 
      'complete_quest', 
      parseFloat(quest.reward_cs), 
      null, 
      questId, 
      {
        questData: quest,
        rewardType: 'cs',
        questTitle: quest.title || 'Unknown Quest',
        questDescription: quest.description || 'No description'
      }, 
      req
    );

    // 📊 ЛОГИРУЕМ ИЗМЕНЕНИЕ БАЛАНСА
    const balanceAfter = {
      ccc: parseFloat(player.ccc),
      cs: updatedCs,
      ton: parseFloat(player.ton)
    };

    if (actionId) {
      await logBalanceChange(telegramId, actionId, balanceBefore, balanceAfter);
    }

    // 📊 ОБНОВЛЯЕМ LIFETIME СТАТИСТИКУ
    await updateLifetimeStats(telegramId, 'collect_cs', parseFloat(quest.reward_cs));
    await updateLifetimeStats(telegramId, 'complete_quest', 1);

    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error completing quest:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;