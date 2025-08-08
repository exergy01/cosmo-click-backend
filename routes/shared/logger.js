// logger.js - Очищенная версия
const pool = require('../../db');

// Основная функция логирования
const logPlayerAction = async (
  telegramId, 
  actionType, 
  amount = 0, 
  systemId = null, 
  itemId = null, 
  details = null,
  req = null
) => {
  try {
    const ip = req ? (req.ip || req.connection.remoteAddress || 'unknown') : null;
    const userAgent = req ? req.get('User-Agent') : null;
    
    const result = await pool.query(
      `INSERT INTO player_actions 
       (telegram_id, action_type, amount, system_id, item_id, details, ip_address, user_agent, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) 
       RETURNING id`,
      [telegramId, actionType, amount, systemId, itemId, details, ip, userAgent]
    );
    
    console.log(`LOG: ${telegramId} - ${actionType} - ${amount} - система ${systemId}`);
    return result.rows[0].id;
  } catch (err) {
    console.error('Ошибка логирования:', err.message);
    return null;
  }
};

// Логирование баланса
const logBalanceChange = async (telegramId, actionId, beforeBalance, afterBalance) => {
  try {
    if (!actionId) return;
    
    await pool.query(
      `INSERT INTO balance_history 
       (telegram_id, ccc_before, cs_before, ton_before, ccc_after, cs_after, ton_after, action_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        telegramId, 
        beforeBalance.ccc, beforeBalance.cs, beforeBalance.ton,
        afterBalance.ccc, afterBalance.cs, afterBalance.ton,
        actionId
      ]
    );
  } catch (err) {
    console.error('Ошибка логирования баланса:', err.message);
  }
};

// Детекция подозрительной активности
const detectSuspiciousActivity = async (telegramId, actionType, amount, systemId) => {
  try {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    const recentActions = await pool.query(
      `SELECT COUNT(*) as count FROM player_actions 
       WHERE telegram_id = $1 AND created_at >= $2`,
      [telegramId, oneMinuteAgo]
    );
    
    const actionsPerMinute = parseInt(recentActions.rows[0].count);
    
    if (actionsPerMinute > 50) {
      console.log(`МНОГО ДЕЙСТВИЙ: ${telegramId} - ${actionsPerMinute} действий в минуту`);
      
      try {
        await pool.query(
          `INSERT INTO suspicious_activity 
           (telegram_id, activity_type, description, severity, auto_detected) 
           VALUES ($1, $2, $3, $4, true)`,
          [telegramId, 'rapid_activity', `${actionsPerMinute} действий в минуту`, 3]
        );
      } catch (susErr) {
        console.error('Ошибка записи подозрительной активности:', susErr.message);
      }
      
      return true;
    }
    
    return false;
  } catch (err) {
    console.error('Ошибка детекции подозрительной активности:', err.message);
    return false;
  }
};

// Обновление lifetime статистики
const updateLifetimeStats = async (telegramId, actionType, amount) => {
  try {
    if (actionType === 'collect_ccc') {
      await pool.query(
        `UPDATE players SET ccc_lifetime = COALESCE(ccc_lifetime, 0) + $1 WHERE telegram_id = $2`,
        [amount, telegramId]
      );
    } else if (actionType === 'collect_cs') {
      await pool.query(
        `UPDATE players SET cs_lifetime = COALESCE(cs_lifetime, 0) + $1 WHERE telegram_id = $2`,
        [amount, telegramId]
      );
    } else if (actionType === 'collect_ton') {
      await pool.query(
        `UPDATE players SET ton_lifetime = COALESCE(ton_lifetime, 0) + $1 WHERE telegram_id = $2`,
        [amount, telegramId]
      );
    } else if (actionType.startsWith('buy_')) {
      await pool.query(
        `UPDATE players SET total_purchases = COALESCE(total_purchases, 0) + 1 WHERE telegram_id = $1`,
        [telegramId]
      );
    }
  } catch (err) {
    console.error('Ошибка обновления lifetime статистики:', err.message);
  }
};

// Получение статистики
const getPlayerStatistics = async (telegramId) => {
  try {
    // Статистика за последние 7 дней
    const weeklyStats = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_actions,
        SUM(CASE WHEN action_type = 'collect_ccc' THEN amount ELSE 0 END) as ccc_collected,
        SUM(CASE WHEN action_type = 'collect_cs' THEN amount ELSE 0 END) as cs_collected,
        SUM(CASE WHEN action_type = 'collect_ton' THEN amount ELSE 0 END) as ton_collected,
        COUNT(CASE WHEN action_type LIKE 'buy_%' THEN 1 END) as purchases
      FROM player_actions 
      WHERE telegram_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [telegramId]);
    
    // Общая статистика
    const totalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_actions,
        COUNT(CASE WHEN action_type LIKE 'collect_%' THEN 1 END) as total_collections,
        COUNT(CASE WHEN action_type LIKE 'buy_%' THEN 1 END) as total_purchases,
        MIN(created_at) as first_action,
        MAX(created_at) as last_action
      FROM player_actions 
      WHERE telegram_id = $1
    `, [telegramId]);
    
    return {
      weekly: weeklyStats.rows,
      total: totalStats.rows[0]
    };
  } catch (err) {
    console.error('Ошибка получения статистики:', err.message);
    return { weekly: [], total: {} };
  }
};

module.exports = {
  logPlayerAction,
  logBalanceChange,
  detectSuspiciousActivity,
  updateLifetimeStats,
  getPlayerStatistics
};