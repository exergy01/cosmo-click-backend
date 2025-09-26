// routes/admin/investigation.js - Инструменты расследования и детективной работы
const express = require('express');
const pool = require('../../db');
const { isAdmin } = require('./auth');

const router = express.Router();

console.log('🕵️ Загружаем модуль расследований...');

// 🔍 Универсальный поиск по всем данным
router.post('/search', async (req, res) => {
  const { admin_id, query, search_type = 'all' } = req.body;

  try {
    console.log(`🔍 Универсальный поиск "${query}" админом ${admin_id}, тип: ${search_type}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    if (!query || query.length < 3) {
      return res.status(400).json({ error: 'Минимальная длина запроса: 3 символа' });
    }

    const searches = [];

    // Поиск игроков
    if (search_type === 'all' || search_type === 'players') {
      searches.push(
        pool.query(`
          SELECT
            'player' as result_type,
            telegram_id as id,
            telegram_id,
            username,
            first_name,
            ton as balance,
            created_at,
            telegram_wallet
          FROM players
          WHERE
            telegram_id::text ILIKE $1
            OR username ILIKE $1
            OR first_name ILIKE $1
            OR telegram_wallet ILIKE $1
          ORDER BY created_at DESC
          LIMIT 20
        `, [`%${query}%`])
      );
    }

    // Поиск транзакций
    if (search_type === 'all' || search_type === 'transactions') {
      searches.push(
        pool.query(`
          SELECT
            'ton_deposit' as result_type,
            id,
            player_id as telegram_id,
            amount,
            transaction_hash,
            status,
            created_at,
            from_address
          FROM ton_deposits
          WHERE
            transaction_hash ILIKE $1
            OR from_address ILIKE $1
            OR player_id::text ILIKE $1
          ORDER BY created_at DESC
          LIMIT 20
        `, [`%${query}%`])
      );

      searches.push(
        pool.query(`
          SELECT
            'withdrawal' as result_type,
            id,
            telegram_id,
            amount,
            transaction_hash,
            status,
            created_at,
            recipient_address
          FROM withdrawals
          WHERE
            transaction_hash ILIKE $1
            OR recipient_address ILIKE $1
            OR telegram_id::text ILIKE $1
          ORDER BY created_at DESC
          LIMIT 20
        `, [`%${query}%`])
      );
    }

    // Поиск по TON адресам
    if (search_type === 'all' || search_type === 'addresses') {
      searches.push(
        pool.query(`
          SELECT DISTINCT
            'ton_address' as result_type,
            COALESCE(td.from_address, w.recipient_address) as address,
            COUNT(DISTINCT td.id) as deposits_count,
            COUNT(DISTINCT w.id) as withdrawals_count,
            COALESCE(SUM(td.amount), 0) as total_deposits,
            COALESCE(SUM(w.amount), 0) as total_withdrawals,
            MIN(COALESCE(td.created_at, w.created_at)) as first_seen,
            MAX(COALESCE(td.created_at, w.created_at)) as last_seen
          FROM ton_deposits td
          FULL OUTER JOIN withdrawals w ON td.from_address = w.recipient_address
          WHERE
            td.from_address ILIKE $1
            OR w.recipient_address ILIKE $1
          GROUP BY COALESCE(td.from_address, w.recipient_address)
          ORDER BY total_deposits DESC
          LIMIT 10
        `, [`%${query}%`])
      );
    }

    const results = await Promise.all(searches);
    const combined_results = results.flatMap(r => r.rows);

    console.log(`🔍 Найдено ${combined_results.length} результатов поиска`);

    res.json({
      success: true,
      results: combined_results,
      count: combined_results.length,
      query: query,
      search_type: search_type
    });

  } catch (error) {
    console.error('❌ Ошибка универсального поиска:', error);
    res.status(500).json({
      error: 'Ошибка поиска',
      details: error.message
    });
  }
});

// 📊 Анализ игрока (детальный профиль)
router.get('/player-analysis/:telegram_id', async (req, res) => {
  const { telegram_id } = req.params;
  const { admin_id } = req.query;

  try {
    console.log(`📊 Анализ игрока ${telegram_id} админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const analysis = await Promise.all([
      // 1. Основная информация об игроке
      pool.query(`
        SELECT
          p.*,
          -- Время с момента регистрации
          EXTRACT(EPOCH FROM (NOW() - p.created_at))/86400 as days_registered,
          -- Последняя активность
          (SELECT MAX(timestamp) FROM player_actions pa WHERE pa.telegram_id = p.telegram_id) as last_activity
        FROM players p
        WHERE p.telegram_id = $1
      `, [telegram_id]),

      // 2. Финансовая история
      pool.query(`
        SELECT
          'deposit' as type,
          td.amount,
          td.created_at,
          td.transaction_hash,
          td.status,
          td.from_address as address
        FROM ton_deposits td
        WHERE td.player_id = $1
        UNION ALL
        SELECT
          'withdrawal' as type,
          w.amount,
          w.created_at,
          w.transaction_hash,
          w.status,
          w.recipient_address as address
        FROM withdrawals w
        WHERE w.telegram_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `, [telegram_id]),

      // 3. Игровая активность
      pool.query(`
        SELECT
          mh.game_type,
          COUNT(*) as games_played,
          SUM(mh.bet_amount) as total_bets,
          SUM(mh.win_amount) as total_wins,
          ROUND(AVG(mh.bet_amount), 4) as avg_bet,
          ROUND((SUM(mh.win_amount) / SUM(mh.bet_amount) * 100), 2) as win_rate,
          MIN(mh.timestamp) as first_game,
          MAX(mh.timestamp) as last_game
        FROM minigames_history mh
        WHERE mh.telegram_id = $1
        GROUP BY mh.game_type
        ORDER BY total_bets DESC
      `, [telegram_id]),

      // 4. Социальные связи
      pool.query(`
        SELECT
          'referral' as relation_type,
          p.telegram_id,
          p.username,
          p.first_name,
          p.created_at,
          COALESCE(SUM(td.amount), 0) as total_deposits
        FROM players p
        LEFT JOIN ton_deposits td ON td.player_id = p.telegram_id AND td.status = 'completed'
        WHERE p.referrer_id = $1
        GROUP BY p.telegram_id, p.username, p.first_name, p.created_at
        UNION ALL
        SELECT
          'referrer' as relation_type,
          ref.telegram_id,
          ref.username,
          ref.first_name,
          ref.created_at,
          COALESCE(SUM(td.amount), 0) as total_deposits
        FROM players p
        JOIN players ref ON ref.telegram_id = p.referrer_id
        LEFT JOIN ton_deposits td ON td.player_id = ref.telegram_id AND td.status = 'completed'
        WHERE p.telegram_id = $1
        GROUP BY ref.telegram_id, ref.username, ref.first_name, ref.created_at
        ORDER BY total_deposits DESC
      `, [telegram_id]),

      // 5. Подозрительная активность
      pool.query(`
        SELECT
          sa.activity_type,
          sa.description,
          sa.risk_level,
          sa.timestamp,
          sa.details
        FROM suspicious_activity sa
        WHERE sa.telegram_id = $1
        ORDER BY sa.timestamp DESC
        LIMIT 20
      `, [telegram_id]),

      // 6. Админские действия с игроком
      pool.query(`
        SELECT
          pa.action_type,
          pa.admin_id,
          pa.timestamp,
          pa.details
        FROM player_actions pa
        WHERE pa.telegram_id = $1
        ORDER BY pa.timestamp DESC
        LIMIT 20
      `, [telegram_id])
    ]);

    const player_profile = {
      basic_info: analysis[0].rows[0] || null,
      financial_history: analysis[1].rows,
      gaming_activity: analysis[2].rows,
      social_connections: analysis[3].rows,
      suspicious_activity: analysis[4].rows,
      admin_actions: analysis[5].rows
    };

    if (!player_profile.basic_info) {
      return res.status(404).json({ error: 'Игрок не найден' });
    }

    // Вычисляем риск-факторы
    const risk_factors = [];

    // Финансовые риски
    const total_deposits = player_profile.financial_history
      .filter(t => t.type === 'deposit' && t.status === 'completed')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const total_withdrawals = player_profile.financial_history
      .filter(t => t.type === 'withdrawal' && t.status === 'completed')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    if (total_withdrawals > total_deposits * 1.5) {
      risk_factors.push({
        type: 'financial',
        level: 'high',
        description: 'Выводы превышают депозиты в 1.5+ раз'
      });
    }

    if (player_profile.basic_info.days_registered < 7 && total_deposits > 50) {
      risk_factors.push({
        type: 'behavioral',
        level: 'medium',
        description: 'Крупные депозиты в первую неделю'
      });
    }

    // Игровые риски
    const total_games = player_profile.gaming_activity.reduce((sum, g) => sum + parseInt(g.games_played), 0);
    const total_win_rate = player_profile.gaming_activity.reduce((sum, g) => sum + parseFloat(g.win_rate || 0), 0) / player_profile.gaming_activity.length;

    if (total_win_rate > 150) {
      risk_factors.push({
        type: 'gaming',
        level: 'high',
        description: `Аномально высокий винрейт: ${total_win_rate.toFixed(1)}%`
      });
    }

    player_profile.risk_assessment = {
      risk_factors: risk_factors,
      overall_risk: risk_factors.length > 2 ? 'high' : risk_factors.length > 0 ? 'medium' : 'low',
      financial_summary: {
        total_deposits: total_deposits,
        total_withdrawals: total_withdrawals,
        net_flow: total_deposits - total_withdrawals,
        total_games: total_games
      }
    };

    console.log(`📊 Анализ игрока ${telegram_id} завершен, риск: ${player_profile.risk_assessment.overall_risk}`);

    res.json({
      success: true,
      analysis: player_profile
    });

  } catch (error) {
    console.error('❌ Ошибка анализа игрока:', error);
    res.status(500).json({
      error: 'Ошибка анализа игрока',
      details: error.message
    });
  }
});

// 🔗 Анализ связей между игроками
router.post('/connection-analysis', async (req, res) => {
  const { admin_id, player_ids, analysis_depth = 2 } = req.body;

  try {
    console.log(`🔗 Анализ связей между игроками админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    if (!player_ids || !Array.isArray(player_ids) || player_ids.length < 2) {
      return res.status(400).json({ error: 'Необходимо минимум 2 игрока для анализа связей' });
    }

    const connections = await Promise.all([
      // 1. Прямые реферальные связи
      pool.query(`
        SELECT
          'referral' as connection_type,
          p1.telegram_id as player1,
          p1.username as username1,
          p2.telegram_id as player2,
          p2.username as username2,
          'referrer-referee' as relationship,
          1.0 as confidence
        FROM players p1
        JOIN players p2 ON p1.telegram_id = p2.referrer_id
        WHERE p1.telegram_id = ANY($1) AND p2.telegram_id = ANY($1)
      `, [player_ids]),

      // 2. Общие TON адреса
      pool.query(`
        SELECT DISTINCT
          'shared_address' as connection_type,
          td1.player_id as player1,
          p1.username as username1,
          td2.player_id as player2,
          p2.username as username2,
          'same_wallet' as relationship,
          0.9 as confidence
        FROM ton_deposits td1
        JOIN ton_deposits td2 ON td1.from_address = td2.from_address
        JOIN players p1 ON p1.telegram_id = td1.player_id
        JOIN players p2 ON p2.telegram_id = td2.player_id
        WHERE td1.player_id != td2.player_id
        AND td1.player_id = ANY($1)
        AND td2.player_id = ANY($1)
      `, [player_ids]),

      // 3. Временная корреляция регистраций
      pool.query(`
        SELECT
          'time_correlation' as connection_type,
          p1.telegram_id as player1,
          p1.username as username1,
          p2.telegram_id as player2,
          p2.username as username2,
          'simultaneous_registration' as relationship,
          CASE
            WHEN ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 300 THEN 0.8  -- 5 минут
            WHEN ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 1800 THEN 0.6  -- 30 минут
            ELSE 0.3
          END as confidence
        FROM players p1
        CROSS JOIN players p2
        WHERE p1.telegram_id < p2.telegram_id
        AND p1.telegram_id = ANY($1)
        AND p2.telegram_id = ANY($1)
        AND ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 3600  -- 1 час
      `, [player_ids]),

      // 4. Похожие транзакции
      pool.query(`
        SELECT
          'similar_transactions' as connection_type,
          td1.player_id as player1,
          p1.username as username1,
          td2.player_id as player2,
          p2.username as username2,
          'similar_amounts' as relationship,
          0.7 as confidence
        FROM ton_deposits td1
        JOIN ton_deposits td2 ON ABS(td2.amount - td1.amount) < 0.001
        JOIN players p1 ON p1.telegram_id = td1.player_id
        JOIN players p2 ON p2.telegram_id = td2.player_id
        WHERE td1.player_id != td2.player_id
        AND td1.player_id = ANY($1)
        AND td2.player_id = ANY($1)
        AND ABS(EXTRACT(EPOCH FROM (td2.created_at - td1.created_at))) < 7200  -- 2 часа
      `, [player_ids])
    ]);

    const all_connections = [
      ...connections[0].rows,
      ...connections[1].rows,
      ...connections[2].rows,
      ...connections[3].rows
    ];

    // Группируем связи по парам игроков
    const connection_map = {};
    all_connections.forEach(conn => {
      const key = `${conn.player1}-${conn.player2}`;
      if (!connection_map[key]) {
        connection_map[key] = {
          player1: conn.player1,
          username1: conn.username1,
          player2: conn.player2,
          username2: conn.username2,
          connections: [],
          total_confidence: 0
        };
      }
      connection_map[key].connections.push({
        type: conn.connection_type,
        relationship: conn.relationship,
        confidence: conn.confidence
      });
      connection_map[key].total_confidence += parseFloat(conn.confidence);
    });

    const connection_summary = Object.values(connection_map)
      .sort((a, b) => b.total_confidence - a.total_confidence);

    console.log(`🔗 Найдено ${connection_summary.length} связей между игроками`);

    res.json({
      success: true,
      connections: connection_summary,
      count: connection_summary.length,
      analysis_depth: analysis_depth
    });

  } catch (error) {
    console.error('❌ Ошибка анализа связей:', error);
    res.status(500).json({
      error: 'Ошибка анализа связей',
      details: error.message
    });
  }
});

// 🚨 Создать подозрительную активность
router.post('/report-suspicious', async (req, res) => {
  const { admin_id, telegram_id, activity_type, description, risk_level = 'medium', details = {} } = req.body;

  try {
    console.log(`🚨 Создание отчета о подозрительной активности админом ${admin_id}`);

    if (!isAdmin(admin_id)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    if (!telegram_id || !activity_type || !description) {
      return res.status(400).json({ error: 'Необходимы telegram_id, activity_type и description' });
    }

    await pool.query(`
      INSERT INTO suspicious_activity (
        telegram_id, activity_type, description, risk_level,
        reported_by, timestamp, details
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
    `, [telegram_id, activity_type, description, risk_level, admin_id, JSON.stringify(details)]);

    console.log(`🚨 Создан отчет о подозрительной активности для игрока ${telegram_id}`);

    res.json({
      success: true,
      message: 'Отчет о подозрительной активности создан',
      telegram_id: telegram_id,
      activity_type: activity_type
    });

  } catch (error) {
    console.error('❌ Ошибка создания отчета:', error);
    res.status(500).json({
      error: 'Ошибка создания отчета',
      details: error.message
    });
  }
});

console.log('✅ Модуль расследований загружен');

module.exports = router;