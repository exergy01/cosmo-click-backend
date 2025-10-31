// routes/admin/finance.js - Финансовое управление TON депозитами
const express = require('express');
const pool = require('../../db');
const { isAdmin } = require('./auth');

const router = express.Router();

if (process.env.NODE_ENV === 'development') console.log('🏦 Загружаем модуль финансового управления...');

// Получить список TON депозитов
router.get('/ton-deposits', async (req, res) => {
    const { admin_id, status = 'unidentified' } = req.query;

    try {
      if (process.env.NODE_ENV === 'development') console.log(`📋 Запрос TON депозитов от админа ${admin_id}, статус: ${status}`);

      if (!isAdmin(admin_id)) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      let query = `
        SELECT
          id, telegram_id, amount, transaction_hash, status, created_at
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

      if (process.env.NODE_ENV === 'development') console.log(`✅ Найдено ${result.rows.length} TON депозитов`);

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
      if (process.env.NODE_ENV === 'development') console.log(`📊 Запрос статистики TON от админа ${admin_id}`);

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

      if (process.env.NODE_ENV === 'development') console.log('✅ Статистика TON собрана:', stats);

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
      if (process.env.NODE_ENV === 'development') console.log(`⚡ Обработка TON депозита: admin=${admin_id}, deposit=${deposit_id}, player=${player_id}`);

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
          'UPDATE ton_deposits SET telegram_id = $1, status = $2 WHERE id = $3',
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

        if (process.env.NODE_ENV === 'development') console.log(`✅ Депозит обработан: ${player_id} +${depositAmount} TON (${currentBalance} → ${newBalance})`);

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

// 🆕 СИСТЕМА ПОДТВЕРЖДЕНИЯ ВЫВОДОВ
// Получить список ожидающих подтверждения выводов
router.get('/withdrawals/pending', async (req, res) => {
  const { admin_id } = req.query;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`💸 Запрос ожидающих выводов от админа ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const query = `
      SELECT
        w.id, w.player_id as telegram_id, w.amount, w.recipient_address,
        w.status, w.created_at, w.transaction_hash,
        p.username, p.first_name, p.ton as current_balance,
        -- Риск-анализ
        (SELECT COUNT(*) FROM withdrawals w2 WHERE w2.player_id = w.player_id AND w2.created_at > NOW() - INTERVAL '24 hours') as withdrawals_24h,
        (SELECT COUNT(*) FROM ton_deposits td WHERE td.telegram_id = w.player_id) as total_deposits
      FROM withdrawals w
      JOIN players p ON w.player_id = p.telegram_id
      WHERE w.status IN ('pending', 'processing')
      ORDER BY
        CASE
          WHEN w.amount > 100 THEN 1  -- Крупные суммы первыми
          WHEN w.amount > 50 THEN 2
          ELSE 3
        END,
        w.created_at ASC
      LIMIT 50
    `;

    const result = await pool.query(query);

    if (process.env.NODE_ENV === 'development') console.log(`✅ Найдено ${result.rows.length} ожидающих выводов`);

    res.json({
      success: true,
      withdrawals: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('❌ Ошибка получения ожидающих выводов:', error);
    res.status(500).json({
      error: 'Ошибка получения выводов',
      details: error.message
    });
  }
});

// Подтвердить/отклонить вывод
router.post('/withdrawals/approve', async (req, res) => {
  const { admin_id, withdrawal_id, action, reason } = req.body;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`✅ ${action} вывода ${withdrawal_id} админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    if (!withdrawal_id || !action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Некорректные параметры' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Получаем данные о выводе
      const withdrawalResult = await client.query(
        'SELECT * FROM withdrawals WHERE id = $1 AND status = $2',
        [withdrawal_id, 'pending']
      );

      if (withdrawalResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Вывод не найден или уже обработан' });
      }

      const withdrawal = withdrawalResult.rows[0];

      if (action === 'approve') {
        // Подтверждаем вывод
        await client.query(
          'UPDATE withdrawals SET status = $1, admin_approved_by = $2, admin_approved_at = NOW() WHERE id = $3',
          ['approved', admin_id, withdrawal_id]
        );

        // Логируем действие админа
        await client.query(
          'INSERT INTO player_actions (telegram_id, admin_id, action_type, details, timestamp) VALUES ($1, $2, $3, $4, NOW())',
          [
            withdrawal.telegram_id,
            admin_id,
            'withdrawal_approved',
            JSON.stringify({
              withdrawal_id: withdrawal_id,
              amount: withdrawal.amount,
              address: withdrawal.recipient_address,
              reason: reason || 'Одобрено администратором'
            })
          ]
        );

      } else if (action === 'reject') {
        // Отклоняем вывод и возвращаем средства
        await client.query(
          'UPDATE withdrawals SET status = $1, admin_rejected_by = $2, admin_rejected_at = NOW(), rejection_reason = $3 WHERE id = $4',
          ['rejected', admin_id, reason || 'Отклонено администратором', withdrawal_id]
        );

        // Возвращаем TON на баланс игрока
        await client.query(
          'UPDATE players SET ton = ton + $1 WHERE telegram_id = $2',
          [parseFloat(withdrawal.amount), withdrawal.telegram_id]
        );

        // Логируем возврат средств
        await client.query(
          'INSERT INTO balance_history (telegram_id, currency, old_balance, new_balance, change_amount, reason, details, timestamp) VALUES (SELECT telegram_id, $1, ton - $2, ton, $2, $3, $4, NOW() FROM players WHERE telegram_id = $5)',
          [
            'ton',
            parseFloat(withdrawal.amount),
            'withdrawal_rejected_refund',
            JSON.stringify({
              withdrawal_id: withdrawal_id,
              admin_id: admin_id,
              reason: reason
            }),
            withdrawal.telegram_id
          ]
        );

        // Логируем действие админа
        await client.query(
          'INSERT INTO player_actions (telegram_id, admin_id, action_type, details, timestamp) VALUES ($1, $2, $3, $4, NOW())',
          [
            withdrawal.telegram_id,
            admin_id,
            'withdrawal_rejected',
            JSON.stringify({
              withdrawal_id: withdrawal_id,
              amount: withdrawal.amount,
              reason: reason || 'Отклонено администратором'
            })
          ]
        );
      }

      await client.query('COMMIT');

      if (process.env.NODE_ENV === 'development') console.log(`✅ Вывод ${withdrawal_id} ${action === 'approve' ? 'одобрен' : 'отклонен'}`);

      res.json({
        success: true,
        message: `Вывод ${action === 'approve' ? 'одобрен' : 'отклонен'}`,
        withdrawal_id: withdrawal_id,
        action: action
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Ошибка обработки вывода:', error);
    res.status(500).json({
      error: 'Ошибка обработки вывода',
      details: error.message
    });
  }
});

// 🆕 ПОИСК ПОТЕРЯННЫХ ДЕПОЗИТОВ
// Найти депозиты без владельца (orphaned)
router.get('/deposits/orphaned', async (req, res) => {
  const { admin_id, min_amount = 0, time_hours = 24 } = req.query;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`🔍 Поиск потерянных депозитов админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const query = `
      SELECT
        td.id, td.amount, td.transaction_hash, td.created_at,
        td.from_address, td.status,
        -- Попытка найти игрока по временной корреляции
        (
          SELECT ARRAY_AGG(p.telegram_id)
          FROM players p
          WHERE p.telegram_wallet = td.from_address
          OR p.created_at BETWEEN td.created_at - INTERVAL '1 hour' AND td.created_at + INTERVAL '1 hour'
        ) as potential_players,
        -- Поиск похожих депозитов
        (
          SELECT COUNT(*)
          FROM ton_deposits td2
          WHERE ABS(td2.amount - td.amount) < 0.001
          AND td2.created_at BETWEEN td.created_at - INTERVAL '1 hour' AND td.created_at + INTERVAL '1 hour'
          AND td2.id != td.id
        ) as similar_deposits
      FROM ton_deposits td
      WHERE td.status = 'unidentified'
      AND td.amount >= $1
      AND td.created_at > NOW() - INTERVAL '${parseInt(time_hours)} hours'
      ORDER BY td.amount DESC, td.created_at DESC
      LIMIT 100
    `;

    const result = await pool.query(query, [parseFloat(min_amount)]);

    if (process.env.NODE_ENV === 'development') console.log(`✅ Найдено ${result.rows.length} потерянных депозитов`);

    res.json({
      success: true,
      orphaned_deposits: result.rows,
      count: result.rows.length,
      search_params: {
        min_amount: parseFloat(min_amount),
        time_hours: parseInt(time_hours)
      }
    });

  } catch (error) {
    console.error('❌ Ошибка поиска потерянных депозитов:', error);
    res.status(500).json({
      error: 'Ошибка поиска депозитов',
      details: error.message
    });
  }
});

// Расследование депозита (поиск владельца)
router.post('/deposits/investigate', async (req, res) => {
  const { admin_id, deposit_id, search_params = {} } = req.body;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`🕵️ Расследование депозита ${deposit_id} админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    // Получаем данные депозита
    const depositResult = await pool.query(
      'SELECT * FROM ton_deposits WHERE id = $1',
      [deposit_id]
    );

    if (depositResult.rows.length === 0) {
      return res.status(404).json({ error: 'Депозит не найден' });
    }

    const deposit = depositResult.rows[0];

    // Многокритериальный поиск владельца
    const investigations = await Promise.all([
      // 1. Поиск по адресу кошелька
      pool.query(
        'SELECT telegram_id, username, first_name FROM players WHERE telegram_wallet = $1',
        [deposit.from_address]
      ),

      // 2. Поиск по времени регистрации (±2 часа от депозита)
      pool.query(`
        SELECT telegram_id, username, first_name, created_at,
        ABS(EXTRACT(EPOCH FROM (created_at - $1))) as time_diff_seconds
        FROM players
        WHERE created_at BETWEEN $1 - INTERVAL '2 hours' AND $1 + INTERVAL '2 hours'
        ORDER BY time_diff_seconds
        LIMIT 10
      `, [deposit.created_at]),

      // 3. Поиск игроков с похожими депозитами
      pool.query(`
        SELECT DISTINCT p.telegram_id, p.username, p.first_name,
        td.amount, td.created_at
        FROM players p
        JOIN ton_deposits td ON td.telegram_id = p.telegram_id
        WHERE ABS(td.amount - $1) < 0.001
        AND td.created_at BETWEEN $2 - INTERVAL '6 hours' AND $2 + INTERVAL '6 hours'
        ORDER BY td.created_at DESC
        LIMIT 5
      `, [deposit.amount, deposit.created_at]),

      // 4. Поиск по активности в это время (player_actions)
      pool.query(`
        SELECT DISTINCT p.telegram_id, p.username, p.first_name, pa.timestamp
        FROM players p
        JOIN player_actions pa ON pa.telegram_id = p.telegram_id
        WHERE pa.timestamp BETWEEN $1 - INTERVAL '1 hour' AND $1 + INTERVAL '1 hour'
        ORDER BY pa.timestamp DESC
        LIMIT 10
      `, [deposit.created_at])
    ]);

    const investigation_results = {
      deposit: deposit,
      wallet_matches: investigations[0].rows,
      time_correlations: investigations[1].rows,
      amount_similarities: investigations[2].rows,
      activity_correlations: investigations[3].rows,
      suggestions: []
    };

    // Генерируем рекомендации
    if (investigation_results.wallet_matches.length > 0) {
      investigation_results.suggestions.push({
        confidence: 0.95,
        type: 'wallet_match',
        player_id: investigation_results.wallet_matches[0].telegram_id,
        reason: 'Точное совпадение адреса кошелька'
      });
    }

    if (investigation_results.time_correlations.length > 0) {
      const closest = investigation_results.time_correlations[0];
      if (closest.time_diff_seconds < 1800) { // Меньше 30 минут
        investigation_results.suggestions.push({
          confidence: 0.8,
          type: 'time_correlation',
          player_id: closest.telegram_id,
          reason: `Регистрация через ${Math.round(closest.time_diff_seconds / 60)} минут после депозита`
        });
      }
    }

    res.json({
      success: true,
      investigation: investigation_results
    });

  } catch (error) {
    console.error('❌ Ошибка расследования депозита:', error);
    res.status(500).json({
      error: 'Ошибка расследования',
      details: error.message
    });
  }
});

// 🆕 СИСТЕМА АЛЕРТОВ
// Получить критические уведомления
router.get('/alerts/critical', async (req, res) => {
  const { admin_id } = req.query;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`🚨 Получение критических алертов для админа ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const alerts = await Promise.all([
      // 1. Крупные депозиты без владельца (>50 TON)
      pool.query(`
        SELECT 'large_orphaned_deposit' as type, 'critical' as priority,
        td.id, td.amount, td.created_at, td.transaction_hash,
        'Крупный депозит без владельца: ' || td.amount || ' TON' as message
        FROM ton_deposits td
        WHERE td.status = 'unidentified'
        AND td.amount > 50
        AND td.created_at > NOW() - INTERVAL '7 days'
      `),

      // 2. Ожидающие выводы более 24 часов
      pool.query(`
        SELECT 'pending_withdrawal_long' as type, 'high' as priority,
        w.id, w.amount, w.created_at, w.telegram_id,
        'Вывод ожидает подтверждения ' || EXTRACT(HOUR FROM (NOW() - w.created_at)) || ' часов' as message
        FROM withdrawals w
        WHERE w.status = 'pending'
        AND w.created_at < NOW() - INTERVAL '24 hours'
      `),

      // 3. Подозрительная активность (много выводов за день)
      pool.query(`
        SELECT 'suspicious_withdrawals' as type, 'medium' as priority,
        p.telegram_id, p.username, COUNT(*) as withdrawal_count,
        'Игрок сделал ' || COUNT(*) || ' выводов за 24 часа' as message
        FROM players p
        JOIN withdrawals w ON w.telegram_id = p.telegram_id
        WHERE w.created_at > NOW() - INTERVAL '24 hours'
        GROUP BY p.telegram_id, p.username
        HAVING COUNT(*) > 5
      `),

      // 4. Новые игроки с крупными депозитами
      pool.query(`
        SELECT 'new_player_large_deposit' as type, 'medium' as priority,
        p.telegram_id, p.username, p.created_at, td.amount,
        'Новый игрок внес ' || td.amount || ' TON через ' ||
        EXTRACT(HOUR FROM (td.created_at - p.created_at)) || ' часов после регистрации' as message
        FROM players p
        JOIN ton_deposits td ON td.telegram_id = p.telegram_id
        WHERE p.created_at > NOW() - INTERVAL '7 days'
        AND td.amount > 20
        AND td.created_at < p.created_at + INTERVAL '6 hours'
      `)
    ]);

    const all_alerts = [
      ...alerts[0].rows,
      ...alerts[1].rows,
      ...alerts[2].rows,
      ...alerts[3].rows
    ].sort((a, b) => {
      const priority_order = { 'critical': 1, 'high': 2, 'medium': 3 };
      return priority_order[a.priority] - priority_order[b.priority];
    });

    if (process.env.NODE_ENV === 'development') console.log(`🚨 Найдено ${all_alerts.length} критических алертов`);

    res.json({
      success: true,
      alerts: all_alerts,
      count: all_alerts.length,
      summary: {
        critical: all_alerts.filter(a => a.priority === 'critical').length,
        high: all_alerts.filter(a => a.priority === 'high').length,
        medium: all_alerts.filter(a => a.priority === 'medium').length
      }
    });

  } catch (error) {
    console.error('❌ Ошибка получения алертов:', error);
    res.status(500).json({
      error: 'Ошибка получения алертов',
      details: error.message
    });
  }
});

if (process.env.NODE_ENV === 'development') console.log('✅ Модуль финансового управления загружен');

module.exports = router;