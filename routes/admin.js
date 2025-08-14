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

// admin.js - ДОБАВИТЬ ПЕРЕД module.exports = router;
// Эти endpoints добавить в конец файла admin.js

// ========================
// 🏆 НОВЫЕ ENDPOINTS ДЛЯ УПРАВЛЕНИЯ ПРЕМИУМОМ
// ========================

// POST /api/admin/grant-premium-30days/:telegramId - Выдача 30-дневного премиума
router.post('/grant-premium-30days/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`🏆 Админ выдает 30-дневный премиум игроку: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // 🔥 Выдаем 30-дневный премиум + verified = true
    await client.query(
      `UPDATE players SET 
       premium_no_ads_until = GREATEST(
         COALESCE(premium_no_ads_until, NOW()),
         NOW() + INTERVAL '30 days'
       ),
       verified = TRUE
       WHERE telegram_id = $1`,
      [playerId]
    );
    
    // Создаем запись в подписках
    const subscriptionResult = await client.query(
      `INSERT INTO premium_subscriptions (
        telegram_id, 
        subscription_type, 
        payment_method, 
        payment_amount,
        end_date,
        transaction_id,
        granted_by_admin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        playerId,
        'no_ads_30_days',
        'admin_grant',
        0,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        `admin_${Date.now()}_${playerId}`,
        true
      ]
    );
    
    // Логируем транзакцию
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        playerId,
        'admin_grant',
        'no_ads_30_days',
        'admin_grant',
        0,
        'admin',
        'Premium 30 days granted by admin',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          granted_timestamp: new Date().toISOString(),
          verified_granted: true
        })
      ]
    );
    
    // Логируем действие админа
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_premium_30days_grant',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          verified_granted: true
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать админское действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ 30-дневный премиум выдан игроку ${playerId} + verified = true`);
    
    res.json({
      success: true,
      message: '30-дневный премиум и верификация выданы успешно',
      player: updatedPlayer,
      subscription_id: subscriptionResult.rows[0].id
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка выдачи 30-дневного премиума:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/grant-premium-forever/:telegramId - Выдача постоянного премиума
router.post('/grant-premium-forever/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`🏆 Админ выдает постоянный премиум игроку: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // 🔥 Выдаем постоянный премиум + verified = true
    await client.query(
      `UPDATE players SET 
       premium_no_ads_forever = TRUE,
       premium_no_ads_until = NULL,
       verified = TRUE
       WHERE telegram_id = $1`,
      [playerId]
    );
    
    // Создаем запись в подписках
    const subscriptionResult = await client.query(
      `INSERT INTO premium_subscriptions (
        telegram_id, 
        subscription_type, 
        payment_method, 
        payment_amount,
        end_date,
        transaction_id,
        granted_by_admin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        playerId,
        'no_ads_forever',
        'admin_grant',
        0,
        null, // Навсегда
        `admin_forever_${Date.now()}_${playerId}`,
        true
      ]
    );
    
    // Логируем транзакцию
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        playerId,
        'admin_grant',
        'no_ads_forever',
        'admin_grant',
        0,
        'admin',
        'Premium forever granted by admin',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          granted_timestamp: new Date().toISOString(),
          verified_granted: true
        })
      ]
    );
    
    // Логируем действие админа
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_premium_forever_grant',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          verified_granted: true
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать админское действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Постоянный премиум выдан игроку ${playerId} + verified = true`);
    
    res.json({
      success: true,
      message: 'Постоянный премиум и верификация выданы успешно',
      player: updatedPlayer,
      subscription_id: subscriptionResult.rows[0].id
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка выдачи постоянного премиума:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/revoke-premium/:telegramId - Отмена всех премиум статусов
router.post('/revoke-premium/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`🚫 Админ отменяет все премиум статусы игрока: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Сохраняем текущий статус для логирования
    const currentStatus = {
      verified: player.verified,
      premium_no_ads_forever: player.premium_no_ads_forever,
      premium_no_ads_until: player.premium_no_ads_until
    };
    
    // 🔥 Сбрасываем ВСЕ статусы: премиум + verified
    await client.query(
      `UPDATE players SET 
       premium_no_ads_forever = FALSE,
       premium_no_ads_until = NULL,
       verified = FALSE
       WHERE telegram_id = $1`,
      [playerId]
    );
    
    // Деактивируем все активные подписки
    await client.query(
      `UPDATE premium_subscriptions 
       SET status = 'admin_revoked' 
       WHERE telegram_id = $1 
         AND status = 'active'`,
      [playerId]
    );
    
    // Логируем транзакцию отмены
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        playerId,
        'admin_revoke',
        'all_premium',
        'admin_action',
        0,
        'admin',
        'All premium statuses revoked by admin',
        JSON.stringify({
          admin_id: req.params.telegramId,
          revoked_timestamp: new Date().toISOString(),
          previous_status: currentStatus,
          verified_revoked: true
        })
      ]
    );
    
    // Логируем действие админа
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_premium_revoke_all',
        JSON.stringify({
          admin_id: req.params.telegramId,
          previous_status: currentStatus,
          verified_revoked: true
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать админское действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Все премиум статусы отменены для игрока ${playerId} + verified = false`);
    
    res.json({
      success: true,
      message: 'Все премиум статусы и верификация отменены',
      player: updatedPlayer,
      previous_status: currentStatus
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка отмены премиум статусов:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/grant-basic-verification/:telegramId - Выдача ТОЛЬКО базовой верификации
router.post('/grant-basic-verification/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  try {
    console.log(`✅ Админ выдает базовую верификацию игроку: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Выдаем ТОЛЬКО verified = true (БЕЗ премиум функций)
    await pool.query(
      'UPDATE players SET verified = TRUE WHERE telegram_id = $1',
      [playerId]
    );
    
    // Логируем действие админа
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_basic_verification_grant',
        JSON.stringify({
          admin_id: req.params.telegramId,
          verification_type: 'basic_only',
          premium_granted: false
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать верификацию:', logError.message);
    }
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Базовая верификация выдана игроку ${playerId} (без премиум функций)`);
    
    res.json({
      success: true,
      message: 'Базовая верификация выдана успешно',
      player: updatedPlayer,
      verification_type: 'basic_only'
    });
    
  } catch (err) {
    console.error('❌ Ошибка выдачи базовой верификации:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/admin/premium-overview/:telegramId - Обзор премиум статистики
router.get('/premium-overview/:telegramId', async (req, res) => {
  try {
    console.log('📊 Админ запрашивает обзор премиум статистики');
    
    // Общая статистика премиум игроков
    const premiumStats = await pool.query(`
      SELECT 
        COUNT(CASE WHEN verified = true THEN 1 END) as total_verified,
        COUNT(CASE WHEN premium_no_ads_forever = true THEN 1 END) as premium_forever,
        COUNT(CASE WHEN premium_no_ads_until > NOW() THEN 1 END) as premium_30days_active,
        COUNT(CASE WHEN premium_no_ads_until IS NOT NULL AND premium_no_ads_until <= NOW() THEN 1 END) as premium_expired,
        COUNT(CASE WHEN verified = true AND premium_no_ads_forever = false AND (premium_no_ads_until IS NULL OR premium_no_ads_until <= NOW()) THEN 1 END) as basic_verified_only
      FROM players
    `);
    
    // Последние премиум транзакции
    const recentTransactions = await pool.query(`
      SELECT 
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        description,
        created_at
      FROM premium_transactions 
      ORDER BY created_at DESC 
      LIMIT 20
    `);
    
    // Топ игроков с премиумом
    const premiumPlayers = await pool.query(`
      SELECT 
        telegram_id,
        first_name,
        username,
        verified,
        premium_no_ads_forever,
        premium_no_ads_until,
        created_at
      FROM players 
      WHERE verified = true 
      ORDER BY 
        premium_no_ads_forever DESC,
        premium_no_ads_until DESC NULLS LAST,
        created_at DESC
      LIMIT 15
    `);
    
    res.json({
      success: true,
      stats: premiumStats.rows[0],
      recent_transactions: recentTransactions.rows,
      premium_players: premiumPlayers.rows,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения премиум обзора:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Добавляем в routes/admin.js - API для управления заданиями

// 📋 GET /api/admin/quests/list/:telegramId - список всех заданий
router.get('/quests/list/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Проверка админа
    if (telegramId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
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
    const completionStats = await pool.query(`
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
    
    console.log(`📋 Админ ${telegramId} запросил список заданий: ${questsWithStats.length} найдено`);
    
    res.json({
      success: true,
      quests: questsWithStats,
      total_quests: questsWithStats.length,
      active_quests: questsWithStats.filter(q => q.is_active).length,
      inactive_quests: questsWithStats.filter(q => !q.is_active).length
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения списка заданий:', error);
    res.status(500).json({ error: 'Failed to fetch quests', details: error.message });
  }
});

// ✏️ GET /api/admin/quests/get/:questKey/:telegramId - получить детали задания
router.get('/quests/get/:questKey/:telegramId', async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    
    // Проверка админа
    if (telegramId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
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
    
    console.log(`✏️ Админ ${telegramId} запросил детали задания: ${questKey}`);
    
    res.json({
      success: true,
      template: template,
      translations: translations,
      supported_languages: ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja']
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения деталей задания:', error);
    res.status(500).json({ error: 'Failed to fetch quest details', details: error.message });
  }
});

// ➕ POST /api/admin/quests/create/:telegramId - создать новое задание
router.post('/quests/create/:telegramId', async (req, res) => {
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
    
    // Проверка админа
    if (telegramId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Валидация данных
    if (!quest_key || !quest_type || !reward_cs || !translations) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!translations.en || !translations.en.quest_name || !translations.en.description) {
      return res.status(400).json({ error: 'English translation is required' });
    }
    
    // Проверяем что quest_key уникален
    const existingResult = await pool.query(
      'SELECT quest_key FROM quest_templates WHERE quest_key = $1',
      [quest_key]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Quest key already exists' });
    }
    
    await pool.query('BEGIN');
    
    try {
      // Создаем шаблон задания
      const templateResult = await pool.query(`
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
      
      for (const lang of supportedLanguages) {
        if (translations[lang] && translations[lang].quest_name && translations[lang].description) {
          await pool.query(`
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
        }
      }
      
      await pool.query('COMMIT');
      
      console.log(`➕ Админ ${telegramId} создал новое задание: ${quest_key} (${quest_type})`);
      
      res.json({
        success: true,
        message: 'Quest created successfully',
        quest: templateResult.rows[0]
      });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Ошибка создания задания:', error);
    res.status(500).json({ error: 'Failed to create quest', details: error.message });
  }
});

// ✏️ PUT /api/admin/quests/update/:questKey/:telegramId - обновить задание
router.put('/quests/update/:questKey/:telegramId', async (req, res) => {
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
    
    // Проверка админа
    if (telegramId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Проверяем что задание существует
    const existingResult = await pool.query(
      'SELECT * FROM quest_templates WHERE quest_key = $1',
      [questKey]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest template not found' });
    }
    
    await pool.query('BEGIN');
    
    try {
      // Обновляем шаблон задания
      const templateResult = await pool.query(`
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
      if (translations) {
        const supportedLanguages = ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja'];
        
        for (const lang of supportedLanguages) {
          if (translations[lang] && translations[lang].quest_name && translations[lang].description) {
            // Обновляем или создаем перевод
            await pool.query(`
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
          }
        }
      }
      
      await pool.query('COMMIT');
      
      console.log(`✏️ Админ ${telegramId} обновил задание: ${questKey}`);
      
      res.json({
        success: true,
        message: 'Quest updated successfully',
        quest: templateResult.rows[0]
      });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Ошибка обновления задания:', error);
    res.status(500).json({ error: 'Failed to update quest', details: error.message });
  }
});

// 🗑️ DELETE /api/admin/quests/delete/:questKey/:telegramId - удалить задание
router.delete('/quests/delete/:questKey/:telegramId', async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    
    // Проверка админа
    if (telegramId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Проверяем что задание существует
    const existingResult = await pool.query(
      'SELECT * FROM quest_templates WHERE quest_key = $1',
      [questKey]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quest template not found' });
    }
    
    // Проверяем сколько игроков выполнили это задание
    const completionsResult = await pool.query(`
      SELECT COUNT(*) as completion_count
      FROM player_quests pq
      JOIN quests q ON pq.quest_id = q.quest_id
      WHERE q.quest_name = $1 OR CAST(q.quest_id AS VARCHAR) = $1
    `, [questKey]);
    
    const completionCount = parseInt(completionsResult.rows[0]?.completion_count) || 0;
    
    await pool.query('BEGIN');
    
    try {
      // Удаляем переводы (каскадное удаление)
      const translationsResult = await pool.query(
        'DELETE FROM quest_translations WHERE quest_key = $1',
        [questKey]
      );
      
      // Удаляем шаблон
      const templateResult = await pool.query(
        'DELETE FROM quest_templates WHERE quest_key = $1 RETURNING *',
        [questKey]
      );
      
      await pool.query('COMMIT');
      
      console.log(`🗑️ Админ ${telegramId} удалил задание: ${questKey} (было ${completionCount} выполнений)`);
      
      res.json({
        success: true,
        message: 'Quest deleted successfully',
        deleted_quest: templateResult.rows[0],
        deleted_translations: translationsResult.rowCount,
        completion_count: completionCount
      });
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Ошибка удаления задания:', error);
    res.status(500).json({ error: 'Failed to delete quest', details: error.message });
  }
});

// 🔄 POST /api/admin/quests/toggle-status/:questKey/:telegramId - переключить активность
router.post('/quests/toggle-status/:questKey/:telegramId', async (req, res) => {
  try {
    const { questKey, telegramId } = req.params;
    
    // Проверка админа
    if (telegramId !== '1222791281') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
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
    
    console.log(`🔄 Админ ${telegramId} ${status} задание: ${questKey}`);
    
    res.json({
      success: true,
      message: `Quest ${status} successfully`,
      quest_key: quest.quest_key,
      is_active: quest.is_active
    });
    
  } catch (error) {
    console.error('❌ Ошибка переключения статуса:', error);
    res.status(500).json({ error: 'Failed to toggle quest status', details: error.message });
  }
});

// POST /api/admin/test-premium-cleanup/:telegramId - Тестовая очистка премиума
router.post('/test-premium-cleanup/:telegramId', async (req, res) => {
  try {
    console.log('🧪 Админ запускает тестовую очистку премиум подписок');
    
    // Импортируем функцию очистки из главного файла
    const axios = require('axios');
    const apiUrl = process.env.NODE_ENV === 'production'
      ? 'https://cosmoclick-backend.onrender.com'
      : 'http://localhost:5000';
    
    // Вызываем endpoint очистки
    const response = await axios.post(`${apiUrl}/api/admin/manual-cleanup-premium`, {
      admin_id: req.params.telegramId
    });
    
    res.json({
      success: true,
      message: 'Тестовая очистка завершена',
      cleanup_result: response.data
    });
    
  } catch (err) {
    console.error('❌ Ошибка тестовой очистки:', err);
    res.status(500).json({ 
      error: 'Test cleanup failed', 
      details: err.response?.data?.error || err.message 
    });
  }
});

// ========================
// 🔄 ИСПРАВЛЕНИЕ СУЩЕСТВУЮЩЕГО ENDPOINT verify-player
// ========================

// ЗАМЕНИТЬ существующий verify-player endpoint на этот:
router.post('/verify-player/:telegramId', async (req, res) => {
  const { playerId, verified } = req.body;
  
  if (!playerId || verified === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    console.log(`🔧 Изменение верификации: ${playerId} -> ${verified}`);
    
    // 🔥 ВАЖНО: Этот endpoint теперь работает ТОЛЬКО с базовой верификацией
    // НЕ трогает премиум поля, только verified статус
    await pool.query(
      'UPDATE players SET verified = $1 WHERE telegram_id = $2',
      [verified, playerId]
    );
    
    // Логируем действие
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_basic_verification_change',
        JSON.stringify({
          admin_id: req.params.telegramId,
          verified_status: verified,
          verification_type: 'basic_only',
          premium_affected: false
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать верификацию:', logError.message);
    }
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Базовая верификация изменена: ${playerId} -> verified = ${verified}`);
    
    res.json({
      success: true,
      player: updatedPlayer,
      verification_type: 'basic_only'
    });
    
  } catch (err) {
    console.error('❌ Ошибка верификации игрока:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

module.exports = router;