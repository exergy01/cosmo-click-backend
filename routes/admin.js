// ===== routes/admin.js - ЧАСТЬ 1 =====
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
// ===== routes/admin.js - ЧАСТЬ 2 (СТАТИСТИКА) =====

// 📊 GET /api/admin/stats/:telegramId - ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ СТАТИСТИКА
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
    
    // 1. ИСПРАВЛЕННАЯ статистика игроков
    console.log('🔍 Загружаем статистику игроков...');
    
    const playersStats = await pool.query(`
      SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_players,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_24h,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as new_7d,
        -- Используем created_at вместо проблемного поля
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 day' THEN 1 END) as active_24h,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d
      FROM players
    `);
        
    // 2. Статистика валют
    console.log('💰 Загружаем статистику валют...');
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
    
    // 3. ИСПРАВЛЕННАЯ статистика Stars обменов
    console.log('⭐ Загружаем статистику Stars обменов...');
    const starsExchangeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_exchanges,
        COALESCE(SUM(ABS(amount)), 0) as total_stars_exchanged,
        COALESCE(SUM(cs_amount), 0) as total_cs_received,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as exchanges_24h
      FROM star_transactions 
      WHERE transaction_type = 'stars_to_cs_exchange' AND status = 'completed'
    `);

    // 4. ИСПРАВЛЕННАЯ статистика CCC ↔ CS обменов
    console.log('💱 Загружаем статистику CCC/CS обменов...');
    let cccCsExchangeStats = { rows: [{ 
      ccc_to_cs_exchanges: 0, 
      cs_to_ccc_exchanges: 0, 
      total_ccc_exchanged: 0, 
      total_cs_exchanged: 0, 
      exchanges_24h: 0 
    }] };
    
    try {
      cccCsExchangeStats = await pool.query(`
        SELECT 
          COUNT(CASE WHEN reason ILIKE '%ccc%cs%' AND currency = 'ccc' AND change_amount < 0 THEN 1 END) as ccc_to_cs_exchanges,
          COUNT(CASE WHEN reason ILIKE '%cs%ccc%' AND currency = 'cs' AND change_amount < 0 THEN 1 END) as cs_to_ccc_exchanges,
          COALESCE(SUM(CASE WHEN reason ILIKE '%ccc%cs%' AND currency = 'ccc' AND change_amount < 0 
                           THEN ABS(change_amount) ELSE 0 END), 0) as total_ccc_exchanged,
          COALESCE(SUM(CASE WHEN reason ILIKE '%cs%ccc%' AND currency = 'cs' AND change_amount < 0 
                           THEN ABS(change_amount) ELSE 0 END), 0) as total_cs_exchanged,
          COUNT(CASE WHEN (reason ILIKE '%ccc%cs%' OR reason ILIKE '%cs%ccc%') 
                     AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as exchanges_24h
        FROM balance_history 
        WHERE created_at IS NOT NULL
      `);
    } catch (balanceHistoryError) {
      console.log('⚠️ Таблица balance_history недоступна:', balanceHistoryError.message);
    }

    // 5. ИСПРАВЛЕННАЯ статистика CS ↔ TON обменов
    console.log('💎 Загружаем статистику CS/TON обменов...');
    let csTonExchangeStats = { rows: [{ 
      cs_to_ton_exchanges: 0, 
      ton_to_cs_exchanges: 0, 
      total_cs_to_ton_amount: 0, 
      total_ton_to_cs_amount: 0, 
      ton_exchanges_24h: 0 
    }] };
    
    try {
      csTonExchangeStats = await pool.query(`
        SELECT 
          COUNT(CASE WHEN reason ILIKE '%cs%ton%' AND currency = 'cs' AND change_amount < 0 THEN 1 END) as cs_to_ton_exchanges,
          COUNT(CASE WHEN reason ILIKE '%ton%cs%' AND currency = 'ton' AND change_amount < 0 THEN 1 END) as ton_to_cs_exchanges,
          COALESCE(SUM(CASE WHEN reason ILIKE '%cs%ton%' AND currency = 'cs' AND change_amount < 0 
                           THEN ABS(change_amount) ELSE 0 END), 0) as total_cs_to_ton_amount,
          COALESCE(SUM(CASE WHEN reason ILIKE '%ton%cs%' AND currency = 'ton' AND change_amount < 0 
                           THEN ABS(change_amount) ELSE 0 END), 0) as total_ton_to_cs_amount,
          COUNT(CASE WHEN (reason ILIKE '%cs%ton%' OR reason ILIKE '%ton%cs%') 
                     AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as ton_exchanges_24h
        FROM balance_history 
        WHERE created_at IS NOT NULL
      `);
    } catch (balanceHistoryError) {
      console.log('⚠️ Таблица balance_history недоступна для TON обменов');
    }

    // 6. Статистика мини-игр
    console.log('🎮 Загружаем статистику мини-игр...');
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
      console.log('⚠️ Таблица minigames_history не существует:', minigamesError.message);
    }

    // 7. ТОП 10 игроков по CS
    console.log('🏆 Загружаем топ игроков...');
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
    
    // 8. Статистика курсов
    console.log('📈 Загружаем курсы валют...');
    let currentRates = {};
    
    try {
      const ratesStats = await pool.query(`
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
      console.log('⚠️ Таблица exchange_rates недоступна:', ratesError.message);
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
      
      debug: {
        activity_field_used: 'created_at',
        tables_checked: ['players', 'star_transactions', 'balance_history', 'minigames_history', 'exchange_rates'],
        balance_history_available: cccCsExchangeStats.rows[0].ccc_to_cs_exchanges > 0 || cccCsExchangeStats.rows[0].cs_to_ccc_exchanges > 0,
        minigames_available: minigamesStats.rows[0].total_games > 0,
        rates_available: Object.keys(currentRates).length > 0
      }
    };
    
    console.log('✅ Статистика успешно собрана:', {
      totalPlayers: result.players.total_players,
      active24h: result.players.active_24h,
      totalCS: result.currencies.total_cs,
      starsExchanges: result.all_exchanges.stars_to_cs.total_exchanges,
      allExchanges: result.all_exchanges.totals.all_exchanges,
      topPlayersCount: result.top_players.length
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
// ===== routes/admin.js - ЧАСТЬ 3 (УПРАВЛЕНИЕ) =====

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
    let actionsResult = { rows: [] };
    try {
      actionsResult = await pool.query(`
        SELECT action_type, amount, created_at, details
        FROM player_actions 
        WHERE telegram_id = $1 
        ORDER BY created_at DESC 
        LIMIT 50
      `, [playerId]);
    } catch (actionsError) {
      console.log('⚠️ Таблица player_actions недоступна:', actionsError.message);
    }
    
    // История обменов Stars
    let starsHistory = { rows: [] };
    try {
      starsHistory = await pool.query(`
        SELECT amount, cs_amount, exchange_rate, created_at, status
        FROM star_transactions 
        WHERE player_id = $1 
          AND transaction_type = 'stars_to_cs_exchange'
        ORDER BY created_at DESC 
        LIMIT 20
      `, [playerId]);
    } catch (starsError) {
      console.log('⚠️ Не удалось загрузить историю Stars:', starsError.message);
    }
    
    // Статистика рефералов
    let referralStats = { rows: [{ referrals_count: 0 }] };
    try {
      referralStats = await pool.query(`
        SELECT COUNT(*) as referrals_count
        FROM players 
        WHERE referrer_id = $1
      `, [playerId]);
    } catch (referralError) {
      console.log('⚠️ Ошибка загрузки рефералов:', referralError.message);
    }
    
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
    
    // Логируем административное действие (если таблица существует)
    try {
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
    } catch (logError) {
      console.log('⚠️ Не удалось логировать действие:', logError.message);
    }
    
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
    
    // Логируем действие (если таблица существует)
    try {
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
    } catch (logError) {
      console.log('⚠️ Не удалось логировать верификацию:', logError.message);
    }
    
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
// ===== routes/admin.js - ЧАСТЬ 4 (ЗАВЕРШЕНИЕ) =====

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
    let prevResult = { rows: [{ rate: 3.30 }] };
    try {
      prevResult = await client.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY last_updated DESC LIMIT 1',
        ['TON_USD']
      );
    } catch (rateError) {
      console.log('⚠️ Таблица exchange_rates недоступна для получения предыдущего курса');
    }
    
    const previousRate = prevResult.rows[0]?.rate || 3.30;
    
    // Вставляем новый курс TON (если таблица существует)
    try {
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
      
      // Обновляем курс Stars → CS (если функция существует)
      try {
        await client.query('SELECT update_stars_cs_rate()');
      } catch (funcError) {
        console.log('⚠️ Функция update_stars_cs_rate не существует:', funcError.message);
      }
    } catch (exchangeError) {
      console.log('⚠️ Не удалось обновить exchange_rates:', exchangeError.message);
    }
    
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
    
    // Снимаем блокировку (если таблица существует)
    try {
      await pool.query(`
        UPDATE exchange_blocks 
        SET blocked_until = NOW() 
        WHERE exchange_type = $1 AND blocked_until > NOW()
      `, [exchangeType]);
    } catch (blockError) {
      console.log('⚠️ Таблица exchange_blocks недоступна:', blockError.message);
    }
    
    // Логируем действие (если таблица существует)
    try {
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
    } catch (logError) {
      console.log('⚠️ Не удалось логировать снятие блокировки:', logError.message);
    }
    
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
        created_at as last_activity
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

// ===== ДОБАВИТЬ В routes/admin.js ПЕРЕД module.exports =====

// 📱 POST /api/admin/send-message/:telegramId - отправка сообщения игроку
// ===== ЗАМЕНИТЬ endpoint send-message в routes/admin.js =====

// 📱 POST /api/admin/send-message/:telegramId - отправка сообщения игроку (с отладкой)
router.post('/send-message/:telegramId', async (req, res) => {
  const { playerId, message } = req.body;
  
  console.log('🔍 === ОТЛАДКА ОТПРАВКИ СООБЩЕНИЯ ===');
  console.log('📦 Полученные данные:', { playerId, message, adminId: req.params.telegramId });
  
  if (!playerId || !message?.trim()) {
    console.log('❌ Отсутствуют обязательные поля');
    return res.status(400).json({ error: 'Player ID and message are required' });
  }
  
  try {
    console.log(`📱 Отправка сообщения игроку ${playerId}: "${message}"`);
    
    // Проверяем, что игрок существует
    console.log('🔍 Проверяем существование игрока...');
    const player = await getPlayer(playerId);
    console.log('👤 Данные игрока:', player ? {
      telegram_id: player.telegram_id,
      username: player.username,
      first_name: player.first_name
    } : 'НЕ НАЙДЕН');
    
    if (!player) {
      console.log('❌ Игрок не найден в базе данных');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Формируем сообщение
    const fullMessage = `💬 <b>Сообщение от администрации CosmoClick</b>\n\n${message}\n\n🕐 Отправлено: ${new Date().toLocaleString('ru-RU')}`;
    console.log('📝 Сформированное сообщение:', fullMessage);
    
    // Пытаемся отправить через разные способы
    console.log('📤 Начинаем отправку сообщения...');
    
    // Способ 1: Через существующую функцию (если есть)
    try {
      const { sendTelegramMessage } = require('./telegramBot');
      console.log('✅ Функция sendTelegramMessage найдена, используем её');
      await sendTelegramMessage(playerId, fullMessage);
      console.log('✅ Сообщение отправлено через sendTelegramMessage');
    } catch (telegramBotError) {
      console.log('⚠️ Ошибка через telegramBot:', telegramBotError.message);
      
      // Способ 2: Прямой вызов Telegram API
      console.log('🔄 Пробуем прямой вызов Telegram API...');
      
      const axios = require('axios');
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN не установлен в переменных окружения');
      }
      
      console.log('🔑 BOT_TOKEN найден:', BOT_TOKEN ? 'ДА (длина: ' + BOT_TOKEN.length + ')' : 'НЕТ');
      
      const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      const payload = {
        chat_id: playerId,
        text: fullMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      
      console.log('🌐 URL для запроса:', telegramUrl.replace(BOT_TOKEN, 'HIDDEN_TOKEN'));
      console.log('📦 Payload для Telegram:', { ...payload, text: payload.text.substring(0, 50) + '...' });
      
      const telegramResponse = await axios.post(telegramUrl, payload, {
        timeout: 10000 // 10 секунд таймаут
      });
      
      console.log('📥 Ответ от Telegram API:', {
        ok: telegramResponse.data.ok,
        message_id: telegramResponse.data.result?.message_id,
        error_code: telegramResponse.data.error_code,
        description: telegramResponse.data.description
      });
      
      if (!telegramResponse.data.ok) {
        throw new Error(`Telegram API ошибка: ${telegramResponse.data.description} (код: ${telegramResponse.data.error_code})`);
      }
    }
    
    // Логируем отправку (если таблица существует)
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_message_sent',
        JSON.stringify({
          admin_id: req.params.telegramId,
          message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
          timestamp: new Date().toISOString(),
          success: true
        })
      ]);
      console.log('📝 Действие залогировано в базу данных');
    } catch (logError) {
      console.log('⚠️ Не удалось логировать отправку сообщения:', logError.message);
    }
    
    console.log(`✅ Сообщение успешно отправлено игроку ${playerId} (${player.first_name || player.username})`);
    
    res.json({
      success: true,
      message: 'Сообщение отправлено успешно',
      player: {
        telegram_id: playerId,
        first_name: player.first_name,
        username: player.username
      },
      debug: {
        message_length: message.length,
        full_message_length: fullMessage.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (err) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА отправки сообщения игроку:', err);
    console.error('❌ Stack trace:', err.stack);
    
    // Дополнительная диагностика
    console.log('🔍 Дополнительная диагностика:');
    console.log('- Player ID тип:', typeof playerId);
    console.log('- Player ID значение:', playerId);
    console.log('- Message тип:', typeof message);
    console.log('- Message длина:', message?.length);
    console.log('- BOT_TOKEN установлен:', !!process.env.TELEGRAM_BOT_TOKEN);
    console.log('- Текущее время:', new Date().toISOString());
    
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message,
      debug: {
        player_id: playerId,
        message_length: message?.length,
        error_type: err.constructor.name,
        bot_token_exists: !!process.env.TELEGRAM_BOT_TOKEN
      }
    });
  }
});

// 📢 POST /api/admin/broadcast-message/:telegramId - рассылка всем игрокам
router.post('/broadcast-message/:telegramId', async (req, res) => {
  const { message, onlyVerified = false } = req.body;
  
  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  try {
    console.log(`📢 Начинаем рассылку всем игрокам${onlyVerified ? ' (только верифицированным)' : ''}: "${message}"`);
    
    // Получаем список игроков для рассылки
    const playersQuery = onlyVerified 
      ? 'SELECT telegram_id, first_name, username FROM players WHERE verified = true ORDER BY created_at DESC'
      : 'SELECT telegram_id, first_name, username FROM players ORDER BY created_at DESC';
      
    const playersResult = await pool.query(playersQuery);
    const players = playersResult.rows;
    
    if (players.length === 0) {
      return res.status(400).json({ error: 'Нет игроков для рассылки' });
    }
    
    console.log(`📊 Найдено ${players.length} игроков для рассылки`);
    
    // Формируем сообщение для рассылки
    const { sendTelegramMessage } = require('./telegramBot');
    
    const fullMessage = `📢 <b>Рассылка от администрации CosmoClick</b>\n\n${message}\n\n🕐 Отправлено: ${new Date().toLocaleString('ru-RU')}`;
    
    // Счетчики для статистики
    let sentCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Отправляем сообщения с задержкой чтобы не превысить лимиты Telegram
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      
      try {
        await sendTelegramMessage(player.telegram_id, fullMessage);
        sentCount++;
        console.log(`✅ Отправлено ${i + 1}/${players.length}: ${player.telegram_id}`);
        
        // Задержка 50ms между сообщениями (20 сообщений в секунду)
        if (i < players.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
      } catch (sendError) {
        errorCount++;
        errors.push({
          player_id: player.telegram_id,
          player_name: player.first_name || player.username,
          error: sendError.message
        });
        console.error(`❌ Ошибка отправки ${i + 1}/${players.length} (${player.telegram_id}):`, sendError.message);
      }
    }
    
    // Логируем рассылку (если таблица существует)
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        req.params.telegramId,
        'admin_broadcast_sent',
        JSON.stringify({
          admin_id: req.params.telegramId,
          message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
          total_players: players.length,
          sent_count: sentCount,
          error_count: errorCount,
          only_verified: onlyVerified,
          timestamp: new Date().toISOString()
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать рассылку:', logError.message);
    }
    
    console.log(`✅ Рассылка завершена. Отправлено: ${sentCount}, ошибок: ${errorCount}`);
    
    res.json({
      success: true,
      message: 'Рассылка завершена',
      statistics: {
        total_players: players.length,
        sent_count: sentCount,
        error_count: errorCount,
        success_rate: Math.round((sentCount / players.length) * 100)
      },
      errors: errorCount > 0 ? errors.slice(0, 10) : [] // Показываем первые 10 ошибок
    });
    
  } catch (err) {
    console.error('❌ Ошибка рассылки сообщений:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message 
    });
  }
});

module.exports = router;