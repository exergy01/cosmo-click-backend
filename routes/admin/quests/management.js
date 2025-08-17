// routes/admin/quests/management.js - ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ
const express = require('express');
const pool = require('../../../db');
const { isAdmin } = require('../auth'); // Убираем adminAuth, используем только isAdmin

const router = express.Router();

// 🛡️ Кастомная проверка админа для квестов (без общего middleware)
const checkQuestAdmin = (req, res, next) => {
  const telegramId = req.params.telegramId;
  
  console.log('🔐 Проверка админских прав для квестов:', { 
    telegramId, 
    url: req.url,
    method: req.method 
  });
  
  if (!telegramId) {
    console.log('🚫 Telegram ID не предоставлен в параметрах');
    return res.status(400).json({ error: 'Telegram ID is required' });
  }
  
  if (!isAdmin(telegramId)) {
    console.log('🚫 Доступ к квестам запрещен - не админ:', telegramId);
    return res.status(403).json({ error: 'Access denied - admin rights required' });
  }
  
  console.log('✅ Админ права для квестов подтверждены:', telegramId);
  next();
};

// 📋 GET /list/:telegramId - список всех заданий
router.get('/list/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    console.log(`📋 Админ ${telegramId} запросил список заданий`);
    
    // Получаем все шаблоны заданий с переводами
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
        qt.manual_check_instructions,
        qt.created_at,
        qt.created_by,
        -- Считаем количество переводов
        COUNT(qtr.language_code) as translations_count,
        -- Получаем список языков переводов
        ARRAY_AGG(qtr.language_code ORDER BY qtr.language_code) FILTER (WHERE qtr.language_code IS NOT NULL) as available_languages,
        -- Получаем английское название для отображения
        MAX(CASE WHEN qtr.language_code = 'en' THEN qtr.quest_name END) as english_name
      FROM quest_templates qt
      LEFT JOIN quest_translations qtr ON qt.quest_key = qtr.quest_key
      GROUP BY qt.id, qt.quest_key, qt.quest_type, qt.reward_cs, qt.quest_data, 
               qt.target_languages, qt.is_active, qt.sort_order, 
               qt.manual_check_instructions, qt.created_at, qt.created_by
      ORDER BY qt.sort_order, qt.id
    `);
    
    // Получаем статистику выполнения для каждого задания
    let completionStats = { rows: [] };
    try {
      completionStats = await pool.query(`
        SELECT 
          q.quest_id,
          qt.quest_key,
          COUNT(*) as total_completions,
          COUNT(DISTINCT pq.telegram_id) as unique_players
        FROM quest_templates qt
        LEFT JOIN quests q ON q.quest_name = qt.quest_key OR CAST(q.quest_id AS VARCHAR) = qt.quest_key
        LEFT JOIN player_quests pq ON pq.quest_id = q.quest_id AND pq.completed = true
        GROUP BY q.quest_id, qt.quest_key
      `);
    } catch (statsError) {
      console.log('⚠️ Не удалось загрузить статистику выполнения квестов:', statsError.message);
    }
    
    const statsMap = {};
    completionStats.rows.forEach(stat => {
      if (stat.quest_key) {
        statsMap[stat.quest_key] = {
          total_completions: parseInt(stat.total_completions) || 0,
          unique_players: parseInt(stat.unique_players) || 0
        };
      }
    });
    
    const questsWithStats = questsResult.rows.map(quest => ({
      ...quest,
      stats: statsMap[quest.quest_key] || { total_completions: 0, unique_players: 0 }
    }));
    
    console.log(`📋 Админ ${telegramId} получил список заданий: ${questsWithStats.length} найдено`);
    
    res.json({
      success: true,
      quests: questsWithStats,
      total_quests: questsWithStats.length,
      active_quests: questsWithStats.filter(q => q.is_active).length,
      inactive_quests: questsWithStats.filter(q => !q.is_active).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения списка заданий:', error);
    res.status(500).json({ error: 'Failed to fetch quests', details: error.message });
  }
});

// ✏️ GET /get/:questKey/:telegramId - получить детали задания
router.get('/get/:questKey/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    
    console.log(`✏️ Админ ${telegramId} запросил детали задания: ${questKey}`);
    
    // Получаем шаблон задания
    const templateResult = await pool.query(
      'SELECT * FROM quest_templates WHERE quest_key = $1',
      [questKey]
    );
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest template not found' });
    }
    
    // Получаем все переводы
    const translationsResult = await pool.query(
      'SELECT * FROM quest_translations WHERE quest_key = $1 ORDER BY language_code',
      [questKey]
    );
    
    const template = templateResult.rows[0];
    const translations = {};
    
    translationsResult.rows.forEach(translation => {
      translations[translation.language_code] = {
        quest_name: translation.quest_name,
        description: translation.description,
        manual_check_user_instructions: translation.manual_check_user_instructions
      };
    });
    
    console.log(`✏️ Админ ${telegramId} получил детали задания: ${questKey}`);
    
    res.json({
      success: true,
      template: template,
      translations: translations,
      supported_languages: ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения деталей задания:', error);
    res.status(500).json({ error: 'Failed to fetch quest details', details: error.message });
  }
});

// ➕ POST /create/:telegramId - создать новое задание
router.post('/create/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { 
      quest_key, 
      quest_type, 
      reward_cs, 
      quest_data, 
      target_languages, 
      sort_order,
      manual_check_instructions,
      translations 
    } = req.body;
    
    console.log(`➕ Админ ${telegramId} создает новое задание: ${quest_key}`);
    
    // Валидация данных
    if (!quest_key || !quest_type || !reward_cs || !translations) {
      return res.status(400).json({ error: 'Missing required fields: quest_key, quest_type, reward_cs, translations' });
    }
    
    if (!translations.en || !translations.en.quest_name || !translations.en.description) {
      return res.status(400).json({ error: 'English translation is required (quest_name and description)' });
    }
    
    // Проверяем что quest_key уникален
    const existingResult = await pool.query(
      'SELECT quest_key FROM quest_templates WHERE quest_key = $1',
      [quest_key]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Quest key already exists' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Создаем шаблон задания
      const templateResult = await client.query(`
        INSERT INTO quest_templates (
          quest_key, quest_type, reward_cs, quest_data, 
          target_languages, sort_order, manual_check_instructions, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        quest_key,
        quest_type,
        reward_cs,
        quest_data ? JSON.stringify(quest_data) : null,
        target_languages,
        sort_order || 999,
        manual_check_instructions,
        telegramId
      ]);
      
      // Создаем переводы
      const supportedLanguages = ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'];
      let translationsCreated = 0;
      
      for (const lang of supportedLanguages) {
        if (translations[lang] && translations[lang].quest_name && translations[lang].description) {
          await client.query(`
            INSERT INTO quest_translations (
              quest_key, language_code, quest_name, description, manual_check_user_instructions
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            quest_key,
            lang,
            translations[lang].quest_name,
            translations[lang].description,
            translations[lang].manual_check_user_instructions || null
          ]);
          translationsCreated++;
        }
      }
      
      await client.query('COMMIT');
      
      console.log(`✅ Админ ${telegramId} создал новое задание: ${quest_key} (${quest_type}) с ${translationsCreated} переводами`);
      
      res.json({
        success: true,
        message: 'Quest created successfully',
        quest: templateResult.rows[0],
        translations_created: translationsCreated,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка создания задания:', error);
    res.status(500).json({ error: 'Failed to create quest', details: error.message });
  }
});

// ✏️ PUT /update/:questKey/:telegramId - обновить задание
router.put('/update/:questKey/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    const { 
      quest_type, 
      reward_cs, 
      quest_data, 
      target_languages, 
      sort_order,
      is_active,
      manual_check_instructions,
      translations 
    } = req.body;
    
    console.log(`✏️ Админ ${telegramId} обновляет задание: ${questKey}`);
    
    // Проверяем что задание существует
    const existingResult = await pool.query(
      'SELECT * FROM quest_templates WHERE quest_key = $1',
      [questKey]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest template not found' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Обновляем шаблон задания
      const templateResult = await client.query(`
        UPDATE quest_templates SET
          quest_type = COALESCE($1, quest_type),
          reward_cs = COALESCE($2, reward_cs),
          quest_data = COALESCE($3, quest_data),
          target_languages = COALESCE($4, target_languages),
          sort_order = COALESCE($5, sort_order),
          is_active = COALESCE($6, is_active),
          manual_check_instructions = COALESCE($7, manual_check_instructions)
        WHERE quest_key = $8
        RETURNING *
      `, [
        quest_type,
        reward_cs,
        quest_data ? JSON.stringify(quest_data) : null,
        target_languages,
        sort_order,
        is_active,
        manual_check_instructions,
        questKey
      ]);
      
      // Обновляем переводы (если предоставлены)
      let translationsUpdated = 0;
      if (translations) {
        const supportedLanguages = ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'];
        
        for (const lang of supportedLanguages) {
          if (translations[lang] && translations[lang].quest_name && translations[lang].description) {
            // Обновляем или создаем перевод
            await client.query(`
              INSERT INTO quest_translations (
                quest_key, language_code, quest_name, description, manual_check_user_instructions
              ) VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (quest_key, language_code) 
              DO UPDATE SET
                quest_name = EXCLUDED.quest_name,
                description = EXCLUDED.description,
                manual_check_user_instructions = EXCLUDED.manual_check_user_instructions
            `, [
              questKey,
              lang,
              translations[lang].quest_name,
              translations[lang].description,
              translations[lang].manual_check_user_instructions || null
            ]);
            translationsUpdated++;
          }
        }
      }
      
      await client.query('COMMIT');
      
      console.log(`✅ Админ ${telegramId} обновил задание: ${questKey} (переводов: ${translationsUpdated})`);
      
      res.json({
        success: true,
        message: 'Quest updated successfully',
        quest: templateResult.rows[0],
        translations_updated: translationsUpdated,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка обновления задания:', error);
    res.status(500).json({ error: 'Failed to update quest', details: error.message });
  }
});

// 🗑️ DELETE /delete/:questKey/:telegramId - удалить задание
router.delete('/delete/:questKey/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    
    console.log(`🗑️ Админ ${telegramId} удаляет задание: ${questKey}`);
    
    // Проверяем что задание существует
    const existingResult = await pool.query(
      'SELECT * FROM quest_templates WHERE quest_key = $1',
      [questKey]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest template not found' });
    }
    
    // Проверяем сколько игроков выполнили это задание
    let completionCount = 0;
    try {
      const completionsResult = await pool.query(`
        SELECT COUNT(*) as completion_count
        FROM player_quests pq
        JOIN quests q ON pq.quest_id = q.quest_id
        WHERE q.quest_name = $1 OR CAST(q.quest_id AS VARCHAR) = $1
      `, [questKey]);
      
      completionCount = parseInt(completionsResult.rows[0]?.completion_count) || 0;
    } catch (completionError) {
      console.log('⚠️ Не удалось получить статистику выполнений:', completionError.message);
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Удаляем переводы (каскадное удаление)
      const translationsResult = await client.query(
        'DELETE FROM quest_translations WHERE quest_key = $1',
        [questKey]
      );
      
      // Удаляем шаблон
      const templateResult = await client.query(
        'DELETE FROM quest_templates WHERE quest_key = $1 RETURNING *',
        [questKey]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅ Админ ${telegramId} удалил задание: ${questKey} (было ${completionCount} выполнений, ${translationsResult.rowCount} переводов)`);
      
      res.json({
        success: true,
        message: 'Quest deleted successfully',
        deleted_quest: templateResult.rows[0],
        deleted_translations: translationsResult.rowCount,
        completion_count: completionCount,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка удаления задания:', error);
    res.status(500).json({ error: 'Failed to delete quest', details: error.message });
  }
});

// 🔄 POST /toggle-status/:questKey/:telegramId - переключить активность
router.post('/toggle-status/:questKey/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    
    console.log(`🔄 Админ ${telegramId} переключает статус задания: ${questKey}`);
    
    const result = await pool.query(`
      UPDATE quest_templates 
      SET is_active = NOT is_active 
      WHERE quest_key = $1 
      RETURNING quest_key, is_active
    `, [questKey]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quest template not found' });
    }
    
    const quest = result.rows[0];
    const status = quest.is_active ? 'активировано' : 'деактивировано';
    
    console.log(`✅ Админ ${telegramId} ${status} задание: ${questKey}`);
    
    res.json({
      success: true,
      message: `Quest ${status} successfully`,
      quest_key: quest.quest_key,
      is_active: quest.is_active,
      status: status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка переключения статуса:', error);
    res.status(500).json({ error: 'Failed to toggle quest status', details: error.message });
  }
});

// 📊 GET /stats/:telegramId - статистика квестов
router.get('/stats/:telegramId', checkQuestAdmin, async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    console.log(`📊 Админ ${telegramId} запросил статистику квестов`);
    
    // Общая статистика заданий
    const questStats = await pool.query(`
      SELECT 
        COUNT(*) as total_quests,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_quests,
        COUNT(CASE WHEN is_scheduled = true THEN 1 END) as scheduled_quests,
        COUNT(CASE WHEN quest_type = 'manual_check' THEN 1 END) as manual_check_quests,
        COUNT(CASE WHEN quest_type = 'automatic' THEN 1 END) as automatic_quests,
        COALESCE(AVG(reward_cs), 0) as avg_reward_cs,
        COALESCE(SUM(reward_cs), 0) as total_reward_cs
      FROM quest_templates
    `);
    
    // Статистика переводов
    const translationStats = await pool.query(`
      SELECT 
        language_code,
        COUNT(*) as quest_count
      FROM quest_translations
      GROUP BY language_code
      ORDER BY quest_count DESC
    `);
    
    // Топ заданий по выполнениям (если таблицы доступны)
    let topQuests = { rows: [] };
    try {
      topQuests = await pool.query(`
        SELECT 
          qt.quest_key,
          qt.quest_type,
          qt.reward_cs,
          qt.is_active,
          COUNT(pq.telegram_id) as completion_count,
          COUNT(DISTINCT pq.telegram_id) as unique_players
        FROM quest_templates qt
        LEFT JOIN quests q ON q.quest_name = qt.quest_key
        LEFT JOIN player_quests pq ON pq.quest_id = q.quest_id AND pq.completed = true
        GROUP BY qt.quest_key, qt.quest_type, qt.reward_cs, qt.is_active
        ORDER BY completion_count DESC
        LIMIT 10
      `);
    } catch (topError) {
      console.log('⚠️ Не удалось загрузить топ заданий:', topError.message);
    }
    
    res.json({
      success: true,
      quest_stats: questStats.rows[0],
      translation_stats: translationStats.rows,
      top_quests: topQuests.rows,
      supported_languages: ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики квестов:', error);
    res.status(500).json({ error: 'Failed to get quest statistics', details: error.message });
  }
});

module.exports = router;