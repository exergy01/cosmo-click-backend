const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/quests/:telegramId - получить задания для игрока
router.get('/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Получаем игрока с его registration_language
    const playerResult = await pool.query(
      'SELECT registration_language FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const registrationLanguage = playerResult.rows[0].registration_language || 'en';
    console.log(`🎯 Загружаем задания для игрока ${telegramId}, язык регистрации: ${registrationLanguage}`);
    
    // Получаем все активные задания
    const questsResult = await pool.query(`
      SELECT quest_id, quest_name, quest_type, description, reward_cs, quest_data, is_active
      FROM quests 
      WHERE is_active = true 
      AND (
        quest_data IS NULL 
        OR quest_data->>'language' IS NULL 
        OR quest_data->>'language' = $1
      )
      ORDER BY quest_id
    `, [registrationLanguage]);
    
    // Получаем выполненные задания игрока
    const completedResult = await pool.query(
      'SELECT quest_id FROM player_quests WHERE telegram_id = $1 AND completed = true',
      [telegramId]
    );
    
    const completedQuestIds = completedResult.rows.map(row => row.quest_id);
    
    // Объединяем данные
    const quests = questsResult.rows.map(quest => ({
      ...quest,
      completed: completedQuestIds.includes(quest.quest_id)
    }));
    
    console.log(`✅ Найдено ${quests.length} заданий для игрока ${telegramId}`);
    res.json({ success: true, quests });
    
  } catch (error) {
    console.error('Error fetching quests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quests/watch_ad - просмотр рекламы для заданий
router.post('/watch_ad', async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: 'telegramId is required' 
      });
    }
    
    // Проверяем существование игрока
    const playerResult = await pool.query(
      'SELECT telegram_id, quest_ad_views FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Игрок не найден' 
      });
    }
    
    const player = playerResult.rows[0];
    const questAdViews = player.quest_ad_views || 0;
    
    // Проверяем дневной лимит (5 раз в день)
    if (questAdViews >= 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Дневной лимит просмотра рекламы исчерпан' 
      });
    }
    
    const newQuestAdViews = questAdViews + 1;
    const reward = 10; // 10 CCC за просмотр
    
    // Начинаем транзакцию
    await pool.query('BEGIN');
    
    try {
      // Увеличиваем счетчик рекламы и добавляем CCC
      await pool.query(`
        UPDATE players 
        SET quest_ad_views = $1, ccc = ccc + $2
        WHERE telegram_id = $3
      `, [newQuestAdViews, reward, telegramId]);
      
      await pool.query('COMMIT');
      
      console.log(`✅ Игрок ${telegramId} посмотрел рекламу заданий ${newQuestAdViews}/5, получил ${reward} CCC`);
      
      res.json({
        success: true,
        message: 'Награда за рекламу получена',
        quest_ad_views: newQuestAdViews,
        reward_ccc: reward
      });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Ошибка просмотра рекламы заданий:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сервера' 
    });
  }
});

// POST /api/quests/complete - отметить задание как выполненное
router.post('/complete', async (req, res) => {
  try {
    const { telegramId, questId } = req.body;
    
    if (!telegramId || !questId) {
      return res.status(400).json({ error: 'telegramId and questId are required' });
    }
    
    // Проверяем что задание еще не выполнено
    const existingResult = await pool.query(
      'SELECT * FROM player_quests WHERE telegram_id = $1 AND quest_id = $2',
      [telegramId, questId]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Quest already completed' });
    }
    
    // Получаем информацию о задании
    const questResult = await pool.query(
      'SELECT reward_cs FROM quests WHERE quest_id = $1',
      [questId]
    );
    
    if (questResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest not found' });
    }
    
    const rewardCs = questResult.rows[0].reward_cs;
    
    // Начинаем транзакцию
    await pool.query('BEGIN');
    
    try {
      // Отмечаем задание как выполненное
      await pool.query(
        'INSERT INTO player_quests (telegram_id, quest_id, completed, reward_cs) VALUES ($1, $2, true, $3)',
        [telegramId, questId, rewardCs]
      );
      
      // Добавляем CS игроку
      await pool.query(
        'UPDATE players SET cs = cs + $1 WHERE telegram_id = $2',
        [rewardCs, telegramId]
      );
      
      await pool.query('COMMIT');
      
      console.log(`✅ Игрок ${telegramId} выполнил задание ${questId}, получил ${rewardCs} CS`);
      res.json({ success: true, reward_cs: rewardCs });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Error completing quest:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;