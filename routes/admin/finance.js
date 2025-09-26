// routes/admin/finance.js - Финансовое управление TON депозитами
const express = require('express');
const pool = require('../../db');
const { isAdmin } = require('./auth');

const router = express.Router();

console.log('🏦 Загружаем модуль финансового управления...');

// Получить список TON депозитов
router.get('/ton-deposits', async (req, res) => {
    const { admin_id, status = 'unidentified' } = req.query;

    try {
      console.log(`📋 Запрос TON депозитов от админа ${admin_id}, статус: ${status}`);

      if (!isAdmin(admin_id)) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      let query = `
        SELECT
          id, player_id, amount, transaction_hash, status, created_at
        FROM ton_deposits
        WHERE 1=1
      `;
      const params = [];

      if (status && status !== 'all') {
        query += ' AND status = $1';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT 50';

      const result = await pool.query(query, params);

      console.log(`✅ Найдено ${result.rows.length} TON депозитов`);

      res.json({
        success: true,
        deposits: result.rows,
        count: result.rows.length
      });

    } catch (error) {
      console.error('❌ Ошибка получения TON депозитов:', error);
      res.status(500).json({
        error: 'Ошибка получения депозитов',
        details: error.message
      });
    }
  });

// Получить статистику TON
router.get('/ton-stats', async (req, res) => {
    const { admin_id } = req.query;

    try {
      console.log(`📊 Запрос статистики TON от админа ${admin_id}`);

      if (!isAdmin(admin_id)) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      const statsQuery = `
        SELECT
          COUNT(*) as total_deposits,
          COUNT(CASE WHEN status = 'unidentified' THEN 1 END) as unidentified_deposits,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_deposits,
          COALESCE(SUM(amount), 0) as total_amount,
          COALESCE(SUM(CASE WHEN status = 'unidentified' THEN amount ELSE 0 END), 0) as pending_amount
        FROM ton_deposits
      `;

      const result = await pool.query(statsQuery);
      const stats = result.rows[0];

      console.log('✅ Статистика TON собрана:', stats);

      res.json({
        success: true,
        total_deposits: parseInt(stats.total_deposits),
        unidentified_deposits: parseInt(stats.unidentified_deposits),
        completed_deposits: parseInt(stats.completed_deposits),
        total_amount: parseFloat(stats.total_amount),
        pending_amount: parseFloat(stats.pending_amount)
      });

    } catch (error) {
      console.error('❌ Ошибка получения статистики TON:', error);
      res.status(500).json({
        error: 'Ошибка получения статистики',
        details: error.message
      });
    }
  });

// Обработать неопознанный депозит
router.post('/process-ton-deposit', async (req, res) => {
    const { admin_id, deposit_id, player_id } = req.body;

    try {
      console.log(`⚡ Обработка TON депозита: admin=${admin_id}, deposit=${deposit_id}, player=${player_id}`);

      if (!isAdmin(admin_id)) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      if (!deposit_id || !player_id) {
        return res.status(400).json({ error: 'Необходимы deposit_id и player_id' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Получаем данные депозита
        const depositResult = await client.query(
          'SELECT * FROM ton_deposits WHERE id = $1 AND status = $2',
          [deposit_id, 'unidentified']
        );

        if (depositResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Депозит не найден или уже обработан' });
        }

        const deposit = depositResult.rows[0];

        // Проверяем существование игрока
        const playerResult = await client.query(
          'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
          [player_id]
        );

        if (playerResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Игрок ${player_id} не найден` });
        }

        const player = playerResult.rows[0];
        const currentBalance = parseFloat(player.ton || '0');
        const depositAmount = parseFloat(deposit.amount);
        const newBalance = currentBalance + depositAmount;

        // Обновляем депозит
        await client.query(
          'UPDATE ton_deposits SET player_id = $1, status = $2 WHERE id = $3',
          [player_id, 'completed', deposit_id]
        );

        // Обновляем баланс игрока
        await client.query(
          'UPDATE players SET ton = $1 WHERE telegram_id = $2',
          [newBalance, player_id]
        );

        // Записываем в историю баланса
        await client.query(
          `INSERT INTO balance_history (
            telegram_id, currency, old_balance, new_balance,
            change_amount, reason, details, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            player_id,
            'ton',
            currentBalance,
            newBalance,
            depositAmount,
            'admin_manual_deposit',
            JSON.stringify({
              admin_id: admin_id,
              deposit_id: deposit_id,
              transaction_hash: deposit.transaction_hash
            })
          ]
        );

        await client.query('COMMIT');

        console.log(`✅ Депозит обработан: ${player_id} +${depositAmount} TON (${currentBalance} → ${newBalance})`);

        res.json({
          success: true,
          message: 'Депозит успешно обработан',
          player_id: player_id,
          amount: depositAmount,
          new_balance: newBalance,
          old_balance: currentBalance
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('❌ Ошибка обработки TON депозита:', error);
      res.status(500).json({
        error: 'Ошибка обработки депозита',
        details: error.message
      });
    }
  });

console.log('✅ Модуль финансового управления загружен');

module.exports = router;