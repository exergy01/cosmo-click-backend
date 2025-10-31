// routes/admin/analytics.js - Продвинутая финансовая аналитика
const express = require('express');
const pool = require('../../db');
const { isAdmin } = require('./auth');

const router = express.Router();

if (process.env.NODE_ENV === 'development') console.log('📊 Загружаем модуль аналитики...');

// 📈 Ежедневная финансовая статистика
router.get('/daily-finance', async (req, res) => {
  const { admin_id, days = 30 } = req.query;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`📈 Запрос ежедневной статистики от админа ${admin_id} за ${days} дней`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const query = `
      WITH daily_data AS (
        SELECT
          DATE(created_at) as date,
          -- Депозиты
          COALESCE(SUM(CASE WHEN td.status = 'completed' THEN td.amount ELSE 0 END), 0) as deposits_ton,
          COUNT(CASE WHEN td.status = 'completed' THEN 1 END) as deposits_count,
          -- Выводы
          COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE DATE(w.created_at) = DATE(td.created_at) AND w.status = 'completed'), 0) as withdrawals_ton,
          COALESCE((SELECT COUNT(*) FROM withdrawals w WHERE DATE(w.created_at) = DATE(td.created_at) AND w.status = 'completed'), 0) as withdrawals_count,
          -- Игровая активность
          COALESCE((SELECT SUM(mh.win_amount) FROM minigames_history mh WHERE DATE(mh.timestamp) = DATE(td.created_at)), 0) as games_payout,
          COALESCE((SELECT COUNT(*) FROM minigames_history mh WHERE DATE(mh.timestamp) = DATE(td.created_at)), 0) as games_count
        FROM ton_deposits td
        WHERE td.created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY DATE(td.created_at)

        UNION ALL

        -- Дни без депозитов, но с выводами
        SELECT
          DATE(w.created_at) as date,
          0 as deposits_ton,
          0 as deposits_count,
          SUM(w.amount) as withdrawals_ton,
          COUNT(*) as withdrawals_count,
          COALESCE((SELECT SUM(mh.win_amount) FROM minigames_history mh WHERE DATE(mh.timestamp) = DATE(w.created_at)), 0) as games_payout,
          COALESCE((SELECT COUNT(*) FROM minigames_history mh WHERE DATE(mh.timestamp) = DATE(w.created_at)), 0) as games_count
        FROM withdrawals w
        WHERE w.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        AND w.status = 'completed'
        AND DATE(w.created_at) NOT IN (
          SELECT DISTINCT DATE(created_at) FROM ton_deposits WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        )
        GROUP BY DATE(w.created_at)
      )
      SELECT
        date,
        SUM(deposits_ton) as deposits_ton,
        SUM(deposits_count) as deposits_count,
        SUM(withdrawals_ton) as withdrawals_ton,
        SUM(withdrawals_count) as withdrawals_count,
        SUM(games_payout) as games_payout,
        SUM(games_count) as games_count,
        (SUM(deposits_ton) - SUM(withdrawals_ton)) as net_flow,
        ROUND((SUM(games_payout) / NULLIF(SUM(deposits_ton), 0) * 100), 2) as payout_ratio
      FROM daily_data
      GROUP BY date
      ORDER BY date DESC
    `;

    // 🔒 SECURITY: Use parameterized query to prevent SQL injection
    const result = await pool.query(query, [parseInt(days)]);

    // Подсчитываем общую статистику
    const summary = result.rows.reduce((acc, day) => ({
      total_deposits: acc.total_deposits + parseFloat(day.deposits_ton || 0),
      total_withdrawals: acc.total_withdrawals + parseFloat(day.withdrawals_ton || 0),
      total_games_payout: acc.total_games_payout + parseFloat(day.games_payout || 0),
      total_deposits_count: acc.total_deposits_count + parseInt(day.deposits_count || 0),
      total_withdrawals_count: acc.total_withdrawals_count + parseInt(day.withdrawals_count || 0),
      total_games_count: acc.total_games_count + parseInt(day.games_count || 0)
    }), {
      total_deposits: 0,
      total_withdrawals: 0,
      total_games_payout: 0,
      total_deposits_count: 0,
      total_withdrawals_count: 0,
      total_games_count: 0
    });

    summary.net_profit = summary.total_deposits - summary.total_withdrawals - summary.total_games_payout;
    summary.avg_deposit = summary.total_deposits_count > 0 ? summary.total_deposits / summary.total_deposits_count : 0;
    summary.avg_withdrawal = summary.total_withdrawals_count > 0 ? summary.total_withdrawals / summary.total_withdrawals_count : 0;

    if (process.env.NODE_ENV === 'development') console.log(`✅ Статистика за ${days} дней: депозиты ${summary.total_deposits} TON, выводы ${summary.total_withdrawals} TON`);

    res.json({
      success: true,
      daily_stats: result.rows,
      summary: summary,
      period_days: parseInt(days)
    });

  } catch (error) {
    console.error('❌ Ошибка получения ежедневной статистики:', error);
    res.status(500).json({
      error: 'Ошибка получения статистики',
      details: error.message
    });
  }
});

// 👑 Топ игроков по оборотам
router.get('/top-players', async (req, res) => {
  const { admin_id, period = 30, limit = 50 } = req.query;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`👑 Запрос топа игроков от админа ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const query = `
      SELECT
        p.telegram_id,
        p.username,
        p.first_name,
        p.created_at as registration_date,
        p.ton as current_balance,
        -- Депозиты
        COALESCE(SUM(td.amount), 0) as total_deposits,
        COUNT(td.id) as deposits_count,
        -- Выводы
        COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.telegram_id = p.telegram_id AND w.created_at >= NOW() - INTERVAL '${parseInt(period)} days'), 0) as total_withdrawals,
        COALESCE((SELECT COUNT(*) FROM withdrawals w WHERE w.telegram_id = p.telegram_id AND w.created_at >= NOW() - INTERVAL '${parseInt(period)} days'), 0) as withdrawals_count,
        -- Игровая активность
        COALESCE((SELECT SUM(mh.bet_amount) FROM minigames_history mh WHERE mh.telegram_id = p.telegram_id AND mh.timestamp >= NOW() - INTERVAL '${parseInt(period)} days'), 0) as total_bets,
        COALESCE((SELECT SUM(mh.win_amount) FROM minigames_history mh WHERE mh.telegram_id = p.telegram_id AND mh.timestamp >= NOW() - INTERVAL '${parseInt(period)} days'), 0) as total_wins,
        COALESCE((SELECT COUNT(*) FROM minigames_history mh WHERE mh.telegram_id = p.telegram_id AND mh.timestamp >= NOW() - INTERVAL '${parseInt(period)} days'), 0) as games_played,
        -- Рефералы
        p.referrals_count,
        -- Расчетные поля
        (COALESCE(SUM(td.amount), 0) + COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.telegram_id = p.telegram_id AND w.created_at >= NOW() - INTERVAL '${parseInt(period)} days'), 0)) as total_turnover,
        ROUND((COALESCE((SELECT SUM(mh.win_amount) FROM minigames_history mh WHERE mh.telegram_id = p.telegram_id AND mh.timestamp >= NOW() - INTERVAL '${parseInt(period)} days'), 0) / NULLIF(COALESCE((SELECT SUM(mh.bet_amount) FROM minigames_history mh WHERE mh.telegram_id = p.telegram_id AND mh.timestamp >= NOW() - INTERVAL '${parseInt(period)} days'), 0), 0) * 100), 2) as win_rate_percent,
        -- Оценка риска
        CASE
          WHEN COALESCE(SUM(td.amount), 0) > 100 AND COALESCE((SELECT COUNT(*) FROM withdrawals w WHERE w.telegram_id = p.telegram_id), 0) > 10 THEN 'high_volume'
          WHEN p.created_at > NOW() - INTERVAL '7 days' AND COALESCE(SUM(td.amount), 0) > 50 THEN 'new_high_deposit'
          WHEN COALESCE((SELECT COUNT(*) FROM withdrawals w WHERE w.telegram_id = p.telegram_id AND w.created_at >= NOW() - INTERVAL '24 hours'), 0) > 3 THEN 'frequent_withdrawals'
          ELSE 'normal'
        END as risk_profile
      FROM players p
      LEFT JOIN ton_deposits td ON td.telegram_id = p.telegram_id
        AND td.created_at >= NOW() - INTERVAL '${parseInt(period)} days'
        AND td.status = 'completed'
      WHERE p.created_at >= NOW() - INTERVAL '${parseInt(period) * 2} days'  -- Включаем игроков за больший период
      GROUP BY p.telegram_id, p.username, p.first_name, p.created_at, p.ton, p.referrals_count
      HAVING (COALESCE(SUM(td.amount), 0) + COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.telegram_id = p.telegram_id AND w.created_at >= NOW() - INTERVAL '${parseInt(period)} days'), 0)) > 0
      ORDER BY total_turnover DESC
      LIMIT ${parseInt(limit)}
    `;

    const result = await pool.query(query);

    if (process.env.NODE_ENV === 'development') console.log(`✅ Найдено ${result.rows.length} топ игроков`);

    res.json({
      success: true,
      top_players: result.rows,
      count: result.rows.length,
      period_days: parseInt(period)
    });

  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    res.status(500).json({
      error: 'Ошибка получения топа игроков',
      details: error.message
    });
  }
});

// 🔍 Анализ подозрительных паттернов
router.get('/suspicious-patterns', async (req, res) => {
  const { admin_id } = req.query;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`🔍 Анализ подозрительных паттернов админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const patterns = await Promise.all([
      // 1. Дублирующиеся депозиты (одинаковые суммы в короткий промежуток)
      pool.query(`
        SELECT
          'duplicate_deposits' as pattern_type,
          td1.amount,
          COUNT(*) as occurrences,
          ARRAY_AGG(DISTINCT td1.telegram_id) as players,
          MIN(td1.created_at) as first_occurrence,
          MAX(td1.created_at) as last_occurrence
        FROM ton_deposits td1
        WHERE td1.created_at >= NOW() - INTERVAL '7 days'
        AND EXISTS (
          SELECT 1 FROM ton_deposits td2
          WHERE ABS(td2.amount - td1.amount) < 0.001
          AND td2.id != td1.id
          AND td2.created_at BETWEEN td1.created_at - INTERVAL '2 hours' AND td1.created_at + INTERVAL '2 hours'
        )
        GROUP BY td1.amount
        HAVING COUNT(*) >= 3
        ORDER BY occurrences DESC
      `),

      // 2. Быстрые циклы депозит-вывод
      pool.query(`
        SELECT
          'quick_cycles' as pattern_type,
          p.telegram_id,
          p.username,
          td.amount as deposit_amount,
          w.amount as withdrawal_amount,
          td.created_at as deposit_time,
          w.created_at as withdrawal_time,
          EXTRACT(EPOCH FROM (w.created_at - td.created_at))/3600 as hours_difference
        FROM players p
        JOIN ton_deposits td ON td.telegram_id = p.telegram_id
        JOIN withdrawals w ON w.telegram_id = p.telegram_id
        WHERE td.created_at >= NOW() - INTERVAL '7 days'
        AND w.created_at > td.created_at
        AND w.created_at < td.created_at + INTERVAL '6 hours'
        AND ABS(w.amount - td.amount) < 0.01
        ORDER BY hours_difference ASC
      `),

      // 3. Аномальные игровые сессии
      pool.query(`
        SELECT
          'anomalous_gaming' as pattern_type,
          mh.telegram_id,
          p.username,
          COUNT(*) as games_count,
          SUM(mh.bet_amount) as total_bets,
          SUM(mh.win_amount) as total_wins,
          ROUND((SUM(mh.win_amount) / SUM(mh.bet_amount) * 100), 2) as win_rate,
          MIN(mh.timestamp) as session_start,
          MAX(mh.timestamp) as session_end
        FROM minigames_history mh
        JOIN players p ON p.telegram_id = mh.telegram_id
        WHERE mh.timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY mh.telegram_id, p.username
        HAVING COUNT(*) > 100
        OR (SUM(mh.win_amount) / SUM(mh.bet_amount)) > 1.5
        ORDER BY win_rate DESC
      `),

      // 4. Множественные аккаунты с одного IP/устройства (приблизительно)
      pool.query(`
        SELECT
          'potential_multi_accounts' as pattern_type,
          p1.telegram_id as player1,
          p1.username as username1,
          p2.telegram_id as player2,
          p2.username as username2,
          p1.created_at as reg1,
          p2.created_at as reg2,
          ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at)))/3600 as hours_apart
        FROM players p1
        JOIN players p2 ON p1.telegram_id < p2.telegram_id
        WHERE p1.created_at >= NOW() - INTERVAL '7 days'
        AND ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 3600  -- В течение часа
        AND (
          -- Похожие имена
          SIMILARITY(p1.username, p2.username) > 0.7
          OR SIMILARITY(p1.first_name, p2.first_name) > 0.7
          -- Или оба имеют депозиты в первый день
          OR (
            EXISTS(SELECT 1 FROM ton_deposits td1 WHERE td1.telegram_id = p1.telegram_id AND td1.created_at < p1.created_at + INTERVAL '24 hours')
            AND EXISTS(SELECT 1 FROM ton_deposits td2 WHERE td2.telegram_id = p2.telegram_id AND td2.created_at < p2.created_at + INTERVAL '24 hours')
          )
        )
        ORDER BY hours_apart ASC
      `)
    ]);

    const analysis_results = {
      duplicate_deposits: patterns[0].rows,
      quick_cycles: patterns[1].rows,
      anomalous_gaming: patterns[2].rows,
      potential_multi_accounts: patterns[3].rows,
      summary: {
        total_patterns: patterns.reduce((sum, p) => sum + p.rows.length, 0),
        high_risk_count: patterns[1].rows.length + patterns[2].rows.filter(p => p.win_rate > 200).length,
        requires_investigation: patterns[0].rows.length + patterns[3].rows.length
      }
    };

    if (process.env.NODE_ENV === 'development') console.log(`🔍 Найдено подозрительных паттернов: ${analysis_results.summary.total_patterns}`);

    res.json({
      success: true,
      patterns: analysis_results
    });

  } catch (error) {
    console.error('❌ Ошибка анализа паттернов:', error);
    res.status(500).json({
      error: 'Ошибка анализа паттернов',
      details: error.message
    });
  }
});

// 📊 Экспорт отчетов
router.post('/export-report', async (req, res) => {
  const { admin_id, report_type, params = {} } = req.body;

  try {
    if (process.env.NODE_ENV === 'development') console.log(`📊 Экспорт отчета ${report_type} админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    let query = '';
    let reportData = [];

    switch (report_type) {
      case 'financial_summary':
        query = `
          SELECT
            DATE(created_at) as date,
            'deposit' as type,
            amount,
            telegram_id as player_id,
            transaction_hash,
            status
          FROM ton_deposits
          WHERE created_at >= NOW() - INTERVAL '${params.days || 30} days'
          UNION ALL
          SELECT
            DATE(created_at) as date,
            'withdrawal' as type,
            amount,
            telegram_id as player_id,
            transaction_hash,
            status
          FROM withdrawals
          WHERE created_at >= NOW() - INTERVAL '${params.days || 30} days'
          ORDER BY date DESC
        `;
        break;

      case 'player_activity':
        query = `
          SELECT
            p.telegram_id,
            p.username,
            p.first_name,
            p.created_at as registration,
            COALESCE(SUM(td.amount), 0) as total_deposits,
            COALESCE(SUM(w.amount), 0) as total_withdrawals,
            COALESCE(games.games_count, 0) as games_played,
            p.referrals_count
          FROM players p
          LEFT JOIN ton_deposits td ON td.telegram_id = p.telegram_id AND td.status = 'completed'
          LEFT JOIN withdrawals w ON w.telegram_id = p.telegram_id AND w.status = 'completed'
          LEFT JOIN (
            SELECT telegram_id, COUNT(*) as games_count
            FROM minigames_history
            GROUP BY telegram_id
          ) games ON games.telegram_id = p.telegram_id
          WHERE p.created_at >= NOW() - INTERVAL '${params.days || 30} days'
          GROUP BY p.telegram_id, p.username, p.first_name, p.created_at, p.referrals_count, games.games_count
          ORDER BY total_deposits DESC
        `;
        break;

      default:
        return res.status(400).json({ error: 'Неизвестный тип отчета' });
    }

    const result = await pool.query(query);
    reportData = result.rows;

    // Конвертируем в CSV формат
    if (reportData.length > 0) {
      const headers = Object.keys(reportData[0]).join(',');
      const csvData = reportData.map(row =>
        Object.values(row).map(value =>
          typeof value === 'string' && value.includes(',') ? `"${value}"` : value
        ).join(',')
      ).join('\n');

      const csv = headers + '\n' + csvData;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${report_type}_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        message: 'Нет данных для экспорта',
        count: 0
      });
    }

  } catch (error) {
    console.error('❌ Ошибка экспорта отчета:', error);
    res.status(500).json({
      error: 'Ошибка экспорта отчета',
      details: error.message
    });
  }
});

if (process.env.NODE_ENV === 'development') console.log('✅ Модуль аналитики загружен');

module.exports = router;