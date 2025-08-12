// ===== routes/admin.js =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');

const router = express.Router();

// 🔐 АДМИНСКИЙ ID ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

console.log('🔧 Админский модуль загружен. ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID, 'тип:', typeof ADMIN_TELEGRAM_ID);

// 🛡️ Middleware для проверки админских прав
const adminAuth = (req, res, next) => {
  // ИСПРАВЛЕНИЕ: Получаем telegramId из параметров URL
  const telegramId = req.params.telegramId;
  
  console.log('🔐 Проверка админских прав:', { 
    telegramId, 
    telegramIdType: typeof telegramId,
    adminId: ADMIN_TELEGRAM_ID, 
    adminIdType: typeof ADMIN_TELEGRAM_ID,
    // Приводим к строкам для сравнения
    telegramIdStr: String(telegramId),
    adminIdStr: String(ADMIN_TELEGRAM_ID),
    directMatch: telegramId === ADMIN_TELEGRAM_ID,
    stringMatch: String(telegramId) === String(ADMIN_TELEGRAM_ID),
    // Отладка URL параметров
    urlParams: req.params,
    method: req.method,
    url: req.url
  });
  
  if (!telegramId) {
    console.log('🚫 Telegram ID не предоставлен в URL параметрах');
    console.log('🔍 Доступные параметры:', req.params);
    console.log('🔍 URL:', req.url);
    return res.status(400).json({ error: 'Telegram ID is required' });
  }
  
  // ИСПРАВЛЕНИЕ: Приводим оба значения к строкам для правильного сравнения
  const telegramIdStr = String(telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  
  if (telegramIdStr !== adminIdStr) {
    console.log('🚫 Доступ запрещен - не админ:', {
      received: telegramIdStr,
      expected: adminIdStr,
      match: telegramIdStr === adminIdStr
    });
    return res.status(403).json({ error: 'Access denied' });
  }
  
  console.log('✅ Админ права подтверждены для ID:', telegramIdStr);
  next();
};

// 🔍 GET /api/admin/check/:telegramId - проверка админского статуса
router.get('/check/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  
  // ИСПРАВЛЕНИЕ: Приводим к строкам для сравнения
  const telegramIdStr = String(telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  const isAdmin = telegramIdStr === adminIdStr;
  
  console.log('🔍 Проверка админского статуса:', { 
    telegramId: telegramIdStr, 
    adminId: adminIdStr,
    isAdmin,
    receivedType: typeof telegramId,
    adminType: typeof ADMIN_TELEGRAM_ID
  });
  
  res.json({ 
    isAdmin,
    timestamp: new Date().toISOString(),
    // Отладочная информация (удалить в продакшене)
    debug: {
      receivedId: telegramIdStr,
      expectedId: adminIdStr,
      typesMatch: typeof telegramId === typeof ADMIN_TELEGRAM_ID,
      stringMatch: telegramIdStr === adminIdStr
    }
  });
});

// 📊 GET /api/admin/stats/:telegramId - общая статистика системы (БЕЗ middleware)
// Обновленная часть для routes/admin.js - endpoint /api/admin/stats/:telegramId
// Используем существующие таблицы: balance_history, star_transactions

// 📊 GET /api/admin/stats/:telegramId - общая статистика системы 
// ===== ИСПРАВЛЕННАЯ ЧАСТЬ routes/admin.js =====
// Заменить существующий endpoint /api/admin/stats/:telegramId

router.get('/stats/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    console.log('📊 Запрос общей статистики системы от ID:', telegramId);
    
    // ПРОВЕРЯЕМ АДМИНА
    const telegramIdStr = String(telegramId).trim();
    const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
    
    if (telegramIdStr !== adminIdStr) {
      console.log('🚫 Статистика: доступ запрещен - не админ');
      return res.status(403).json({ error: 'Access denied' });
    }
    
    console.log('✅ Статистика: админ права подтверждены, загружаем данные...');
    
    // 1. ИСПРАВЛЯЕМ статистику игроков - проверяем реальные поля
    console.log('🔍 Проверяем структуру таблицы players...');
    
    // Сначала узнаем какие поля есть в таблице players
    const playerColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'players' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Поля таблицы players:', playerColumns.rows.map(r => `${r.column_name}(${r.data_type})`));
    
    // Ищем поле активности - может быть last_activity, last_seen, updated_at
    const activityField = playerColumns.rows.find(col => 
      col.column_name.includes('activity') || 
      col.column_name.includes('last_') || 
      col.column_name === 'updated_at'
    )?.column_name || 'created_at'; // fallback на created_at
    
    console.log('🕒 Используем поле активности:', activityField);
    
    // ИСПРАВЛЕННЫЙ запрос статистики игроков
    const playersStats = await pool.query(`
      SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_players,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d
      FROM players
    `);
        
    // 2. Статистика валют - остается без изменений
    const currencyStats = await pool.query(`
      SELECT 
        COALESCE(SUM(ccc), 0) as total_ccc,
        COALESCE(SUM(cs), 0) as total_cs,
        COALESCE(SUM(ton), 0) as total_ton,
        COALESCE(SUM(telegram_stars), 0) as total_stars,
        COALESCE(AVG(ccc), 0) as avg_ccc,
        COALESCE(AVG(cs), 0) as avg_cs,
        COALESCE(AVG(ton), 0) as avg_ton
      FROM players
    `);
    
    // 3. ИСПРАВЛЯЕМ обмены - проверяем реальные значения reason
    console.log('🔍 Проверяем значения reason в balance_history...');
    
    const reasonValues = await pool.query(`
      SELECT DISTINCT reason, COUNT(*) as count
      FROM balance_history 
      WHERE reason IS NOT NULL 
      ORDER BY count DESC 
      LIMIT 20
    `);
    
    console.log('📋 Найденные значения reason:', reasonValues.rows);
    
    // Stars → CS обмены из star_transactions (остается без изменений)
    const starsExchangeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_exchanges,
        COALESCE(SUM(ABS(amount)), 0) as total_stars_exchanged,
        COALESCE(SUM(cs_amount), 0) as total_cs_received,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as exchanges_24h
      FROM star_transactions 
      WHERE transaction_type = 'stars_to_cs_exchange' AND status = 'completed'
    `);

    // 4. ИСПРАВЛЯЕМ CCC ↔ CS обмены - используем реальные значения reason
    const cccCsExchangeStats = await pool.query(`
      SELECT 
        -- Ищем любые записи связанные с обменом (exchange, convert, swap)
        COUNT(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                   AND currency = 'ccc' AND change_amount < 0 THEN 1 END) as ccc_to_cs_exchanges,
        
        COUNT(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                   AND currency = 'cs' AND change_amount < 0 THEN 1 END) as cs_to_ccc_exchanges,
        
        COALESCE(SUM(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                              AND currency = 'ccc' AND change_amount < 0 
                         THEN ABS(change_amount) ELSE 0 END), 0) as total_ccc_exchanged,
        
        COALESCE(SUM(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                              AND currency = 'cs' AND change_amount < 0 
                         THEN ABS(change_amount) ELSE 0 END), 0) as total_cs_exchanged,
        
        -- За 24 часа
        COUNT(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                   AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as exchanges_24h
      FROM balance_history 
      WHERE created_at IS NOT NULL
    `);

    // 5. ИСПРАВЛЯЕМ CS ↔ TON обмены
    const csTonExchangeStats = await pool.query(`
      SELECT 
        COUNT(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                   AND (reason ILIKE '%ton%') AND currency = 'cs' AND change_amount < 0 THEN 1 END) as cs_to_ton_exchanges,
        
        COUNT(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                   AND (reason ILIKE '%ton%') AND currency = 'ton' AND change_amount < 0 THEN 1 END) as ton_to_cs_exchanges,
        
        COALESCE(SUM(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                              AND (reason ILIKE '%ton%') AND currency = 'cs' AND change_amount < 0 
                         THEN ABS(change_amount) ELSE 0 END), 0) as total_cs_to_ton_amount,
        
        COALESCE(SUM(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                              AND (reason ILIKE '%ton%') AND currency = 'ton' AND change_amount < 0 
                         THEN ABS(change_amount) ELSE 0 END), 0) as total_ton_to_cs_amount,
        
        COUNT(CASE WHEN (reason ILIKE '%exchange%' OR reason ILIKE '%convert%' OR reason ILIKE '%swap%') 
                   AND (reason ILIKE '%ton%') AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as ton_exchanges_24h
      FROM balance_history 
      WHERE created_at IS NOT NULL
    `);

    // 6. Статистика мини-игр - проверяем существование таблицы
    let minigamesStats = { rows: [{ 
      total_games: 0, 
      active_players: 0, 
      total_bet: 0, 
      total_won: 0, 
      total_jackpot_contribution: 0, 
      games_24h: 0 
    }] };
    
    try {
      minigamesStats = await pool.query(`
        SELECT 
          COUNT(*) as total_games,
          COUNT(DISTINCT telegram_id) as active_players,
          COALESCE(SUM(bet_amount), 0) as total_bet,
          COALESCE(SUM(win_amount), 0) as total_won,
          COALESCE(SUM(jackpot_contribution), 0) as total_jackpot_contribution,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as games_24h
        FROM minigames_history
      `);
    } catch (minigamesError) {
      console.log('⚠️ Таблица minigames_history не существует или недоступна:', minigamesError.message);
    }

    // 7. ТОП 10 игроков по CS
    const topPlayers = await pool.query(`
      SELECT 
        telegram_id, 
        COALESCE(username, '') as username, 
        COALESCE(first_name, '') as first_name, 
        COALESCE(cs, 0) as cs, 
        COALESCE(ccc, 0) as ccc, 
        COALESCE(ton, 0) as ton, 
        COALESCE(telegram_stars, 0) as telegram_stars, 
        COALESCE(verified, false) as verified
      FROM players 
      ORDER BY cs DESC 
      LIMIT 10
    `);
    
    // 8. Статистика курсов - проверяем существование таблицы
    let ratesStats = { rows: [] };
    let currentRates = {};
    
    try {
      ratesStats = await pool.query(`
        SELECT currency_pair, rate, last_updated, source
        FROM exchange_rates 
        WHERE currency_pair IN ('TON_USD', 'STARS_CS')
        ORDER BY currency_pair, last_updated DESC
      `);
      
      for (const row of ratesStats.rows) {
        if (!currentRates[row.currency_pair]) {
          currentRates[row.currency_pair] = row;
        }
      }
    } catch (ratesError) {
      console.log('⚠️ Таблица exchange_rates не существует или недоступна:', ratesError.message);
      // Устанавливаем дефолтные курсы
      currentRates = {
        'TON_USD': { currency_pair: 'TON_USD', rate: 3.30, source: 'default' },
        'STARS_CS': { currency_pair: 'STARS_CS', rate: 0.10, source: 'default' }
      };
    }
    
    // 9. СОБИРАЕМ ВСЕ СТАТИСТИКИ
    const allExchangeStats = {
      stars_to_cs: {
        total_exchanges: parseInt(starsExchangeStats.rows[0]?.total_exchanges || 0),
        total_stars_exchanged: parseFloat(starsExchangeStats.rows[0]?.total_stars_exchanged || 0),
        total_cs_received: parseFloat(starsExchangeStats.rows[0]?.total_cs_received || 0),
        exchanges_24h: parseInt(starsExchangeStats.rows[0]?.exchanges_24h || 0)
      },
      
      ccc_cs: {
        ccc_to_cs_exchanges: parseInt(cccCsExchangeStats.rows[0]?.ccc_to_cs_exchanges || 0),
        cs_to_ccc_exchanges: parseInt(cccCsExchangeStats.rows[0]?.cs_to_ccc_exchanges || 0),
        total_ccc_exchanged: parseFloat(cccCsExchangeStats.rows[0]?.total_ccc_exchanged || 0),
        total_cs_exchanged: parseFloat(cccCsExchangeStats.rows[0]?.total_cs_exchanged || 0),
        exchanges_24h: parseInt(cccCsExchangeStats.rows[0]?.exchanges_24h || 0)
      },
      
      cs_ton: {
        cs_to_ton_exchanges: parseInt(csTonExchangeStats.rows[0]?.cs_to_ton_exchanges || 0),
        ton_to_cs_exchanges: parseInt(csTonExchangeStats.rows[0]?.ton_to_cs_exchanges || 0),
        total_cs_to_ton_amount: parseFloat(csTonExchangeStats.rows[0]?.total_cs_to_ton_amount || 0),
        total_ton_to_cs_amount: parseFloat(csTonExchangeStats.rows[0]?.total_ton_to_cs_amount || 0),
        ton_exchanges_24h: parseInt(csTonExchangeStats.rows[0]?.ton_exchanges_24h || 0)
      },
      
      totals: {
        all_exchanges: 
          parseInt(starsExchangeStats.rows[0]?.total_exchanges || 0) +
          parseInt(cccCsExchangeStats.rows[0]?.ccc_to_cs_exchanges || 0) +
          parseInt(cccCsExchangeStats.rows[0]?.cs_to_ccc_exchanges || 0) +
          parseInt(csTonExchangeStats.rows[0]?.cs_to_ton_exchanges || 0) +
          parseInt(csTonExchangeStats.rows[0]?.ton_to_cs_exchanges || 0),
        
        all_exchanges_24h:
          parseInt(starsExchangeStats.rows[0]?.exchanges_24h || 0) +
          parseInt(cccCsExchangeStats.rows[0]?.exchanges_24h || 0) +
          parseInt(csTonExchangeStats.rows[0]?.ton_exchanges_24h || 0)
      }
    };
    
    const result = {
      players: playersStats.rows[0],
      currencies: currencyStats.rows[0],
      stars_exchange: allExchangeStats.stars_to_cs,
      all_exchanges: allExchangeStats,
      minigames: minigamesStats.rows[0],
      top_players: topPlayers.rows,
      current_rates: currentRates,
      timestamp: new Date().toISOString(),
      
      // Отладочная информация
      debug: {
        activity_field_used: activityField,
        reason_values_found: reasonValues.rows.length,
        top_reasons: reasonValues.rows.slice(0, 5).map(r => `${r.reason}(${r.count})`),
        tables_checked: ['players', 'balance_history', 'star_transactions', 'minigames_history', 'exchange_rates']
      }
    };
    
    console.log('✅ Статистика успешно собрана:', {
      totalPlayers: result.players.total_players,
      active24h: result.players.active_24h,
      totalCS: result.currencies.total_cs,
      starsExchanges: result.all_exchanges.stars_to_cs.total_exchanges,
      cccCsExchanges: result.all_exchanges.ccc_cs.ccc_to_cs_exchanges + result.all_exchanges.ccc_cs.cs_to_ccc_exchanges,
      activityFieldUsed: activityField,
      reasonValuesFound: reasonValues.rows.length
    });
    
    res.json(result);
    
  } catch (err) {
    console.error('❌ Ошибка получения статистики:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// 🔐 Все остальные маршруты используют middleware (кроме check и stats)
router.use(['!/check/*', '!/stats/*'], adminAuth);

// 👤 GET /api/admin/player/:telegramId/:playerId - информация об игроке
router.get('/player/:telegramId/:playerId', async (req, res) => {
  const { playerId } = req.params;
  
  try {
    console.log(`👤 Запрос информации об игроке: ${playerId}`);
    
    const player = await getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // История действий игрока (последние 50)
    const actionsResult = await pool.query(`
      SELECT action_type, amount, created_at, details
      FROM player_actions 
      WHERE telegram_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [playerId]);
    
    // История обменов Stars
    const starsHistory = await pool.query(`
      SELECT amount, cs_amount, exchange_rate, created_at, status
      FROM star_transactions 
      WHERE player_id = $1 
        AND transaction_type = 'stars_to_cs_exchange'
      ORDER BY created_at DESC 
      LIMIT 20
    `, [playerId]);
    
    // Статистика рефералов
    const referralStats = await pool.query(`
      SELECT COUNT(*) as referrals_count
      FROM players 
      WHERE referrer_id = $1
    `, [playerId]);
    
    res.json({
      player,
      recent_actions: actionsResult.rows,
      stars_history: starsHistory.rows,
      referral_stats: referralStats.rows[0],
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения данных игрока:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 💰 POST /api/admin/update-balance/:telegramId - обновление баланса игрока
router.post('/update-balance/:telegramId', async (req, res) => {
  const { playerId, currency, amount, operation } = req.body;
  
  if (!playerId || !currency || amount === undefined || !operation) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`💰 Обновление баланса: ${playerId}, ${currency}, ${operation} ${amount}`);
    
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    let updateQuery = '';
    let newBalance = 0;
    
    switch (currency.toLowerCase()) {
      case 'ccc':
        if (operation === 'set') {
          newBalance = parseFloat(amount);
          updateQuery = 'UPDATE players SET ccc = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseFloat(player.ccc) + parseFloat(amount);
          updateQuery = 'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2';
        }
        break;
      case 'cs':
        if (operation === 'set') {
          newBalance = parseFloat(amount);
          updateQuery = 'UPDATE players SET cs = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseFloat(player.cs) + parseFloat(amount);
          updateQuery = 'UPDATE players SET cs = cs + $1 WHERE telegram_id = $2';
        }
        break;
      case 'ton':
        if (operation === 'set') {
          newBalance = parseFloat(amount);
          updateQuery = 'UPDATE players SET ton = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseFloat(player.ton) + parseFloat(amount);
          updateQuery = 'UPDATE players SET ton = ton + $1 WHERE telegram_id = $2';
        }
        break;
      case 'stars':
        if (operation === 'set') {
          newBalance = parseInt(amount);
          updateQuery = 'UPDATE players SET telegram_stars = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseInt(player.telegram_stars || 0) + parseInt(amount);
          updateQuery = 'UPDATE players SET telegram_stars = telegram_stars + $1 WHERE telegram_id = $2';
        }
        break;
      default:
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid currency' });
    }
    
    await client.query(updateQuery, [amount, playerId]);
    
    // Логируем административное действие
    await client.query(`
      INSERT INTO player_actions (telegram_id, action_type, amount, details)
      VALUES ($1, $2, $3, $4)
    `, [
      playerId,
      'admin_balance_update',
      amount,
      JSON.stringify({
        admin_id: req.params.telegramId,
        currency,
        operation,
        old_balance: operation === 'set' ? player[currency] : null,
        new_balance: newBalance
      })
    ]);
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Баланс обновлен: ${playerId} ${currency} ${operation} ${amount}`);
    
    res.json({
      success: true,
      player: updatedPlayer,
      operation: {
        currency,
        operation,
        amount,
        new_balance: newBalance
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка обновления баланса:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// 🔧 POST /api/admin/verify-player/:telegramId - верификация игрока
router.post('/verify-player/:telegramId', async (req, res) => {
  const { playerId, verified } = req.body;
  
  if (!playerId || verified === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    console.log(`🔧 Изменение верификации: ${playerId} -> ${verified}`);
    
    await pool.query(
      'UPDATE players SET verified = $1 WHERE telegram_id = $2',
      [verified, playerId]
    );
    
    // Логируем действие
    await pool.query(`
      INSERT INTO player_actions (telegram_id, action_type, details)
      VALUES ($1, $2, $3)
    `, [
      playerId,
      'admin_verification_change',
      JSON.stringify({
        admin_id: req.params.telegramId,
        verified_status: verified
      })
    ]);
    
    const updatedPlayer = await getPlayer(playerId);
    
    res.json({
      success: true,
      player: updatedPlayer
    });
    
  } catch (err) {
    console.error('❌ Ошибка верификации игрока:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 📈 POST /api/admin/update-ton-rate/:telegramId - обновление курса TON
router.post('/update-ton-rate/:telegramId', async (req, res) => {
  const { newRate } = req.body;
  
  if (!newRate || newRate <= 0) {
    return res.status(400).json({ error: 'Invalid rate' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`📈 Админ обновляет курс TON: ${newRate}`);
    
    // Получаем предыдущий курс
    const prevResult = await client.query(
      'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY last_updated DESC LIMIT 1',
      ['TON_USD']
    );
    
    const previousRate = prevResult.rows[0]?.rate || 3.30;
    
    // Вставляем новый курс TON
    await client.query(`
      INSERT INTO exchange_rates (currency_pair, rate, previous_rate, source, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'TON_USD',
      newRate,
      previousRate,
      'admin_manual',
      JSON.stringify({
        admin_update: true,
        admin_id: req.params.telegramId,
        rate_change_percent: ((newRate - previousRate) / previousRate * 100).toFixed(2)
      })
    ]);
    
    // Обновляем курс Stars → CS
    await client.query('SELECT update_stars_cs_rate()');
    
    await client.query('COMMIT');
    
    console.log(`✅ Курс TON обновлен админом: ${previousRate} → ${newRate}`);
    
    res.json({
      success: true,
      previous_rate: previousRate,
      new_rate: newRate,
      source: 'admin_manual'
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка админского обновления курса TON:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// 🔓 POST /api/admin/unblock-exchange/:telegramId - снятие блокировки обмена
router.post('/unblock-exchange/:telegramId', async (req, res) => {
  const { exchangeType = 'stars_to_cs' } = req.body;
  
  try {
    console.log(`🔓 Снятие блокировки обмена: ${exchangeType}`);
    
    await pool.query(`
      UPDATE exchange_blocks 
      SET blocked_until = NOW() 
      WHERE exchange_type = $1 AND blocked_until > NOW()
    `, [exchangeType]);
    
    // Логируем действие
    await pool.query(`
      INSERT INTO player_actions (telegram_id, action_type, details)
      VALUES ($1, $2, $3)
    `, [
      req.params.telegramId,
      'admin_unblock_exchange',
      JSON.stringify({
        exchange_type: exchangeType,
        admin_id: req.params.telegramId
      })
    ]);
    
    console.log(`✅ Блокировка обмена ${exchangeType} снята админом`);
    
    res.json({
      success: true,
      exchange_type: exchangeType,
      message: 'Exchange unblocked successfully'
    });
    
  } catch (err) {
    console.error('❌ Ошибка снятия блокировки:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 🔍 GET /api/admin/search/:telegramId - поиск игроков
router.get('/search/:telegramId', async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Search query too short' });
  }
  
  try {
    console.log(`🔍 Поиск игроков: "${q}"`);
    
    const result = await pool.query(`
      SELECT 
        telegram_id, 
        username, 
        first_name, 
        COALESCE(cs, 0) as cs, 
        COALESCE(ccc, 0) as ccc, 
        COALESCE(ton, 0) as ton, 
        COALESCE(telegram_stars, 0) as telegram_stars, 
        COALESCE(verified, false) as verified, 
        last_activity
      FROM players 
      WHERE 
        telegram_id::text ILIKE $1 
        OR username ILIKE $1 
        OR first_name ILIKE $1
      ORDER BY cs DESC
      LIMIT 20
    `, [`%${q}%`]);
    
    res.json({
      query: q,
      results: result.rows,
      count: result.rows.length
    });
    
  } catch (err) {
    console.error('❌ Ошибка поиска игроков:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 🔧 GET /api/admin/debug/:telegramId - отладочная информация (только для разработки)
router.get('/debug/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  
  const debugInfo = {
    received_telegram_id: telegramId,
    received_type: typeof telegramId,
    admin_telegram_id: ADMIN_TELEGRAM_ID,
    admin_type: typeof ADMIN_TELEGRAM_ID,
    string_comparison: String(telegramId) === String(ADMIN_TELEGRAM_ID),
    direct_comparison: telegramId === ADMIN_TELEGRAM_ID,
    env_vars: {
      NODE_ENV: process.env.NODE_ENV,
      ADMIN_TELEGRAM_ID: process.env.ADMIN_TELEGRAM_ID
    },
    timestamp: new Date().toISOString()
  };
  
  console.log('🔧 Debug запрос:', debugInfo);
  
  res.json(debugInfo);
});

module.exports = router;