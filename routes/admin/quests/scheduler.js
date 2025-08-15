// routes/admin/quests/scheduler.js - Модуль планировщика заданий (ПОЛНОСТЬЮ ИСПРАВЛЕНО)
const express = require('express');
const pool = require('../../../db');
const { isAdmin } = require('../auth');

const router = express.Router();

// 📅 Вспомогательная функция для вычисления следующей активации
function calculateNextActivation(pattern, time, startDate) {
  const now = new Date();
  const [hours, minutes] = (time || '09:00').split(':').map(Number);
  
  let nextDate = new Date();
  nextDate.setHours(hours, minutes, 0, 0);
  
  // Если время сегодня уже прошло, начинаем с завтра
  if (nextDate <= now) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  
  // Если указана дата начала и она в будущем
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(hours, minutes, 0, 0);
    if (start > nextDate) {
      nextDate = start;
    }
  }
  
  switch (pattern) {
    case 'daily':
      // Каждый день в указанное время
      break;
      
    case 'weekly':
      // Каждую неделю в тот же день недели
      const daysUntilNext = (7 - nextDate.getDay()) % 7 || 7;
      nextDate.setDate(nextDate.getDate() + daysUntilNext);
      break;
      
    case 'weekdays':
      // Только в будние дни (пн-пт)
      while (nextDate.getDay() === 0 || nextDate.getDay() === 6) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      break;
      
    case 'weekends':
      // Только в выходные (сб-вс)
      while (nextDate.getDay() !== 0 && nextDate.getDay() !== 6) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      break;
      
    default:
      // По умолчанию - ежедневно
      break;
  }
  
  return nextDate;
}

// 📅 GET /overview/:telegramId - Обзор планировщика
router.get('/overview/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Проверка админа
    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    console.log('📅 Админ запросил обзор планировщика заданий');
    
    // Получаем статистику запланированных заданий
    const scheduledQuests = await pool.query(`
      SELECT 
        COUNT(*) as total_scheduled,
        COUNT(CASE WHEN schedule_status = 'active' THEN 1 END) as active_schedules,
        COUNT(CASE WHEN schedule_status = 'paused' THEN 1 END) as paused_schedules,
        COUNT(CASE WHEN auto_activate = true THEN 1 END) as auto_activate_count,
        COUNT(CASE WHEN next_scheduled_activation IS NOT NULL THEN 1 END) as pending_activations
      FROM quest_templates 
      WHERE is_scheduled = true
    `);
    
    // Ближайшие активации (следующие 24 часа)
    const upcomingActivations = await pool.query(`
      SELECT 
        quest_key,
        quest_type,
        schedule_type,
        schedule_pattern,
        next_scheduled_activation,
        schedule_status
      FROM quest_templates 
      WHERE is_scheduled = true 
        AND next_scheduled_activation IS NOT NULL 
        AND next_scheduled_activation BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
      ORDER BY next_scheduled_activation ASC
      LIMIT 10
    `);
    
    // История за последние 24 часа
    const recentHistory = await pool.query(`
      SELECT 
        quest_key,
        action_type,
        status,
        actual_time,
        error_message
      FROM quest_scheduler_history 
      WHERE actual_time > NOW() - INTERVAL '24 hours'
      ORDER BY actual_time DESC
      LIMIT 20
    `);
    
    // Статистика по типам расписания
    const scheduleTypeStats = await pool.query(`
      SELECT 
        schedule_type,
        COUNT(*) as count,
        COUNT(CASE WHEN schedule_status = 'active' THEN 1 END) as active_count
      FROM quest_templates 
      WHERE is_scheduled = true
      GROUP BY schedule_type
    `);
    
    res.json({
      success: true,
      overview: scheduledQuests.rows[0],
      upcoming_activations: upcomingActivations.rows,
      recent_history: recentHistory.rows,
      schedule_type_stats: scheduleTypeStats.rows,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка обзора планировщика:', error);
    res.status(500).json({ error: 'Failed to get scheduler overview', details: error.message });
  }
});

// 📅 POST /create-schedule/:telegramId - Создать расписание
router.post('/create-schedule/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { 
      quest_key, 
      schedule_type, 
      schedule_pattern, 
      schedule_time,
      start_date,
      end_date,
      auto_activate,
      auto_deactivate,
      metadata 
    } = req.body;
    
    // Проверка админа
    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Валидация данных
    if (!quest_key || !schedule_type || !schedule_pattern) {
      return res.status(400).json({ error: 'Missing required fields: quest_key, schedule_type, schedule_pattern' });
    }
    
    console.log(`📅 Создание расписания для задания: ${quest_key}`);
    
    await pool.query('BEGIN');
    
    try {
      // Проверяем существование задания
      const questExists = await pool.query(
        'SELECT id FROM quest_templates WHERE quest_key = $1',
        [quest_key]
      );
      
      if (questExists.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ error: 'Quest template not found' });
      }
      
      const questTemplateId = questExists.rows[0].id;
      
      // Вычисляем первую активацию
      const nextActivation = calculateNextActivation(schedule_pattern, schedule_time, start_date);
      
      // Обновляем задание с расписанием
      await pool.query(`
        UPDATE quest_templates SET
          is_scheduled = true,
          schedule_type = $1,
          schedule_pattern = $2,
          schedule_time = $3,
          schedule_start_date = $4,
          schedule_end_date = $5,
          auto_activate = $6,
          auto_deactivate = $7,
          schedule_metadata = $8,
          next_scheduled_activation = $9,
          schedule_status = 'active'
        WHERE quest_key = $10
      `, [
        schedule_type,
        schedule_pattern,
        schedule_time,
        start_date,
        end_date,
        auto_activate || false,
        auto_deactivate || false,
        JSON.stringify(metadata || {}),
        nextActivation,
        quest_key
      ]);
      
      // Логируем создание расписания
      await pool.query(`
        INSERT INTO quest_scheduler_history (
          quest_key, quest_template_id, action_type, scheduled_time, 
          status, details, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        quest_key,
        questTemplateId,
        'scheduled',
        nextActivation,
        'completed',
        JSON.stringify({
          admin_id: telegramId,
          schedule_type,
          schedule_pattern,
          auto_activate,
          created_at: new Date().toISOString()
        }),
        'admin'
      ]);
      
      await pool.query('COMMIT');
      
      console.log(`✅ Расписание создано для ${quest_key}, следующая активация: ${nextActivation}`);
      
      res.json({
        success: true,
        message: 'Schedule created successfully',
        quest_key,
        next_activation: nextActivation,
        schedule_status: 'active'
      });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Ошибка создания расписания:', error);
    res.status(500).json({ error: 'Failed to create schedule', details: error.message });
  }
});

// 📅 POST /toggle-schedule/:telegramId - Включить/выключить расписание
router.post('/toggle-schedule/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { quest_key, action } = req.body; // action: 'pause', 'resume', 'stop'
    
    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!quest_key || !action) {
      return res.status(400).json({ error: 'Missing quest_key or action' });
    }
    
    console.log(`📅 ${action.toUpperCase()} расписания для ${quest_key}`);
    
    let newStatus;
    let nextActivation = null;
    
    switch (action) {
      case 'pause':
        newStatus = 'paused';
        break;
      case 'resume':
        newStatus = 'active';
        // Пересчитываем следующую активацию
        const questData = await pool.query(
          'SELECT schedule_pattern, schedule_time, schedule_start_date FROM quest_templates WHERE quest_key = $1',
          [quest_key]
        );
        if (questData.rows.length > 0) {
          const { schedule_pattern, schedule_time, schedule_start_date } = questData.rows[0];
          nextActivation = calculateNextActivation(schedule_pattern, schedule_time, schedule_start_date);
        }
        break;
      case 'stop':
        newStatus = 'inactive';
        break;
      default:
        return res.status(400).json({ error: 'Invalid action. Use: pause, resume, stop' });
    }
    
    await pool.query(`
      UPDATE quest_templates 
      SET schedule_status = $1, next_scheduled_activation = $2
      WHERE quest_key = $3
    `, [newStatus, nextActivation, quest_key]);
    
    // Логируем действие
    await pool.query(`
      INSERT INTO quest_scheduler_history (
        quest_key, action_type, scheduled_time, status, details, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      quest_key,
      action,
      new Date(),
      'completed',
      JSON.stringify({ admin_id: telegramId, new_status: newStatus }),
      'admin'
    ]);
    
    res.json({
      success: true,
      message: `Schedule ${action}d successfully`,
      quest_key,
      new_status: newStatus,
      next_activation: nextActivation
    });
    
  } catch (error) {
    console.error('❌ Ошибка управления расписанием:', error);
    res.status(500).json({ error: 'Failed to toggle schedule', details: error.message });
  }
});

// 📅 GET /list/:telegramId - Список всех расписаний
router.get('/list/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    console.log('📅 Запрос списка всех расписаний');
    
    const schedules = await pool.query(`
      SELECT 
        qt.quest_key,
        qt.quest_type,
        qt.reward_cs,
        qt.is_active,
        qt.is_scheduled,
        qt.schedule_type,
        qt.schedule_pattern,
        qt.schedule_time,
        qt.schedule_start_date,
        qt.schedule_end_date,
        qt.auto_activate,
        qt.auto_deactivate,
        qt.schedule_status,
        qt.next_scheduled_activation,
        qt.last_scheduled_activation,
        qt.schedule_metadata,
        -- Получаем английское название
        COALESCE(qtr.quest_name, qt.quest_key) as quest_name,
        -- Статистика активаций
        (SELECT COUNT(*) FROM quest_scheduler_history qsh 
         WHERE qsh.quest_key = qt.quest_key AND qsh.action_type = 'activated') as total_activations,
        (SELECT COUNT(*) FROM quest_scheduler_history qsh 
         WHERE qsh.quest_key = qt.quest_key AND qsh.status = 'failed') as failed_activations
      FROM quest_templates qt
      LEFT JOIN quest_translations qtr ON qt.quest_key = qtr.quest_key AND qtr.language_code = 'en'
      WHERE qt.is_scheduled = true
      ORDER BY 
        CASE qt.schedule_status 
          WHEN 'active' THEN 1 
          WHEN 'paused' THEN 2 
          ELSE 3 
        END,
        qt.next_scheduled_activation ASC NULLS LAST
    `);
    
    res.json({
      success: true,
      schedules: schedules.rows,
      total_count: schedules.rows.length,
      active_count: schedules.rows.filter(s => s.schedule_status === 'active').length,
      paused_count: schedules.rows.filter(s => s.schedule_status === 'paused').length
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения списка расписаний:', error);
    res.status(500).json({ error: 'Failed to get schedules list', details: error.message });
  }
});

// 📅 POST /test-activation/:telegramId - Тестовая активация
router.post('/test-activation/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { quest_key } = req.body;
    
    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!quest_key) {
      return res.status(400).json({ error: 'Missing quest_key' });
    }
    
    console.log(`🧪 Тестовая активация задания: ${quest_key}`);
    
    await pool.query('BEGIN');
    
    try {
      // Получаем данные задания
      const questData = await pool.query(
        'SELECT id, is_active, is_scheduled FROM quest_templates WHERE quest_key = $1',
        [quest_key]
      );
      
      if (questData.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ error: 'Quest not found' });
      }
      
      const quest = questData.rows[0];
      const wasActive = quest.is_active;
      
      // Активируем задание
      await pool.query(
        'UPDATE quest_templates SET is_active = true WHERE quest_key = $1',
        [quest_key]
      );
      
      // Логируем тестовую активацию
      await pool.query(`
        INSERT INTO quest_scheduler_history (
          quest_key, quest_template_id, action_type, scheduled_time, 
          status, details, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        quest_key,
        quest.id,
        'test_activation',
        new Date(),
        'completed',
        JSON.stringify({
          admin_id: telegramId,
          was_active_before: wasActive,
          test_activation: true
        }),
        'admin'
      ]);
      
      await pool.query('COMMIT');
      
      console.log(`✅ Тестовая активация выполнена для ${quest_key}`);
      
      res.json({
        success: true,
        message: 'Test activation completed',
        quest_key,
        was_active_before: wasActive,
        now_active: true,
        test_mode: true
      });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Ошибка тестовой активации:', error);
    res.status(500).json({ error: 'Test activation failed', details: error.message });
  }
});

// 📅 GET /history/:telegramId - История планировщика
router.get('/history/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { quest_key, days = 7, action_type } = req.query;
    
    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    console.log('📅 Запрос истории планировщика');
    
    let whereConditions = ['qsh.actual_time > NOW() - INTERVAL $1 days'];
    let queryParams = [days];
    let paramIndex = 2;
    
    if (quest_key) {
      whereConditions.push(`qsh.quest_key = $${paramIndex}`);
      queryParams.push(quest_key);
      paramIndex++;
    }
    
    if (action_type) {
      whereConditions.push(`qsh.action_type = $${paramIndex}`);
      queryParams.push(action_type);
      paramIndex++;
    }
    
    const history = await pool.query(`
      SELECT 
        qsh.*,
        qt.quest_type,
        COALESCE(qtr.quest_name, qsh.quest_key) as quest_name
      FROM quest_scheduler_history qsh
      LEFT JOIN quest_templates qt ON qsh.quest_key = qt.quest_key
      LEFT JOIN quest_translations qtr ON qt.quest_key = qtr.quest_key AND qtr.language_code = 'en'
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY qsh.actual_time DESC
      LIMIT 100
    `, queryParams);
    
    // Статистика по действиям
    const actionStats = await pool.query(`
      SELECT 
        action_type,
        status,
        COUNT(*) as count
      FROM quest_scheduler_history 
      WHERE actual_time > NOW() - INTERVAL $1 days
      GROUP BY action_type, status
      ORDER BY action_type, status
    `, [days]);
    
    res.json({
      success: true,
      history: history.rows,
      action_stats: actionStats.rows,
      filters: {
        quest_key: quest_key || null,
        days: parseInt(days),
        action_type: action_type || null
      },
      total_count: history.rows.length
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения истории:', error);
    res.status(500).json({ error: 'Failed to get scheduler history', details: error.message });
  }
});

module.exports = router;