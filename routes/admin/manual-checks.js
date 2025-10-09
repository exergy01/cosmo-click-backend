// routes/admin/manual-checks.js - Модуль проверки ручных заданий
const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { isAdmin } = require('./auth');
const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const ADMIN_TELEGRAM_ID = '850758749'; // ID админа для уведомлений

// 📋 GET /list/:telegramId - Получить список заявок на проверку
router.get('/list/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { quest_key, status = 'all' } = req.query;

    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log(`📋 Админ ${telegramId} запросил список заявок`);

    let whereClause = '1=1';
    const params = [];

    if (quest_key) {
      params.push(quest_key);
      whereClause += ` AND mqs.quest_key = $${params.length}`;
    }

    if (status !== 'all') {
      params.push(status);
      whereClause += ` AND mqs.status = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT
        mqs.*,
        p.first_name,
        p.username,
        qt.quest_type,
        qt.reward_cs,
        COALESCE(qtr.quest_name, qt.quest_key) as quest_name
      FROM manual_quest_submissions mqs
      LEFT JOIN players p ON p.telegram_id = mqs.telegram_id
      LEFT JOIN quest_templates qt ON qt.quest_key = mqs.quest_key
      LEFT JOIN quest_translations qtr ON qtr.quest_key = mqs.quest_key AND qtr.language_code = 'en'
      WHERE ${whereClause}
      ORDER BY
        CASE mqs.status
          WHEN 'pending' THEN 1
          WHEN 'approved' THEN 2
          WHEN 'rejected' THEN 3
        END,
        mqs.created_at DESC
    `, params);

    // Группируем по broker_name (или quest_key если broker_name нет)
    const groupedByBroker = result.rows.reduce((acc, row) => {
      const groupKey = row.broker_name || row.quest_key;
      if (!acc[groupKey]) {
        acc[groupKey] = {
          quest_key: row.quest_key,
          quest_name: row.quest_name,
          broker_name: row.broker_name,
          quest_type: row.quest_type,
          reward_cs: row.reward_cs,
          submissions: []
        };
      }
      acc[groupKey].submissions.push(row);
      return acc;
    }, {});

    res.json({
      success: true,
      submissions: result.rows,
      grouped_by_quest: Object.values(groupedByBroker),
      stats: {
        total: result.rows.length,
        pending: result.rows.filter(r => r.status === 'pending').length,
        approved: result.rows.filter(r => r.status === 'approved').length,
        rejected: result.rows.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('❌ Ошибка получения списка заявок:', error);
    res.status(500).json({ error: 'Failed to fetch submissions', details: error.message });
  }
});

// ✅ POST /review/:telegramId - Одобрить или отклонить заявку
router.post('/review/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { submission_id, action, review_notes } = req.body; // action: 'approve' | 'reject'

    if (!isAdmin(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!submission_id || !action) {
      return res.status(400).json({ error: 'Missing submission_id or action' });
    }

    console.log(`✅ Админ ${telegramId} ${action === 'approve' ? 'одобряет' : 'отклоняет'} заявку ${submission_id}`);

    await pool.query('BEGIN');

    try {
      // Получаем заявку
      const submissionResult = await pool.query(
        'SELECT * FROM manual_quest_submissions WHERE id = $1',
        [submission_id]
      );

      if (submissionResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ error: 'Submission not found' });
      }

      const submission = submissionResult.rows[0];

      if (submission.status !== 'pending') {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'Submission already reviewed' });
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      // Обновляем статус заявки
      await pool.query(`
        UPDATE manual_quest_submissions
        SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
        WHERE id = $4
      `, [newStatus, telegramId, review_notes || null, submission_id]);

      // Если одобрено - отмечаем задание как выполненное
      if (action === 'approve') {
        // Проверяем есть ли уже выполненное задание
        const existingQuest = await pool.query(`
          SELECT pq.telegram_id, pq.quest_id
          FROM player_quests pq
          JOIN quest_templates qt ON qt.id = pq.quest_id
          WHERE pq.telegram_id = $1 AND qt.quest_key = $2 AND pq.completed = true
        `, [submission.telegram_id, submission.quest_key]);

        if (existingQuest.rows.length === 0) {
          // Получаем template ID и награду из quest_templates по quest_key
          const questResult = await pool.query(
            'SELECT id, reward_cs FROM quest_templates WHERE quest_key = $1',
            [submission.quest_key]
          );

          if (questResult.rows.length > 0) {
            const questTemplateId = questResult.rows[0].id;
            const rewardCs = questResult.rows[0].reward_cs;

            // Отмечаем как готовое к сбору награды (completed = false, но доступно)
            await pool.query(`
              INSERT INTO player_quests (telegram_id, quest_id, completed, quest_key, reward_cs)
              VALUES ($1, $2, false, $3, $4)
              ON CONFLICT (telegram_id, quest_id) DO UPDATE
              SET completed = false, quest_key = $3, reward_cs = $4
            `, [submission.telegram_id, questTemplateId, submission.quest_key, rewardCs]);

            console.log(`✅ Задание ${submission.quest_key} (Template ID: ${questTemplateId}) готово к сбору для игрока ${submission.telegram_id}`);
          } else {
            console.error(`❌ Квест "${submission.quest_key}" не найден в quest_templates!`);
          }
        } else {
          console.log(`⚠️ Игрок ${submission.telegram_id} уже выполнил задание ${submission.quest_key}`);
        }
      }

      await pool.query('COMMIT');

      // Отправляем уведомление игроку
      const playerResult = await pool.query(
        'SELECT first_name FROM players WHERE telegram_id = $1',
        [submission.telegram_id]
      );

      const playerName = playerResult.rows[0]?.first_name || 'Player';

      if (action === 'approve') {
        try {
          await bot.telegram.sendMessage(
            submission.telegram_id,
            `✅ Ваша заявка на задание "${submission.quest_key}" одобрена!\n\nВы можете забрать награду в разделе заданий.`
          );
        } catch (err) {
          console.error('Не удалось отправить уведомление игроку:', err.message);
        }
      } else {
        const rejectionMessage = review_notes ||
          'Не выполнены условия, проверьте что создали счет правильно и совершили сделку (открыли и закрыли) любого объема.';

        try {
          await bot.telegram.sendMessage(
            submission.telegram_id,
            `❌ Ваша заявка на задание "${submission.quest_key}" отклонена.\n\nПричина: ${rejectionMessage}`
          );
        } catch (err) {
          console.error('Не удалось отправить уведомление игроку:', err.message);
        }
      }

      res.json({
        success: true,
        message: `Submission ${action}d successfully`,
        submission_id,
        new_status: newStatus
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Ошибка проверки заявки:', error);
    res.status(500).json({ error: 'Failed to review submission', details: error.message });
  }
});

module.exports = router;
