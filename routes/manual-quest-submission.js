// routes/manual-quest-submission.js - Эндпоинт для отправки заявок игроками
const express = require('express');
const router = express.Router();
const pool = require('../db');
const bot = require('../bot');

const ADMIN_TELEGRAM_ID = '850758749';

// POST /api/quests/submit-manual - Отправить заявку на ручную проверку
router.post('/submit-manual', async (req, res) => {
  try {
    const { telegram_id, quest_key, account_number, notes } = req.body;

    if (!telegram_id || !quest_key || !account_number) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`📝 Игрок ${telegram_id} отправляет заявку на ${quest_key}: ${account_number}`);

    // Проверяем есть ли уже pending заявка от этого игрока на это задание
    const existingPending = await pool.query(`
      SELECT id FROM manual_quest_submissions
      WHERE telegram_id = $1 AND quest_key = $2 AND status = 'pending'
    `, [telegram_id, quest_key]);

    if (existingPending.rows.length > 0) {
      return res.status(400).json({
        error: 'У вас уже есть заявка на проверке по этому заданию'
      });
    }

    // Сохраняем заявку
    const result = await pool.query(`
      INSERT INTO manual_quest_submissions (telegram_id, quest_key, submission_data, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING id
    `, [telegram_id, quest_key, JSON.stringify({ account_number, notes })]);

    const submissionId = result.rows[0].id;

    // Получаем данные игрока
    const playerResult = await pool.query(
      'SELECT first_name, last_name, username FROM players WHERE telegram_id = $1',
      [telegram_id]
    );

    const player = playerResult.rows[0] || {};
    const playerName = player.first_name || 'Unknown';
    const playerUsername = player.username ? `@${player.username}` : '';

    // Отправляем уведомление админу
    try {
      await bot.telegram.sendMessage(
        ADMIN_TELEGRAM_ID,
        `🔔 Новая заявка на ручную проверку!\n\n` +
        `📋 Задание: ${quest_key}\n` +
        `👤 Игрок: ${playerName} ${playerUsername} (ID: ${telegram_id})\n` +
        `🔢 Номер счёта: ${account_number}\n` +
        `📝 Примечание: ${notes || 'нет'}\n\n` +
        `ID заявки: #${submissionId}`
      );

      console.log(`✅ Уведомление отправлено админу ${ADMIN_TELEGRAM_ID}`);
    } catch (err) {
      console.error('❌ Не удалось отправить уведомление админу:', err.message);
    }

    res.json({
      success: true,
      message: 'Заявка отправлена администратору на проверку',
      submission_id: submissionId
    });

  } catch (error) {
    console.error('❌ Ошибка отправки заявки:', error);
    res.status(500).json({ error: 'Failed to submit manual quest', details: error.message });
  }
});

// GET /api/quests/submission-status/:telegram_id/:quest_key - Проверить статус заявки
router.get('/submission-status/:telegram_id/:quest_key', async (req, res) => {
  try {
    const { telegram_id, quest_key } = req.params;

    const result = await pool.query(`
      SELECT id, status, reviewed_at, review_notes, created_at
      FROM manual_quest_submissions
      WHERE telegram_id = $1 AND quest_key = $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [telegram_id, quest_key]);

    if (result.rows.length === 0) {
      return res.json({ status: 'not_submitted' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('❌ Ошибка проверки статуса:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
