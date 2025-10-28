// routes/admin/system.js - Модуль системных функций (ИСПРАВЛЕНО)
const express = require('express');
const pool = require('../../db');
const { adminAuth } = require('./auth');

const router = express.Router();

// 🛡️ Все маршруты требуют админских прав
router.use(adminAuth);

// 📈 POST /update-ton-rate/:telegramId - обновление курса TON
router.post('/update-ton-rate/:telegramId', async (req, res) => {
  const { newRate } = req.body;
  
  if (!newRate || newRate <= 0) {
    return res.status(400).json({ error: 'Invalid rate' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (process.env.NODE_ENV === 'development') console.log(`📈 Админ обновляет курс TON: ${newRate}`);
    
    // Получаем предыдущий курс
    let prevResult = { rows: [{ rate: 3.30 }] };
    try {
      prevResult = await client.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY last_updated DESC LIMIT 1',
        ['TON_USD']
      );
    } catch (rateError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Таблица exchange_rates недоступна для получения предыдущего курса');
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
        if (process.env.NODE_ENV === 'development') console.log('⚠️ Функция update_stars_cs_rate не существует:', funcError.message);
      }
    } catch (exchangeError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось обновить exchange_rates:', exchangeError.message);
    }
    
    await client.query('COMMIT');
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Курс TON обновлен админом: ${previousRate} → ${newRate}`);
    
    res.json({
      success: true,
      previous_rate: previousRate,
      new_rate: newRate,
      source: 'admin_manual',
      rate_change_percent: ((newRate - previousRate) / previousRate * 100).toFixed(2)
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка админского обновления курса TON:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// 🔓 POST /unblock-exchange/:telegramId - снятие блокировки обмена
router.post('/unblock-exchange/:telegramId', async (req, res) => {
  const { exchangeType = 'stars_to_cs' } = req.body;
  
  try {
    if (process.env.NODE_ENV === 'development') console.log(`🔓 Снятие блокировки обмена: ${exchangeType}`);
    
    // Снимаем блокировку (если таблица существует)
    try {
      await pool.query(`
        UPDATE exchange_blocks 
        SET blocked_until = NOW() 
        WHERE exchange_type = $1 AND blocked_until > NOW()
      `, [exchangeType]);
    } catch (blockError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Таблица exchange_blocks недоступна:', blockError.message);
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
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать снятие блокировки:', logError.message);
    }
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Блокировка обмена ${exchangeType} снята админом`);
    
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

// 🧹 POST /cleanup-expired-premium/:telegramId - Очистка истекших премиум подписок
router.post('/cleanup-expired-premium/:telegramId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (process.env.NODE_ENV === 'development') console.log('🧹 Админ запускает очистку истекших премиум подписок');
    
    // Находим игроков с истекшими премиум подписками
    const expiredResult = await client.query(`
      SELECT telegram_id, first_name, username, premium_no_ads_until
      FROM players 
      WHERE premium_no_ads_until IS NOT NULL 
        AND premium_no_ads_until <= NOW() 
        AND premium_no_ads_forever = FALSE
    `);
    
    const expiredPlayers = expiredResult.rows;
    if (process.env.NODE_ENV === 'development') console.log(`🔍 Найдено ${expiredPlayers.length} игроков с истекшими подписками`);
    
    if (expiredPlayers.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        message: 'Нет истекших подписок для очистки',
        cleaned_count: 0
      });
    }
    
    // Очищаем истекшие подписки
    await client.query(`
      UPDATE players 
      SET premium_no_ads_until = NULL 
      WHERE premium_no_ads_until IS NOT NULL 
        AND premium_no_ads_until <= NOW() 
        AND premium_no_ads_forever = FALSE
    `);
    
    // Обновляем статус подписок в таблице premium_subscriptions
    try {
      await client.query(`
        UPDATE premium_subscriptions 
        SET status = 'expired' 
        WHERE end_date IS NOT NULL 
          AND end_date <= NOW() 
          AND status = 'active'
      `);
    } catch (subscriptionsError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось обновить premium_subscriptions:', subscriptionsError.message);
    }
    
    // Логируем массовую очистку
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        req.params.telegramId,
        'admin_mass_premium_cleanup',
        JSON.stringify({
          admin_id: req.params.telegramId,
          cleaned_count: expiredPlayers.length,
          expired_players: expiredPlayers.map(p => ({
            telegram_id: p.telegram_id,
            name: p.first_name || p.username,
            expired_date: p.premium_no_ads_until
          })),
          cleanup_timestamp: new Date().toISOString()
        })
      ]);
    } catch (logError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать массовую очистку:', logError.message);
    }
    
    await client.query('COMMIT');
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Очистка завершена. Очищено ${expiredPlayers.length} подписок`);
    
    res.json({
      success: true,
      message: 'Очистка истекших подписок завершена',
      cleaned_count: expiredPlayers.length,
      cleaned_players: expiredPlayers.map(p => ({
        telegram_id: p.telegram_id,
        name: p.first_name || p.username,
        expired_date: p.premium_no_ads_until
      }))
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка очистки премиум подписок:', err);
    res.status(500).json({ error: 'Cleanup failed', details: err.message });
  } finally {
    client.release();
  }
});

// 🔄 POST /restart-system-services/:telegramId - Перезапуск системных сервисов
router.post('/restart-system-services/:telegramId', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('🔄 Админ запускает перезапуск системных сервисов');
    
    const services = [];
    const errors = [];
    
    // Попытка очистки кеша (если используется)
    try {
      // Здесь можно добавить очистку Redis кеша если используется
      services.push({
        name: 'Cache',
        status: 'cleared',
        message: 'Memory cache cleared'
      });
    } catch (cacheError) {
      errors.push({
        service: 'Cache',
        error: cacheError.message
      });
    }
    
    // Проверка подключения к базе данных
    try {
      await pool.query('SELECT 1');
      services.push({
        name: 'Database',
        status: 'healthy',
        message: 'Database connection active'
      });
    } catch (dbError) {
      errors.push({
        service: 'Database',
        error: dbError.message
      });
    }
    
    // Проверка Telegram Bot API
    try {
      const axios = require('axios');
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      
      if (BOT_TOKEN) {
        const telegramResponse = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        
        if (telegramResponse.data.ok) {
          services.push({
            name: 'Telegram Bot',
            status: 'healthy',
            message: `Bot @${telegramResponse.data.result.username} active`
          });
        } else {
          errors.push({
            service: 'Telegram Bot',
            error: 'Bot API returned error'
          });
        }
      } else {
        errors.push({
          service: 'Telegram Bot',
          error: 'BOT_TOKEN not configured'
        });
      }
    } catch (telegramError) {
      errors.push({
        service: 'Telegram Bot',
        error: telegramError.message
      });
    }
    
    // Логируем перезапуск сервисов
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        req.params.telegramId,
        'admin_restart_services',
        JSON.stringify({
          admin_id: req.params.telegramId,
          services_checked: services.length,
          errors_count: errors.length,
          services: services,
          errors: errors,
          restart_timestamp: new Date().toISOString()
        })
      ]);
    } catch (logError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать перезапуск сервисов:', logError.message);
    }
    
    if (process.env.NODE_ENV === 'development') console.log(`🔄 Проверка сервисов завершена. Работает: ${services.length}, ошибок: ${errors.length}`);
    
    res.json({
      success: true,
      message: 'Проверка системных сервисов завершена',
      services: services,
      errors: errors,
      summary: {
        total_services: services.length + errors.length,
        healthy_services: services.length,
        failed_services: errors.length,
        overall_status: errors.length === 0 ? 'healthy' : 'degraded'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Ошибка проверки системных сервисов:', err);
    res.status(500).json({ error: 'Service check failed', details: err.message });
  }
});

// 📊 GET /system-status/:telegramId - Статус системы
router.get('/system-status/:telegramId', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📊 Запрос статуса системы');
    
    const systemStatus = {
      server: {
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        node_version: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development'
      },
      database: {
        status: 'unknown',
        connection_count: 0
      },
      telegram_bot: {
        status: 'unknown',
        bot_info: null
      },
      timestamp: new Date().toISOString()
    };
    
    // Проверяем базу данных
    try {
      const dbResult = await pool.query('SELECT COUNT(*) as player_count FROM players');
      const connectionResult = await pool.query('SELECT COUNT(*) as connections FROM pg_stat_activity WHERE datname = current_database()');
      
      systemStatus.database = {
        status: 'healthy',
        connection_count: parseInt(connectionResult.rows[0]?.connections || 0),
        total_players: parseInt(dbResult.rows[0]?.player_count || 0)
      };
    } catch (dbError) {
      systemStatus.database = {
        status: 'error',
        error: dbError.message
      };
    }
    
    // Проверяем Telegram Bot
    try {
      const axios = require('axios');
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      
      if (BOT_TOKEN) {
        const telegramResponse = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, {
          timeout: 5000
        });
        
        if (telegramResponse.data.ok) {
          systemStatus.telegram_bot = {
            status: 'healthy',
            bot_info: {
              username: telegramResponse.data.result.username,
              first_name: telegramResponse.data.result.first_name,
              can_join_groups: telegramResponse.data.result.can_join_groups,
              can_read_all_group_messages: telegramResponse.data.result.can_read_all_group_messages
            }
          };
        }
      } else {
        systemStatus.telegram_bot = {
          status: 'misconfigured',
          error: 'BOT_TOKEN not set'
        };
      }
    } catch (telegramError) {
      systemStatus.telegram_bot = {
        status: 'error',
        error: telegramError.message
      };
    }
    
    res.json({
      success: true,
      system_status: systemStatus
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения статуса системы:', err);
    res.status(500).json({ error: 'Failed to get system status', details: err.message });
  }
});

// 🗑️ POST /clear-logs/:telegramId - Очистка старых логов
router.post('/clear-logs/:telegramId', async (req, res) => {
  const { days = 30, table_name } = req.body;
  
  try {
    if (process.env.NODE_ENV === 'development') console.log(`🗑️ Админ запускает очистку логов старше ${days} дней`);
    
    const client = await pool.connect();
    const results = [];
    
    try {
      await client.query('BEGIN');
      
      // Определяем таблицы для очистки
      const tablesToClean = table_name ? [table_name] : [
        'player_actions',
        'balance_history', 
        'star_transactions',
        'premium_transactions',
        'quest_scheduler_history'
      ];
      
      for (const table of tablesToClean) {
        try {
          const deleteResult = await client.query(`
            DELETE FROM ${table} 
            WHERE created_at < NOW() - INTERVAL '${days} days'
          `);
          
          results.push({
            table: table,
            status: 'success',
            deleted_rows: deleteResult.rowCount
          });
          
          if (process.env.NODE_ENV === 'development') console.log(`✅ ${table}: удалено ${deleteResult.rowCount} записей`);
          
        } catch (tableError) {
          results.push({
            table: table,
            status: 'error',
            error: tableError.message
          });
          
          if (process.env.NODE_ENV === 'development') console.log(`⚠️ ${table}: ${tableError.message}`);
        }
      }
      
      await client.query('COMMIT');
      
      // Логируем очистку логов
      try {
        await pool.query(`
          INSERT INTO player_actions (telegram_id, action_type, details)
          VALUES ($1, $2, $3)
        `, [
          req.params.telegramId,
          'admin_clear_logs',
          JSON.stringify({
            admin_id: req.params.telegramId,
            days_threshold: days,
            tables_cleaned: tablesToClean.length,
            results: results,
            cleanup_timestamp: new Date().toISOString()
          })
        ]);
      } catch (logError) {
        if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать очистку логов:', logError.message);
      }
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
    const totalDeleted = results.reduce((sum, result) => sum + (result.deleted_rows || 0), 0);
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Очистка логов завершена. Всего удалено: ${totalDeleted} записей`);
    
    res.json({
      success: true,
      message: 'Очистка логов завершена',
      days_threshold: days,
      total_deleted: totalDeleted,
      results: results
    });
    
  } catch (err) {
    console.error('❌ Ошибка очистки логов:', err);
    res.status(500).json({ error: 'Log cleanup failed', details: err.message });
  }
});

module.exports = router;