const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/quests/:telegramId - получить задания для игрока
// В quests.js - ИСПРАВЛЯЕМ функцию GET /api/quests/:telegramId
// Заменяем существующую логику проверки сброса рекламы:

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
    
    // ✅ ИСПРАВЛЕНО: Более надежная проверка сброса рекламы
    const currentTime = new Date();
    const today = currentTime.toDateString();
    
    let questAdViews = player.quest_ad_views || 0;
    let needsReset = false;
    
    // Проверяем нужен ли сброс
    if (!player.quest_ad_last_reset) {
      // Если никогда не было сброса
      needsReset = true;
      console.log(`🔄 Первый сброс рекламы заданий для игрока ${telegramId}`);
    } else {
      const lastResetDate = new Date(player.quest_ad_last_reset).toDateString();
      if (lastResetDate !== today) {
        needsReset = true;
        console.log(`🔄 Сброс рекламы заданий для игрока ${telegramId} (${lastResetDate} → ${today})`);
      }
    }
    
    // Если нужен сброс - выполняем
    if (needsReset) {
      questAdViews = 0;
      
      await pool.query(
        'UPDATE players SET quest_ad_views = 0, quest_ad_last_reset = $1 WHERE telegram_id = $2',
        [currentTime, telegramId]
      );
      
      console.log(`✅ Сброс рекламы заданий выполнен для игрока ${telegramId}`);
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
      quest_ad_views: questAdViews // Актуальный счетчик после возможного сброса
    });
    
  } catch (error) {
    console.error('Error fetching quests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Добавляем в quests.js - ТЕСТОВЫЙ endpoint для проверки сброса
// (удалите после тестирования)

// POST /api/quests/test-daily-reset - ТЕСТОВЫЙ сброс рекламы заданий
router.post('/test-daily-reset', async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;
    
    // Проверяем админа
    if (!adminId || adminId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied - admin only' });
    }
    
    console.log('🧪 ТЕСТОВЫЙ сброс рекламы заданий запущен админом:', adminId);
    
    if (telegramId) {
      // Сброс для конкретного игрока
      const beforeResult = await pool.query(
        'SELECT telegram_id, quest_ad_views, quest_ad_last_reset FROM players WHERE telegram_id = $1',
        [telegramId]
      );
      
      if (beforeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }
      
      const before = beforeResult.rows[0];
      
      await pool.query(
        'UPDATE players SET quest_ad_views = 0, quest_ad_last_reset = NOW() WHERE telegram_id = $1',
        [telegramId]
      );
      
      const afterResult = await pool.query(
        'SELECT telegram_id, quest_ad_views, quest_ad_last_reset FROM players WHERE telegram_id = $1',
        [telegramId]
      );
      
      const after = afterResult.rows[0];
      
      res.json({
        success: true,
        message: 'Test reset completed for specific player',
        before: before,
        after: after
      });
      
    } else {
      // Сброс для всех игроков (как в cron job)
      const beforeStats = await pool.query(
        'SELECT COUNT(*) as total, SUM(quest_ad_views) as total_views FROM players WHERE quest_ad_views > 0'
      );
      
      const resetResult = await pool.query(`
        UPDATE players 
        SET quest_ad_views = 0, 
            quest_ad_last_reset = NOW()
        WHERE quest_ad_views > 0 
           OR quest_ad_last_reset::date < CURRENT_DATE
           OR quest_ad_last_reset IS NULL
      `);
      
      const afterStats = await pool.query(
        'SELECT COUNT(*) as total_with_views FROM players WHERE quest_ad_views > 0'
      );
      
      res.json({
        success: true,
        message: 'Test reset completed for all players',
        before_stats: beforeStats.rows[0],
        reset_count: resetResult.rowCount,
        after_stats: afterStats.rows[0]
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка тестового сброса:', error);
    res.status(500).json({ 
      error: 'Test reset failed', 
      details: error.message 
    });
  }
});

// GET /api/quests/check-reset-status/:telegramId - проверка статуса сброса
router.get('/check-reset-status/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    const result = await pool.query(
      'SELECT telegram_id, quest_ad_views, quest_ad_last_reset, first_name FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const player = result.rows[0];
    const currentTime = new Date();
    const today = currentTime.toDateString();
    
    let resetStatus = 'up_to_date';
    let shouldReset = false;
    
    if (!player.quest_ad_last_reset) {
      resetStatus = 'never_reset';
      shouldReset = true;
    } else {
      const lastResetDate = new Date(player.quest_ad_last_reset).toDateString();
      if (lastResetDate !== today) {
        resetStatus = 'needs_reset';
        shouldReset = true;
      }
    }
    
    res.json({
      success: true,
      player: {
        telegram_id: player.telegram_id,
        name: player.first_name,
        quest_ad_views: player.quest_ad_views,
        quest_ad_last_reset: player.quest_ad_last_reset
      },
      current_time: currentTime.toISOString(),
      today: today,
      last_reset_date: player.quest_ad_last_reset ? new Date(player.quest_ad_last_reset).toDateString() : null,
      reset_status: resetStatus,
      should_reset: shouldReset
    });
    
  } catch (error) {
    console.error('❌ Ошибка проверки статуса:', error);
    res.status(500).json({ error: 'Check failed', details: error.message });
  }
});





// POST /api/quests/click_link - обработка клика по ссылке задания
// POST /api/quests/click_link - обработка клика по ссылке задания
router.post('/click_link', async (req, res) => {
  try {
    const { telegramId, questId, quest_key } = req.body;

    // Поддерживаем и старый формат (questId) и новый (quest_key)
    const questIdentifier = quest_key || questId;

    if (!telegramId || !questIdentifier) {
      return res.status(400).json({
        success: false,
        error: 'telegramId and (questId or quest_key) are required'
      });
    }

    // Определяем тип и получаем настоящий ID из базы
    const isQuestKey = !!quest_key || isNaN(questIdentifier);
    let dbQuestId;

    if (isQuestKey) {
      const questResult = await pool.query(
        'SELECT id FROM quest_templates WHERE quest_key = $1 AND is_active = true',
        [questIdentifier]
      );
      
      if (questResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Quest not found' });
      }
      
      dbQuestId = questResult.rows[0].id;
    } else {
      dbQuestId = questIdentifier;
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

    // Обновляем состояние для этого задания (используем dbQuestId как ключ)
    questLinkStates[dbQuestId.toString()] = {
      clicked_at: currentTime.toISOString(),
      timer_remaining: 30,
      can_claim: false
    };

    // Сохраняем в базу данных
    await pool.query(
      'UPDATE players SET quest_link_states = $1 WHERE telegram_id = $2',
      [JSON.stringify(questLinkStates), telegramId]
    );

    console.log(`🔗 Игрок ${telegramId} кликнул по ссылке задания ${questIdentifier} (ID: ${dbQuestId})`);

    res.json({
      success: true,
      message: 'Ссылка обработана',
      link_state: questLinkStates[dbQuestId.toString()]
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
// В quests.js - обновляем POST /api/quests/complete
router.post('/complete', async (req, res) => {
  try {
    const { telegramId, questId, quest_key } = req.body;

    // Поддерживаем и старый формат (questId) и новый (quest_key)
    const questIdentifier = quest_key || questId;

    if (!telegramId || !questIdentifier) {
      return res.status(400).json({ error: 'telegramId and (questId or quest_key) are required' });
    }

    // Определяем тип идентификатора (ID или key)
    const isQuestKey = !!quest_key || isNaN(questIdentifier);

    // Проверяем статус задания
    let existingResult;
    if (isQuestKey) {
      // Ищем по quest_key через JOIN с quest_templates
      existingResult = await pool.query(`
        SELECT pq.*
        FROM player_quests pq
        JOIN quest_templates qt ON pq.quest_id = qt.id
        WHERE pq.telegram_id = $1 AND qt.quest_key = $2
      `, [telegramId, questIdentifier]);
    } else {
      existingResult = await pool.query(
        'SELECT * FROM player_quests WHERE telegram_id = $1 AND quest_id = $2',
        [telegramId, questIdentifier]
      );
    }

    // Если есть запись с completed = true - награда уже забрана
    if (existingResult.rows.length > 0 && existingResult.rows[0].completed === true) {
      return res.status(400).json({ error: 'Quest already completed and reward claimed' });
    }

    // Если есть запись с completed = false - это одобренная ручная проверка, разрешаем забрать
    const isReadyToClaim = existingResult.rows.length > 0 && existingResult.rows[0].completed === false;

    // Получаем информацию о задании
    let questResult, rewardCs, questType, dbQuestId;

    if (isQuestKey) {
      // Новая система - quest_templates
      questResult = await pool.query(
        'SELECT id, reward_cs, quest_type FROM quest_templates WHERE quest_key = $1 AND is_active = true',
        [questIdentifier]
      );

      if (questResult.rows.length === 0) {
        return res.status(404).json({ error: 'Quest not found' });
      }

      dbQuestId = questResult.rows[0].id;
      rewardCs = questResult.rows[0].reward_cs;
      questType = questResult.rows[0].quest_type;
    } else {
      // Старая система - quests (на всякий случай)
      questResult = await pool.query(
        'SELECT reward_cs, quest_type FROM quests WHERE quest_id = $1',
        [questIdentifier]
      );

      if (questResult.rows.length === 0) {
        return res.status(404).json({ error: 'Quest not found' });
      }

      dbQuestId = questIdentifier;
      rewardCs = questResult.rows[0].reward_cs;
      questType = questResult.rows[0].quest_type;
    }
    
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
      const linkState = questLinkStates[dbQuestId.toString()]; // Используем dbQuestId

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
      // Если это ready-to-claim (approved manual check), обновляем запись
      if (isReadyToClaim) {
        await pool.query(
          'UPDATE player_quests SET completed = true WHERE telegram_id = $1 AND quest_id = $2',
          [telegramId, dbQuestId]
        );
        console.log(`✅ Обновлена запись player_quests для ${telegramId}, quest ${dbQuestId}: completed = true`);
      } else {
        // Создаём новую запись для обычных квестов
        await pool.query(
          'INSERT INTO player_quests (telegram_id, quest_id, completed, reward_cs) VALUES ($1, $2, true, $3)',
          [telegramId, dbQuestId, rewardCs]
        );
        console.log(`✅ Создана новая запись player_quests для ${telegramId}, quest ${dbQuestId}`);
      }

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
          questLinkStates[dbQuestId.toString()] = {
            ...questLinkStates[dbQuestId.toString()],
            completed: true,
            completed_at: new Date().toISOString()
          };

          await pool.query(
            'UPDATE players SET quest_link_states = $1 WHERE telegram_id = $2',
            [JSON.stringify(questLinkStates), telegramId]
          );

          console.log(`✅ Задание ${questIdentifier} (ID: ${dbQuestId}) помечено как завершенное`);
        }
      }

      await pool.query('COMMIT');

      console.log(`✅ Игрок ${telegramId} выполнил задание ${questIdentifier} (ID: ${dbQuestId}), получил ${rewardCs} CS`);
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

// Добавляем в quests.js - НОВЫЙ API для тестирования мультиязычных заданий

// GET /api/quests/v2/:telegramId - новая версия с мультиязычностью
router.get('/v2/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { force_language } = req.query; // для тестирования принудительный язык
    
    console.log(`🆕 V2 API: Загрузка заданий для игрока ${telegramId}`);
    
    // Получаем игрока с его данными
    const playerResult = await pool.query(
      'SELECT registration_language, language, quest_link_states, quest_ad_views, quest_ad_last_reset FROM players WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const player = playerResult.rows[0];

    // Определяем ПЕРВОНАЧАЛЬНЫЙ язык игрока для фильтрации квестов (ВАЖНО!)
    const registrationLanguage = player.registration_language || player.language || 'en';

    // Определяем язык для ПЕРЕВОДОВ (может быть переключен игроком)
    const translationLanguage = force_language || player.language || registrationLanguage;

    console.log(`🌍 Язык регистрации (фильтр квестов): ${registrationLanguage}`);
    console.log(`🌍 Язык переводов: ${translationLanguage} ${force_language ? '(принудительно)' : ''}`);

    // Проверяем сброс рекламы (как в старом API)
    const currentTime = new Date();
    const today = currentTime.toDateString();
    let questAdViews = player.quest_ad_views || 0;
    let needsReset = false;
    
    if (!player.quest_ad_last_reset) {
      needsReset = true;
    } else {
      const lastResetDate = new Date(player.quest_ad_last_reset).toDateString();
      if (lastResetDate !== today) {
        needsReset = true;
      }
    }
    
    if (needsReset) {
      questAdViews = 0;
      await pool.query(
        'UPDATE players SET quest_ad_views = 0, quest_ad_last_reset = $1 WHERE telegram_id = $2',
        [currentTime, telegramId]
      );
      console.log(`🔄 V2: Сброс рекламы для игрока ${telegramId}`);
    }
    
    // 🆕 НОВАЯ ЛОГИКА: Загружаем задания из новых таблиц
    const questsResult = await pool.query(`
      SELECT
        qt.id,
        qt.quest_key,
        qt.quest_type,
        qt.reward_cs,
        qt.quest_data,
        qt.target_languages,
        qt.is_active,
        qt.sort_order,
        -- Пытаемся получить перевод на нужном языке ($1 = translationLanguage)
        COALESCE(
          qtr_user.quest_name,
          qtr_en.quest_name,
          qt.quest_key
        ) as quest_name,
        COALESCE(
          qtr_user.description,
          qtr_en.description,
          'No description available'
        ) as description,
        COALESCE(
          qtr_user.manual_check_user_instructions,
          qtr_en.manual_check_user_instructions
        ) as manual_check_user_instructions,
        -- Информация о языке перевода
        CASE
          WHEN qtr_user.language_code IS NOT NULL THEN qtr_user.language_code
          WHEN qtr_en.language_code IS NOT NULL THEN qtr_en.language_code
          ELSE 'no_translation'
        END as used_language
      FROM quest_templates qt
      -- Перевод на языке пользователя (для UI)
      LEFT JOIN quest_translations qtr_user ON qt.quest_key = qtr_user.quest_key
        AND qtr_user.language_code = $1
      -- Резервный английский перевод
      LEFT JOIN quest_translations qtr_en ON qt.quest_key = qtr_en.quest_key
        AND qtr_en.language_code = 'en'
      WHERE qt.is_active = true
        AND (
          qt.target_languages IS NULL
          OR $2 = ANY(qt.target_languages)
        )
      ORDER BY qt.sort_order, qt.id
    `, [translationLanguage, registrationLanguage]);
    
    // Получаем выполненные задания игрока
    const completedResult = await pool.query(
      'SELECT quest_id, quest_key, completed FROM player_quests WHERE telegram_id = $1',
      [telegramId]
    );

    const completedQuestIds = completedResult.rows.filter(r => r.completed).map(row => row.quest_id);
    const completedQuestKeys = completedResult.rows.filter(r => r.completed).map(row => row.quest_key).filter(Boolean);

    // Квесты готовые к сбору награды (completed = false в player_quests)
    const readyToClaimIds = completedResult.rows.filter(r => !r.completed).map(row => row.quest_id);
    const readyToClaimKeys = completedResult.rows.filter(r => !r.completed).map(row => row.quest_key).filter(Boolean);

    // Получаем pending заявки на ручную проверку
    const pendingSubmissions = await pool.query(
      'SELECT quest_key FROM manual_quest_submissions WHERE telegram_id = $1 AND status = $2',
      [telegramId, 'pending']
    );
    const pendingQuestKeys = pendingSubmissions.rows.map(row => row.quest_key);

    // Получаем rejected заявки (чтобы не показывать их как pending)
    const rejectedSubmissions = await pool.query(
      'SELECT quest_key FROM manual_quest_submissions WHERE telegram_id = $1 AND status = $2',
      [telegramId, 'rejected']
    );
    const rejectedQuestKeys = rejectedSubmissions.rows.map(row => row.quest_key);

    // Обрабатываем состояния таймеров (как в старом API)
    const questLinkStates = player.quest_link_states || {};
    const updatedLinkStates = { ...questLinkStates };

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
    const quests = questsResult.rows.map(quest => {
      const isCompleted = completedQuestIds.includes(quest.id) || completedQuestKeys.includes(quest.quest_key);
      const isReadyToClaim = readyToClaimIds.includes(quest.id) || readyToClaimKeys.includes(quest.quest_key);
      const isPending = pendingQuestKeys.includes(quest.quest_key);
      const isRejected = rejectedQuestKeys.includes(quest.quest_key);

      // Логика статуса:
      // 1. Если completed=true в player_quests - квест завершён, статус null (или можно вообще скрыть)
      // 2. Если completed=false в player_quests - готов к сбору награды
      // 3. Если pending в manual_quest_submissions - на проверке
      // 4. Если rejected - доступен снова (статус null, чтобы показать кнопку регистрации)
      let manualCheckStatus = null;
      if (isPending) {
        manualCheckStatus = 'pending';
      } else if (isReadyToClaim && !isCompleted) {
        manualCheckStatus = 'approved_unclaimed';
      }
      // Если rejected - оставляем null, чтобы квест показался как доступный

      return {
        // Для совместимости со старым API
        quest_id: quest.id,
        quest_name: quest.quest_name,
        quest_type: quest.quest_type,
        description: quest.description,
        reward_cs: quest.reward_cs,
        quest_data: quest.quest_data,
        completed: isCompleted,

        // Новые поля
        quest_key: quest.quest_key,
        target_languages: quest.target_languages,
        used_language: quest.used_language,
        manual_check_user_instructions: quest.manual_check_user_instructions,

        // Статусы для ручной проверки
        manual_check_status: manualCheckStatus
      };
    });
    
    const stats = {
      total_quests: quests.length,
      completed_quests: quests.filter(q => q.completed).length,
      available_quests: quests.filter(q => !q.completed).length,
      by_type: quests.reduce((acc, quest) => {
        acc[quest.quest_type] = (acc[quest.quest_type] || 0) + 1;
        return acc;
      }, {}),
      by_language: quests.reduce((acc, quest) => {
        acc[quest.used_language] = (acc[quest.used_language] || 0) + 1;
        return acc;
      }, {})
    };
    
    console.log(`🎯 V2: Загружено ${quests.length} заданий для игрока ${telegramId} (язык: ${translationLanguage})`);
    console.log(`📊 V2: Статистика:`, stats);

    res.json({
      success: true,
      version: 'v2',
      user_language: translationLanguage,
      registration_language: registrationLanguage,
      quests,
      quest_ad_views: questAdViews,
      stats
    });
    
  } catch (error) {
    console.error('❌ V2 Error fetching quests:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// GET /api/quests/test-languages/:telegramId - тест всех языков
router.get('/test-languages/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const supportedLanguages = ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'];
    
    const results = {};
    
    for (const lang of supportedLanguages) {
      try {
        // Делаем запрос к V2 API с принудительным языком
        const questsResult = await pool.query(`
          SELECT 
            qt.quest_key,
            qt.quest_type,
            qt.target_languages,
            COALESCE(
              qtr_user.quest_name, 
              qtr_en.quest_name, 
              qt.quest_key
            ) as quest_name,
            CASE 
              WHEN qtr_user.language_code IS NOT NULL THEN qtr_user.language_code
              WHEN qtr_en.language_code IS NOT NULL THEN qtr_en.language_code
              ELSE 'no_translation'
            END as used_language
          FROM quest_templates qt
          LEFT JOIN quest_translations qtr_user ON qt.quest_key = qtr_user.quest_key 
            AND qtr_user.language_code = $1
          LEFT JOIN quest_translations qtr_en ON qt.quest_key = qtr_en.quest_key 
            AND qtr_en.language_code = 'en'
          WHERE qt.is_active = true
            AND (
              qt.target_languages IS NULL 
              OR $1 = ANY(qt.target_languages)
            )
          ORDER BY qt.sort_order
        `, [lang]);
        
        results[lang] = {
          total_quests: questsResult.rows.length,
          quests: questsResult.rows.map(q => ({
            quest_key: q.quest_key,
            quest_name: q.quest_name,
            used_language: q.used_language,
            target_languages: q.target_languages
          }))
        };
        
      } catch (langError) {
        results[lang] = { error: langError.message };
      }
    }
    
    res.json({
      success: true,
      player_id: telegramId,
      language_test_results: results
    });
    
  } catch (error) {
    console.error('❌ Error testing languages:', error);
    res.status(500).json({ error: 'Language test failed', details: error.message });
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


// POST /api/quests/submit_manual_check - отправка данных для ручной проверки
router.post('/submit_manual_check', async (req, res) => {
  try {
    const { telegramId, questId, quest_key, userData } = req.body;

    if (!telegramId || (!questId && !quest_key) || !userData) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    const questIdentifier = quest_key || questId;
    const isQuestKey = !!quest_key || isNaN(questIdentifier);

    // Получаем информацию о задании
    let questResult, dbQuestId, questName;
    
    if (isQuestKey) {
      questResult = await pool.query(`
        SELECT qt.id, qtr.quest_name 
        FROM quest_templates qt
        LEFT JOIN quest_translations qtr 
          ON qt.quest_key = qtr.quest_key AND qtr.language_code = 'ru'
        WHERE qt.quest_key = $1 AND qt.is_active = true
      `, [questIdentifier]);
      
      if (questResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Quest not found' });
      }
      
      dbQuestId = questResult.rows[0].id;
      questName = questResult.rows[0].quest_name || questIdentifier;
    } else {
      return res.status(400).json({ success: false, error: 'Invalid quest identifier' });
    }

    // Проверяем, что задание еще не отправлено на проверку
    const existingSubmission = await pool.query(
      'SELECT * FROM manual_quest_submissions WHERE telegram_id = $1 AND quest_id = $2',
      [telegramId, dbQuestId]
    );

    if (existingSubmission.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Это задание уже отправлено на проверку' 
      });
    }

    // Получаем информацию об игроке
    const playerResult = await pool.query(
      'SELECT first_name, username FROM players WHERE telegram_id = $1',
      [telegramId]
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Сохраняем заявку на проверку
    await pool.query(`
      INSERT INTO manual_quest_submissions 
      (telegram_id, quest_id, quest_key, user_data, status, submitted_at)
      VALUES ($1, $2, $3, $4, 'pending', NOW())
    `, [telegramId, dbQuestId, questIdentifier, JSON.stringify(userData)]);

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
    const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '1222791281'; // Твой ID
    
    const adminMessage = `🔔 *НОВАЯ ЗАЯВКА НА ПРОВЕРКУ*\n\n` +
      `👤 Игрок: ${player.first_name} (@${player.username || 'no_username'})\n` +
      `🆔 Telegram ID: \`${telegramId}\`\n` +
      `📋 Задание: ${questName}\n` +
      `📝 Данные пользователя: \`${JSON.stringify(userData)}\`\n\n` +
      `Проверьте и одобрите в базе данных.`;
    
    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: ADMIN_TELEGRAM_ID,
        text: adminMessage,
        parse_mode: 'Markdown'
      });
      console.log('✅ Уведомление отправлено админу');
    } catch (telegramError) {
      console.error('❌ Ошибка отправки в Telegram:', telegramError);
    }

    // Возвращаем успешный ответ
    return res.status(200).json({ success: true, message: 'Отправлено на проверку' });

  } catch (error) {
    console.error('Ошибка при отправке на проверку:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
