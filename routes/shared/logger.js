// ===== routes/shared/logger.js =====
const pool = require('../../db');

// 🎯 ТИПЫ ДЕЙСТВИЙ
const ACTION_TYPES = {
  // ИГРОК
  PLAYER_START: 'player_start',
  PLAYER_SETTINGS: 'player_settings',
  
  // ПОКУПКИ
  PURCHASE_ASTEROID: 'purchase_asteroid',
  PURCHASE_DRONE: 'purchase_drone', 
  PURCHASE_CARGO: 'purchase_cargo',
  PURCHASE_SYSTEM: 'purchase_system',
  
  // СБОР
  COLLECT_MANUAL: 'collect_manual',
  COLLECT_AUTO: 'collect_auto',
  
  // ОБМЕНЫ
  EXCHANGE_CCC_CS: 'exchange_ccc_cs',
  EXCHANGE_CS_TON: 'exchange_cs_ton',
  
  // TON ОПЕРАЦИИ
  TON_DEPOSIT: 'ton_deposit',
  TON_WITHDRAW: 'ton_withdraw',
  TON_VERIFICATION: 'ton_verification',
  
  // СОЦИАЛЬНОЕ
  REFERRAL_JOIN: 'referral_join',
  REFERRAL_BONUS: 'referral_bonus',
  
  // ИГРЫ
  GAME_RESULT: 'game_result',
  TASK_COMPLETE: 'task_complete',
  
  // БЕЗОПАСНОСТЬ
  SUSPICIOUS_ACTIVITY: 'suspicious_activity'
};

// 🔧 ЛОГИРОВАНИЕ ДЕЙСТВИЯ
const logPlayerAction = async (telegramId, actionType, details = {}) => {
  try {
    const client = await pool.connect();
    
    // Запись в player_actions
    await client.query(
      `INSERT INTO player_actions (telegram_id, action_type, action_details, timestamp) 
       VALUES ($1, $2, $3, NOW())`,
      [telegramId, actionType, JSON.stringify(details)]
    );
    
    client.release();
    console.log(`📝 ЛОГИРОВАНИЕ: ${actionType} для игрока ${telegramId}`);
  } catch (err) {
    console.error('❌ Ошибка логирования действия:', err);
  }
};

// 💰 ЛОГИРОВАНИЕ ИЗМЕНЕНИЯ БАЛАНСА (АДАПТИРОВАНО под существующую структуру)
const logBalanceChange = async (telegramId, currency, oldBalance, newBalance, reason, details = {}) => {
  try {
    const client = await pool.connect();
    
    const change = parseFloat(newBalance) - parseFloat(oldBalance);
    
    // Используем существующую структуру таблицы
    if (currency === 'ccc') {
      await client.query(
        `INSERT INTO balance_history (telegram_id, ccc_before, ccc_after, currency, old_balance, new_balance, change_amount, reason, details) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [telegramId, oldBalance, newBalance, currency, oldBalance, newBalance, change, reason, JSON.stringify(details)]
      );
    } else if (currency === 'cs') {
      await client.query(
        `INSERT INTO balance_history (telegram_id, cs_before, cs_after, currency, old_balance, new_balance, change_amount, reason, details) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [telegramId, oldBalance, newBalance, currency, oldBalance, newBalance, change, reason, JSON.stringify(details)]
      );
    } else if (currency === 'ton') {
      await client.query(
        `INSERT INTO balance_history (telegram_id, ton_before, ton_after, currency, old_balance, new_balance, change_amount, reason, details) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [telegramId, oldBalance, newBalance, currency, oldBalance, newBalance, change, reason, JSON.stringify(details)]
      );
    }
    
    client.release();
    console.log(`💰 БАЛАНС: ${currency} ${oldBalance} → ${newBalance} (${change > 0 ? '+' : ''}${change})`);
  } catch (err) {
    console.error('❌ Ошибка логирования баланса:', err);
  }
};

// 🚨 ЛОГИРОВАНИЕ ПОДОЗРИТЕЛЬНОЙ АКТИВНОСТИ (АДАПТИРОВАНО под integer severity)
const logSuspiciousActivity = async (telegramId, activityType, severity, details = {}) => {
  try {
    const client = await pool.connect();
    
    // Конвертируем severity в число
    const severityNum = severity === 'low' ? 1 : 
                       severity === 'medium' ? 2 : 
                       severity === 'high' ? 3 : 
                       severity === 'critical' ? 4 : 2;
    
    await client.query(
      `INSERT INTO suspicious_activity (telegram_id, activity_type, severity, details, description) 
       VALUES ($1, $2, $3, $4, $5)`,
      [telegramId, activityType, severityNum, JSON.stringify(details), `${activityType} - ${severity}`]
    );
    
    client.release();
    console.log(`🚨 ПОДОЗРИТЕЛЬНО: ${activityType} (${severity}) для игрока ${telegramId}`);
  } catch (err) {
    console.error('❌ Ошибка логирования подозрительной активности:', err);
  }
};

// 🎯 СПЕЦИФИЧНЫЕ ФУНКЦИИ ЛОГИРОВАНИЯ

// ПОКУПКИ
const logPurchase = async (telegramId, itemType, itemId, systemId, price, currency) => {
  const actionType = itemType === 'asteroid' ? ACTION_TYPES.PURCHASE_ASTEROID :
                    itemType === 'drone' ? ACTION_TYPES.PURCHASE_DRONE :
                    itemType === 'cargo' ? ACTION_TYPES.PURCHASE_CARGO :
                    ACTION_TYPES.PURCHASE_SYSTEM;
  
  await logPlayerAction(telegramId, actionType, {
    item_type: itemType,
    item_id: itemId,
    system_id: systemId,
    price: price,
    currency: currency
  });
};

// СБОР
const logCollection = async (telegramId, systemId, amount, currency, isAuto = false) => {
  const actionType = isAuto ? ACTION_TYPES.COLLECT_AUTO : ACTION_TYPES.COLLECT_MANUAL;
  
  await logPlayerAction(telegramId, actionType, {
    system_id: systemId,
    amount: amount,
    currency: currency
  });
};

// ОБМЕНЫ
const logExchange = async (telegramId, fromCurrency, toCurrency, fromAmount, toAmount, rate) => {
  const actionType = fromCurrency === 'ccc' && toCurrency === 'cs' ? ACTION_TYPES.EXCHANGE_CCC_CS :
                    ACTION_TYPES.EXCHANGE_CS_TON;
  
  await logPlayerAction(telegramId, actionType, {
    from_currency: fromCurrency,
    to_currency: toCurrency,
    from_amount: fromAmount,
    to_amount: toAmount,
    exchange_rate: rate
  });
};

// TON ОПЕРАЦИИ
const logTonOperation = async (telegramId, operationType, amount, details = {}) => {
  let actionType;
  switch (operationType) {
    case 'deposit': actionType = ACTION_TYPES.TON_DEPOSIT; break;
    case 'withdraw': actionType = ACTION_TYPES.TON_WITHDRAW; break;
    case 'verification': actionType = ACTION_TYPES.TON_VERIFICATION; break;
    default: actionType = 'ton_unknown';
  }
  
  await logPlayerAction(telegramId, actionType, {
    operation: operationType,
    amount: amount,
    ...details
  });
};

// ВЕРИФИКАЦИЯ ЗА TON
const logVerification = async (telegramId, tonAmount) => {
  await logTonOperation(telegramId, 'verification', tonAmount, {
    feature: 'remove_ads_manual_collect'
  });
};

// РЕФЕРАЛЫ
const logReferral = async (telegramId, referralType, referredId = null, bonusAmount = null) => {
  const actionType = referralType === 'join' ? ACTION_TYPES.REFERRAL_JOIN : ACTION_TYPES.REFERRAL_BONUS;
  
  await logPlayerAction(telegramId, actionType, {
    referral_type: referralType,
    referred_id: referredId,
    bonus_amount: bonusAmount
  });
};

// ИГРЫ
const logGameResult = async (telegramId, gameType, result, betAmount, winAmount = 0) => {
  await logPlayerAction(telegramId, ACTION_TYPES.GAME_RESULT, {
    game_type: gameType,
    result: result,
    bet_amount: betAmount,
    win_amount: winAmount,
    profit: winAmount - betAmount
  });
};

// 🔍 ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
const checkSuspiciousActivity = async (telegramId, actionType, amount = null) => {
  try {
    const client = await pool.connect();
    
    // Настраиваемые пороги для разных действий
    let threshold = 10; // по умолчанию
    let timeWindow = '1 minute';
    
    // Разные пороги для разных действий
    if (actionType.includes('game') || actionType.includes('click')) {
      threshold = 1000; // Клик-игры могут быть очень активными
    } else if (actionType.includes('collect')) {
      threshold = 20; // Сбор может быть частым
    } else if (actionType.includes('purchase')) {
      threshold = 10; // Покупки реже
    } else if (actionType.includes('ton')) {
      threshold = 5; // TON операции - особое внимание
      timeWindow = '5 minutes'; // За 5 минут
    }
    
    // Проверка частых действий
    const recentActions = await client.query(
      `SELECT COUNT(*) as count FROM player_actions 
       WHERE telegram_id = $1 AND action_type = $2 AND timestamp > NOW() - INTERVAL '${timeWindow}'`,
      [telegramId, actionType]
    );
    
    if (parseInt(recentActions.rows[0].count) > threshold) {
      await logSuspiciousActivity(telegramId, 'frequent_actions', 'medium', {
        action_type: actionType,
        count: recentActions.rows[0].count,
        threshold: threshold,
        time_window: timeWindow
      });
    }
    
    // Проверка больших сумм TON (защита от отмывания/мошенничества)
    if (amount && actionType.includes('ton') && parseFloat(amount) > 100) {
      await logSuspiciousActivity(telegramId, 'large_ton_transaction', 'high', {
        action_type: actionType,
        amount: amount,
        note: 'Требует ручной проверки - возможно отмывание или украденный кошелек'
      });
    }
    
    // Проверка аномально больших покупок
    if (amount && actionType.includes('purchase') && parseFloat(amount) > 1000) {
      await logSuspiciousActivity(telegramId, 'large_purchase', 'medium', {
        action_type: actionType,
        amount: amount
      });
    }
    
    client.release();
  } catch (err) {
    console.error('❌ Ошибка проверки подозрительной активности:', err);
  }
};

module.exports = {
  // Основные функции
  logPlayerAction,
  logBalanceChange,
  logSuspiciousActivity,
  
  // Специфичные функции
  logPurchase,
  logCollection,
  logExchange,
  logTonOperation,
  logVerification,
  logReferral,
  logGameResult,
  
  // Проверки
  checkSuspiciousActivity,
  
  // Константы
  ACTION_TYPES
};