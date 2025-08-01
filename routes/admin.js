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
  const telegramId = req.params.telegramId;
  
  console.log('🔐 Проверка админских прав:', { 
    telegramId, 
    telegramIdType: typeof telegramId,
    adminId: ADMIN_TELEGRAM_ID, 
    adminIdType: typeof ADMIN_TELEGRAM_ID,
    telegramIdStr: String(telegramId),
    adminIdStr: String(ADMIN_TELEGRAM_ID),
    directMatch: telegramId === ADMIN_TELEGRAM_ID,
    stringMatch: String(telegramId) === String(ADMIN_TELEGRAM_ID),
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
    debug: {
      receivedId: telegramIdStr,
      expectedId: adminIdStr,
      typesMatch: typeof telegramId === typeof ADMIN_TELEGRAM_ID,
      stringMatch: telegramIdStr === adminIdStr
    }
  });
});

// 📊 GET /api/admin/stats/:telegramId - РАСШИРЕННАЯ статистика системы
router.get('/stats/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    console.log('📊 Запрос расширенной статистики системы от ID:', telegramId);
    
    // ПРОВЕРЯЕМ АДМИНА ПРЯМО ЗДЕСЬ
    const telegramIdStr = String(telegramId).trim();
    const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
    
    console.log('🔐 Прямая проверка админа в stats:', {
      telegramIdStr,
      adminIdStr,
      isAdmin: telegramIdStr === adminIdStr
    });
    
    if (telegramIdStr !== adminIdStr) {
      console.log('🚫 Статистика: доступ запрещен - не админ');
      return res.status(403).json({ error: 'Access denied' });
    }
    
    console.log('✅ Статистика: админ права подтверждены, загружаем расширенные данные...');
    
    // 👥 СТАТИСТИКА ИГРОКОВ
    const playersStats = await pool.query(`
      SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_players,
        COUNT(CASE WHEN last_activity > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
        COUNT(CASE WHEN last_activity > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_24h,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as new_7d
      FROM players
    `);
    
    // 💰 СТАТИСТИКА ВАЛЮТ
    const currencyStats = await pool.query(`
      SELECT 
        COALESCE(SUM(ccc), 0) as total_ccc,
        COALESCE(SUM(cs), 0) as total_cs,
        COALESCE(SUM(ton), 0) as total_ton,
        COALESCE(SUM(telegram_stars), 0) as total_stars,
        COALESCE(AVG(ccc), 0) as avg_ccc,
        COALESCE(AVG(cs), 0) as avg_cs,
        COALESCE(AVG(ton), 0) as avg_ton,
        COALESCE(AVG(telegram_stars), 0) as avg_stars
      FROM players
    `);
    
    // 🌟 СТАТИСТИКА ОБМЕНОВ STARS
    const starsExchangeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_exchanges,
        COALESCE(SUM(ABS(amount)), 0) as total_stars_exchanged,
        COALESCE(SUM(cs_amount), 0) as total_cs_received,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as exchanges_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN ABS(amount) END), 0) as stars_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN cs_amount END), 0) as cs_24h
      FROM star_transactions 
      WHERE transaction_type = 'stars_to_cs_exchange' AND status = 'completed'
    `);
    
    // 💳 СТАТИСТИКА ПОКУПОК STARS
    const starsPurchaseStats = await pool.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COALESCE(SUM(ABS(amount)), 0) as total_stars_bought,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as purchases_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN ABS(amount) END), 0) as stars_bought_24h,
        COALESCE(AVG(ABS(amount)), 0) as avg_purchase_amount
      FROM star_transactions 
      WHERE transaction_type = 'stars_purchase' AND status = 'completed'
    `);
    
    // 🔄 СТАТИСТИКА TON ОПЕРАЦИЙ (депозиты/выводы)
    const tonOperationsStats = await pool.query(`
      SELECT 
        COUNT(CASE WHEN transaction_type = 'ton_deposit' THEN 1 END) as total_deposits,
        COUNT(CASE WHEN transaction_type = 'ton_withdrawal' THEN 1 END) as total_withdrawals,
        COALESCE(SUM(CASE WHEN transaction_type = 'ton_deposit' THEN amount END), 0) as total_deposited,
        COALESCE(SUM(CASE WHEN transaction_type = 'ton_withdrawal' THEN ABS(amount) END), 0) as total_withdrawn,
        COUNT(CASE WHEN transaction_type = 'ton_deposit' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as deposits_24h,
        COUNT(CASE WHEN transaction_type = 'ton_withdrawal' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as withdrawals_24h,
        COALESCE(SUM(CASE WHEN transaction_type = 'ton_deposit' AND created_at > NOW() - INTERVAL '24 hours' THEN amount END), 0) as deposited_24h,
        COALESCE(SUM(CASE WHEN transaction_type = 'ton_withdrawal' AND created_at > NOW() - INTERVAL '24 hours' THEN ABS(amount) END), 0) as withdrawn_24h
      FROM transactions 
      WHERE status = 'completed'
    `);
    
    // 💱 СТАТИСТИКА ВСЕХ ОБМЕНОВ (CS<->CCC, TON<->CS и т.д.)
    const allExchangesStats = await pool.query(`
      SELECT 
        COUNT(CASE WHEN exchange_type = 'cs_to_ccc' THEN 1 END) as cs_to_ccc_total,
        COUNT(CASE WHEN exchange_type = 'ccc_to_cs' THEN 1 END) as ccc_to_cs_total,
        COUNT(CASE WHEN exchange_type = 'ton_to_cs' THEN 1 END) as ton_to_cs_total,
        COUNT(CASE WHEN exchange_type = 'cs_to_ton' THEN 1 END) as cs_to_ton_total,
        
        COUNT(CASE WHEN exchange_type = 'cs_to_ccc' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as cs_to_ccc_24h,
        COUNT(CASE WHEN exchange_type = 'ccc_to_cs' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as ccc_to_cs_24h,
        COUNT(CASE WHEN exchange_type = 'ton_to_cs' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as ton_to_cs_24h,
        COUNT(CASE WHEN exchange_type = 'cs_to_ton' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as cs_to_ton_24h,
        
        COALESCE(SUM(CASE WHEN exchange_type = 'cs_to_ccc' THEN from_amount END), 0) as total_cs_to_ccc_amount,
        COALESCE(SUM(CASE WHEN exchange_type = 'ccc_to_cs' THEN from_amount END), 0) as total_ccc_to_cs_amount,
        COALESCE(SUM(CASE WHEN exchange_type = 'ton_to_cs' THEN from_amount END), 0) as total_ton_to_cs_amount,
        COALESCE(SUM(CASE WHEN exchange_type = 'cs_to_ton' THEN from_amount END), 0) as total_cs_to_ton_amount
      FROM exchanges 
      WHERE status = 'completed'
    `);
    
    // 🏆 ТОП 15 игроков по CS
    const topPlayers = await pool.query(`
      SELECT 
        telegram_id, 
        username, 
        first_name, 
        COALESCE(cs, 0) as cs, 
        COALESCE(ccc, 0) as ccc, 
        COALESCE(ton, 0) as ton, 
        COALESCE(telegram_stars, 0) as telegram_stars, 
        COALESCE(verified, false) as verified,
        last_activity,
        created_at
      FROM players 
      ORDER BY cs DESC 
      LIMIT 15
    `);
    
    // 📈 СТАТИСТИКА КУРСОВ
    const ratesStats = await pool.query(`
      SELECT currency_pair, rate, previous_rate, last_updated, source, metadata
      FROM exchange_rates 
      WHERE currency_pair IN ('TON_USD', 'STARS_CS')
      ORDER BY currency_pair, last_updated DESC
    `);
    
    const currentRates = {};
    for (const row of ratesStats.rows) {
      if (!currentRates[row.currency_pair]) {
        currentRates[row.currency_pair] = row;
      }
    }
    
    // 🎮 СТАТИСТИКА ИГР
    const gamesStats = await pool.query(`
      SELECT 
        game_type,
        COUNT(*) as total_games,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as games_24h,
        COALESCE(SUM(bet_amount), 0) as total_bet_amount,
        COALESCE(SUM(win_amount), 0) as total_win_amount,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN bet_amount END), 0) as bet_amount_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN win_amount END), 0) as win_amount_24h
      FROM game_sessions 
      WHERE status = 'completed'
      GROUP BY game_type
      ORDER BY total_games DESC
    `);
    
    // 📦 СТАТИСТИКА МАГАЗИНА
    const shopStats = await pool.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as purchases_24h,
        COALESCE(SUM(cost_cs), 0) as total_cs_spent,
        COALESCE(SUM(cost_ccc), 0) as total_ccc_spent,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN cost_cs END), 0) as cs_spent_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN cost_ccc END), 0) as ccc_spent_24h
      FROM shop_purchases 
      WHERE status = 'completed'
    `);
    
    const result = {
      players: playersStats.rows[0],
      currencies: currencyStats.rows[0],
      stars_exchange: starsExchangeStats.rows[0],
      stars_purchases: starsPurchaseStats.rows[0],
      ton_operations: tonOperationsStats.rows[0],
      all_exchanges: allExchangesStats.rows[0],
      top_players: topPlayers.rows,
      current_rates: currentRates,
      games: gamesStats.rows,
      shop: shopStats.rows[0],
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Расширенная статистика успешно собрана:', {
      totalPlayers: result.players.total_players,
      totalCS: result.currencies.total_cs,
      totalExchanges: result.stars_exchange.total_exchanges,
      topPlayersCount: result.top_players.length,
      ratesCount: Object.keys(result.current_rates).length,
      gamesCount: result.games.length
    });
    
    res.json(result);
    
  } catch (err) {
    console.error('❌ Ошибка получения расширенной статистики:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 🔍 GET /api/admin/search/:telegramId - поиск игроков
router.get('/search/:telegramId', async (req, res) => {
  const { q } = req.query;
  
  // Проверяем админа
  const telegramIdStr = String(req.params.telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  
  if (telegramIdStr !== adminIdStr) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
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
        last_activity,
        created_at
      FROM players 
      WHERE 
        telegram_id::text ILIKE $1 
        OR username ILIKE $1 
        OR first_name ILIKE $1
      ORDER BY cs DESC
      LIMIT 30
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

// 👤 GET /api/admin/player/:telegramId/:playerId - подробная информация об игроке
router.get('/player/:telegramId/:playerId', async (req, res) => {
  const { playerId } = req.params;
  
  // Проверяем админа
  const telegramIdStr = String(req.params.telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  
  if (telegramIdStr !== adminIdStr) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    console.log(`👤 Запрос подробной информации об игроке: ${playerId}`);
    
    const player = await getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // История действий игрока (последние 100)
    const actionsResult = await pool.query(`
      SELECT action_type, amount, created_at, details
      FROM player_actions 
      WHERE telegram_id = $1 
      ORDER BY created_at DESC 
      LIMIT 100
    `, [playerId]);
    
    // История обменов Stars
    const starsHistory = await pool.query(`
      SELECT amount, cs_amount, exchange_rate, created_at, status, transaction_type
      FROM star_transactions 
      WHERE player_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [playerId]);
    
    // История TON операций
    const tonHistory = await pool.query(`
      SELECT amount, transaction_type, status, created_at, details
      FROM transactions 
      WHERE player_id = $1 AND transaction_type IN ('ton_deposit', 'ton_withdrawal')
      ORDER BY created_at DESC 
      LIMIT 50
    `, [playerId]);
    
    // История обменов валют
    const exchangeHistory = await pool.query(`
      SELECT exchange_type, from_amount, to_amount, rate, created_at, status
      FROM exchanges 
      WHERE player_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [playerId]);
    
    // Игровая статистика
    const gameStats = await pool.query(`
      SELECT 
        game_type,
        COUNT(*) as games_played,
        COALESCE(SUM(bet_amount), 0) as total_bet,
        COALESCE(SUM(win_amount), 0) as total_win,
        COUNT(CASE WHEN win_amount > bet_amount THEN 1 END) as wins,
        COUNT(CASE WHEN win_amount < bet_amount THEN 1 END) as losses
      FROM game_sessions 
      WHERE player_id = $1 AND status = 'completed'
      GROUP BY game_type
      ORDER BY games_played DESC
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
      ton_history: tonHistory.rows,
      exchange_history: exchangeHistory.rows,
      game_stats: gameStats.rows,
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
  
  // Проверяем админа
  const telegramIdStr = String(req.params.telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  
  if (telegramIdStr !== adminIdStr) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  if (!playerId || !currency || amount === undefined || !operation) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`💰 Админ обновляет баланс: ${playerId}, ${currency}, ${operation} ${amount}`);
    
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
    
    console.log(`✅ Баланс обновлен админом: ${playerId} ${currency} ${operation} ${amount}`);
    
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

module.exports = router;