const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/quests/:telegramId - получить задания для игрока
router.get('/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Получаем игрока с его registration_language и quest_link_states
    const playerResult = await pool.query(
      'SELECT registration_language, quest_link_states FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const registrationLanguage = playerResult.rows[0].registration_language || 'en';
    const questLinkStates = playerResult.rows[0].quest_link_states || {};
    
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
    
    // Обрабатываем состояния таймеров заданий
    const currentTime = new Date();
    const updatedLinkStates = { ...questLinkStates };
    
    // Проверяем и обновляем таймеры для каждого задания
    Object.keys(updatedLinkStates).forEach(questId => {
      const state = updatedLinkStates[questId];
      if (state.clicked_at && state.timer_remaining > 0) {
        const clickedTime = new Date(state.clicked_at);
        const elapsedSeconds = Math.floor((currentTime - clickedTime) / 1000);
        const remainingTime = Math.max(0, 30 - elapsedSeconds);
        
        updatedLinkStates[questId] = {
          ...state,
          timer_remaining: remainingTime,
          can_claim: remainingTime === 0
        };
      }
    });
    
    // Объединяем данные
    const quests = questsResult.rows.map(quest => ({
      ...quest,
      completed: completedQuestIds.includes(quest.quest_id),
      link_state: updatedLinkStates[quest.quest_id.toString()] || null
    }));
    
    console.log(`✅ Найдено ${quests.length} заданий для игрока ${telegramId}`);
    res.json({ success: true, quests, quest_link_states: updatedLinkStates });
    
  } catch (error) {
    console.error('Error fetching quests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quests/click_link - обработка клика по ссылке задания
router.post('/click_link', async (req, res) => {
  try {
    const { telegramId, questId } = req.body;
    
    if (!telegramId || !questId) {
      return res.status(400).json({ 
        success: false, 
        error: 'telegramId and questId are required' 
      });
    }
    
    // Проверяем существование игрока
    const playerResult = await pool.query(
      'SELECT quest_link_states FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Игрок не найден' 
      });
    }
    
    const questLinkStates = playerResult.rows[0].quest_link_states || {};
    const currentTime = new Date();
    
    // Обновляем состояние для этого задания
    questLinkStates[questId.toString()] = {
      clicked_at: currentTime.toISOString(),
      timer_remaining: 30,
      can_claim: false
    };
    
    // Сохраняем в базу данных
    await pool.query(
      'UPDATE players SET quest_link_states = $1 WHERE telegram_id = $2',
      [JSON.stringify(questLinkStates), telegramId]
    );
    
    console.log(`🔗 Игрок ${telegramId} кликнул по ссылке задания ${questId}`);
    
    res.json({
      success: true,
      message: 'Ссылка обработана',
      link_state: questLinkStates[questId.toString()]
    });
    
  } catch (error) {
    console.error('Ошибка обработки клика по ссылке:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сервера' 
    });
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
      'SELECT telegram_id, quest_ad_views, quest_ad_last_reset FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Игрок не найден' 
      });
    }
    
    const player = playerResult.rows[0];
    const currentTime = new Date();
    const today = currentTime.toDateString();
    const lastResetDate = player.quest_ad_last_reset ? new Date(player.quest_ad_last_reset).toDateString() : null;
    
    // Проверяем, нужно ли сбросить счетчик (новый день)
    let questAdViews = player.quest_ad_views || 0;
    if (lastResetDate !== today) {
      questAdViews = 0;
      console.log(`🔄 Сброс счетчика рекламы заданий для игрока ${telegramId}`);
    }
    
    // Проверяем дневной лимит (5 раз в день)
    if (questAdViews >= 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Дневной лимит просмотра рекламы заданий исчерпан' 
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
        SET quest_ad_views = $1, 
            quest_ad_last_reset = $2,
            ccc = ccc + $3
        WHERE telegram_id = $4
      `, [newQuestAdViews, currentTime, reward, telegramId]);
      
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
      'SELECT reward_cs, quest_type FROM quests WHERE quest_id = $1',
      [questId]
    );
    
    if (questResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest not found' });
    }
    
    const { reward_cs: rewardCs, quest_type: questType } = questResult.rows[0];
    
    // Для partner_link заданий проверяем состояние таймера
    if (questType === 'partner_link') {
      const playerResult = await pool.query(
        'SELECT quest_link_states FROM players WHERE telegram_id = $1',
        [telegramId]
      );
      
      if (playerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }
      
      const questLinkStates = playerResult.rows[0].quest_link_states || {};
      const linkState = questLinkStates[questId.toString()];
      
      if (!linkState || !linkState.can_claim) {
        return res.status(400).json({ error: 'Link timer not completed yet' });
      }
    }
    
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
      
      // Очищаем состояние ссылки для этого задания
      if (questType === 'partner_link') {
        const playerResult = await pool.query(
          'SELECT quest_link_states FROM players WHERE telegram_id = $1',
          [telegramId]
        );
        
        const questLinkStates = playerResult.rows[0].quest_link_states || {};
        delete questLinkStates[questId.toString()];
        
        await pool.query(
          'UPDATE players SET quest_link_states = $1 WHERE telegram_id = $2',
          [JSON.stringify(questLinkStates), telegramId]
        );
      }
      
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