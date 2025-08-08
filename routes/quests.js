const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/quests/:telegramId - получить задания для игрока
router.get('/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Получаем игрока с его данными
    const playerResult = await pool.query(
      'SELECT registration_language, quest_link_states, quest_ad_views, quest_ad_last_reset FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const player = playerResult.rows[0];
    const registrationLanguage = player.registration_language || 'en';
    const questLinkStates = player.quest_link_states || {};
    
    // ✅ ДОБАВЛЕНО: Проверка сброса рекламы при каждом запросе заданий
    const currentTime = new Date();
    const today = currentTime.toDateString();
    const lastResetDate = player.quest_ad_last_reset ? new Date(player.quest_ad_last_reset).toDateString() : null;
    
    let questAdViews = player.quest_ad_views || 0;
    
    // Если новый день - сбрасываем счетчик
    if (lastResetDate !== today) {
      questAdViews = 0;
      console.log(`🔄 Сброс счетчика рекламы заданий для игрока ${telegramId} (${lastResetDate} → ${today})`);
      
      // Обновляем в базе данных
      await pool.query(
        'UPDATE players SET quest_ad_views = 0, quest_ad_last_reset = $1 WHERE telegram_id = $2',
        [currentTime, telegramId]
      );
    }
    
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
    const updatedLinkStates = { ...questLinkStates };
    
    // Проверяем завершенные таймеры
    Object.keys(updatedLinkStates).forEach(questId => {
      const state = updatedLinkStates[questId];
      if (state.clicked_at) {
        const clickedTime = new Date(state.clicked_at);
        const elapsedSeconds = Math.floor((currentTime - clickedTime) / 1000);
        const isCompleted = elapsedSeconds >= 30;
        
        updatedLinkStates[questId] = {
          ...state,
          timer_remaining: Math.max(0, 30 - elapsedSeconds),
          can_claim: isCompleted
        };
      }
    });
    
    // Объединяем данные
    const quests = questsResult.rows.map(quest => ({
      ...quest,
      completed: completedQuestIds.includes(quest.quest_id)
    }));
    
    console.log(`🎯 Загружаем задания для игрока ${telegramId} (${quests.length} найдено, язык: ${registrationLanguage}), реклама заданий: ${questAdViews}/5`);
    
    // ✅ ВАЖНО: Возвращаем актуальный quest_ad_views
    res.json({ 
      success: true, 
      quests,
      quest_ad_views: questAdViews // Добавляем актуальный счетчик
    });
    
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
      
      // Проверяем, прошло ли 30 секунд с момента клика
      if (!linkState || !linkState.clicked_at) {
        return res.status(400).json({ error: 'Link was not clicked yet' });
      }
      
      const clickedTime = new Date(linkState.clicked_at);
      const currentTime = new Date();
      const elapsedSeconds = Math.floor((currentTime - clickedTime) / 1000);
      
      if (elapsedSeconds < 30) {
        return res.status(400).json({ 
          error: `Link timer not completed yet. Wait ${30 - elapsedSeconds} more seconds.`,
          remainingSeconds: 30 - elapsedSeconds
        });
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
      
      // Очищаем состояние ссылки для этого задания ТОЛЬКО если это partner_link
      if (questType === 'partner_link') {
        const playerResult = await pool.query(
          'SELECT quest_link_states FROM players WHERE telegram_id = $1',
          [telegramId]
        );
        
        if (playerResult.rows.length > 0) {
          const questLinkStates = playerResult.rows[0].quest_link_states || {};
          
          // Помечаем задание как завершенное, а не удаляем состояние
          questLinkStates[questId.toString()] = {
            ...questLinkStates[questId.toString()],
            completed: true,
            completed_at: new Date().toISOString()
          };
          
          await pool.query(
            'UPDATE players SET quest_link_states = $1 WHERE telegram_id = $2',
            [JSON.stringify(questLinkStates), telegramId]
          );
          
          console.log(`✅ Задание ${questId} помечено как завершенное`);
        }
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

// ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ ОТЛАДКИ - удалите после исправления
router.get('/debug/:telegramId/:questId', async (req, res) => {
  try {
    const { telegramId, questId } = req.params;
    
    const result = await pool.query(
      'SELECT quest_link_states FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ error: 'Player not found' });
    }
    
    const questLinkStates = result.rows[0].quest_link_states || {};
    const linkState = questLinkStates[questId.toString()];
    
    if (!linkState) {
      return res.json({ 
        message: 'No link state found',
        allStates: questLinkStates
      });
    }
    
    const clickedTime = new Date(linkState.clicked_at);
    const currentTime = new Date();
    const elapsedSeconds = Math.floor((currentTime - clickedTime) / 1000);
    
    res.json({
      questId: questId,
      linkState: linkState,
      clickedTime: clickedTime.toISOString(),
      currentTime: currentTime.toISOString(),
      elapsedSeconds: elapsedSeconds,
      canClaim: elapsedSeconds >= 30,
      allStates: questLinkStates
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;