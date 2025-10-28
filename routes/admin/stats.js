// routes/admin/stats.js - Модуль статистики системы
const express = require('express');
const pool = require('../../db');
const { isAdmin } = require('./auth');

const router = express.Router();

// 📊 GET /stats/:telegramId - ПОЛНАЯ СТАТИСТИКА СИСТЕМЫ
router.get('/stats/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    if (process.env.NODE_ENV === 'development') console.log('📊 Запрос общей статистики системы от ID:', telegramId);
    
    // ПРОВЕРЯЕМ АДМИНА
    if (!isAdmin(telegramId)) {
      if (process.env.NODE_ENV === 'development') console.log('🚫 Статистика: доступ запрещен - не админ');
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Статистика: админ права подтверждены, загружаем данные...');
    
    // 1. Статистика игроков
    if (process.env.NODE_ENV === 'development') console.log('🔍 Загружаем статистику игроков...');
    const playersStats = await pool.query(`
      SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_players,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_24h,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as new_7d,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 day' THEN 1 END) as active_24h,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d
      FROM players
    `);
        
    // 2. Статистика валют
    if (process.env.NODE_ENV === 'development') console.log('💰 Загружаем статистику валют...');
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
    
    // 3. Статистика Stars обменов
    if (process.env.NODE_ENV === 'development') console.log('⭐ Загружаем статистику Stars обменов...');
    const starsExchangeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_exchanges,
        COALESCE(SUM(ABS(amount)), 0) as total_stars_exchanged,
        COALESCE(SUM(cs_amount), 0) as total_cs_received,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as exchanges_24h
      FROM star_transactions 
      WHERE transaction_type = 'stars_to_cs_exchange' AND status = 'completed'
    `);

    // 4. Статистика CCC ↔ CS обменов
    if (process.env.NODE_ENV === 'development') console.log('💱 Загружаем статистику CCC/CS обменов...');
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
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Таблица balance_history недоступна:', balanceHistoryError.message);
    }

    // 5. Статистика CS ↔ TON обменов
    if (process.env.NODE_ENV === 'development') console.log('💎 Загружаем статистику CS/TON обменов...');
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
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Таблица balance_history недоступна для TON обменов');
    }

    // 6. Статистика мини-игр
    if (process.env.NODE_ENV === 'development') console.log('🎮 Загружаем статистику мини-игр...');
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
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Таблица minigames_history не существует:', minigamesError.message);
    }

    // 7. ТОП 10 игроков по CS
    if (process.env.NODE_ENV === 'development') console.log('🏆 Загружаем топ игроков...');
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
    if (process.env.NODE_ENV === 'development') console.log('📈 Загружаем курсы валют...');
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
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Таблица exchange_rates недоступна:', ratesError.message);
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
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Статистика успешно собрана:', {
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

module.exports = router;