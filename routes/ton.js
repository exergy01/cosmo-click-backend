// ===== routes/ton.js ===== ИСПРАВЛЕНИЕ ЧАСОВЫХ ПОЯСОВ
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');

// FORCE DEPLOY: 2025-06-30-14:55
console.log('🔥🔥🔥 TON.JS VERSION 14:55 DEPLOYED 🔥🔥🔥');

const router = express.Router();

// 🔥 ТЕСТОВЫЙ РЕЖИМ: true = 2/4 минуты, false = 20/40 дней
const TEST_MODE = true;

// 🕐 ФУНКЦИЯ ПОЛУЧЕНИЯ UTC ВРЕМЕНИ (исправляет проблему часовых поясов)
const getUTCTimestamp = () => {
  return Date.now(); // Всегда UTC миллисекунды
};

// 🕐 ФУНКЦИЯ ЛОГИРОВАНИЯ ВРЕМЕНИ
const logTime = (label, timestamp) => {
  console.log(`⏰ ${label}: ${timestamp} (${new Date(timestamp).toISOString()})`);
};

// 🧮 РАСЧЕТ ПЛАНОВ СТЕЙКИНГА
router.get('/calculate/:amount', (req, res) => {
  console.log('🧮 ЗАПРОС РАСЧЕТА ПЛАНОВ:', req.params.amount);
  
  const amount = parseFloat(req.params.amount);
  
  if (isNaN(amount) || amount < 15 || amount > 1000) {
    console.log('❌ Неверная сумма:', amount);
    return res.status(400).json({ 
      success: false,
      error: 'Amount must be between 15 and 1000 TON' 
    });
  }
  
  const fastPlan = {
    type: 'fast',
    days: TEST_MODE ? 2 : 20,
    percent: 3,
    stake_amount: amount,
    return_amount: (amount * 1.03).toFixed(8),
    profit: (amount * 0.03).toFixed(8),
    time_unit: TEST_MODE ? 'минут' : 'дней'
  };
  
  const standardPlan = {
    type: 'standard',
    days: TEST_MODE ? 4 : 40,
    percent: 7,
    stake_amount: amount,
    return_amount: (amount * 1.07).toFixed(8),
    profit: (amount * 0.07).toFixed(8),
    time_unit: TEST_MODE ? 'минут' : 'дней'
  };
  
  console.log('✅ ПЛАНЫ РАССЧИТАНЫ:', { fastPlan, standardPlan });
  
  res.json({
    success: true,
    amount: amount,
    plans: [fastPlan, standardPlan],
    test_mode: TEST_MODE
  });
});

// 🔥 СОЗДАНИЕ СТЕЙКА - ИСПРАВЛЕНИЕ ЧАСОВЫХ ПОЯСОВ
router.post('/stake', async (req, res) => {
  const { telegramId, systemId, stakeAmount, planType } = req.body;
  
  console.log('🔥 СОЗДАНИЕ СТЕЙКА - ЗАПРОС:', { telegramId, systemId, stakeAmount, planType });
  
  if (!telegramId || !systemId || !stakeAmount || !planType) {
    console.log('❌ Отсутствуют обязательные поля');
    return res.status(400).json({ 
      success: false,
      error: 'Missing required fields' 
    });
  }
  
  if (!['fast', 'standard'].includes(planType)) {
    console.log('❌ Неверный тип плана:', planType);
    return res.status(400).json({ 
      success: false,
      error: 'Invalid plan type' 
    });
  }
  
  if (parseInt(systemId) !== 5) {
    console.log('❌ Неподдерживаемая система:', systemId);
    return res.status(400).json({ 
      success: false,
      error: 'Only system 5 is supported' 
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`🔥 СОЗДАНИЕ СТЕЙКА: игрок ${telegramId}, система ${systemId}, сумма ${stakeAmount}, план ${planType}`);
    
    // Получаем данные игрока
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      console.log('❌ Игрок не найден');
      return res.status(404).json({ 
        success: false,
        error: 'Player not found' 
      });
    }
    
    // Проверяем баланс TON
    const tonBalance = parseFloat(player.ton || 0);
    const stakeAmountNum = parseFloat(stakeAmount);
    
    if (tonBalance < stakeAmountNum) {
      await client.query('ROLLBACK');
      console.log('❌ Недостаточно TON:', { tonBalance, stakeAmountNum });
      return res.status(400).json({ 
        success: false,
        error: 'Insufficient TON balance' 
      });
    }
    
    // Параметры плана
    const planPercent = planType === 'fast' ? 3 : 7;
    
    // 🕐 ИСПРАВЛЕНИЕ: Все расчеты времени в UTC
    let actualDurationForDB, timeUnit, millisecondsToAdd;
    
    if (TEST_MODE) {
      actualDurationForDB = planType === 'fast' ? 2 : 4; // минуты
      timeUnit = 'минут';
      millisecondsToAdd = actualDurationForDB * 60 * 1000; // в миллисекунды
      console.log(`🧪 ТЕСТОВЫЙ РЕЖИМ: ${actualDurationForDB} минут = ${millisecondsToAdd} мс`);
    } else {
      actualDurationForDB = planType === 'fast' ? 20 : 40; // дни
      timeUnit = 'дней';
      millisecondsToAdd = actualDurationForDB * 24 * 60 * 60 * 1000; // в миллисекунды
      console.log(`🏭 ПРОДАКШН РЕЖИМ: ${actualDurationForDB} дней = ${millisecondsToAdd} мс`);
    }
    
    const returnAmount = (stakeAmountNum * (1 + planPercent / 100)).toFixed(8);
    
    // 🕐 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: UTC время на всех серверах
    const startTimeMs = getUTCTimestamp();
    const endTimeMs = startTimeMs + millisecondsToAdd;
    
    console.log(`🕐 UTC РАСЧЕТ ВРЕМЕНИ:`);
    logTime('Текущее UTC время', startTimeMs);
    logTime('Добавляем миллисекунд', millisecondsToAdd);
    logTime('Время окончания UTC', endTimeMs);
    console.log(`⏱️ Продолжительность: ${endTimeMs - startTimeMs} мс`);
    
    // Списываем TON с баланса
    const newTonBalance = (tonBalance - stakeAmountNum).toFixed(8);
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newTonBalance, telegramId]
    );
    
    // Разблокируем систему 5 навсегда
    if (!player.unlocked_systems.includes(systemId)) {
      const updatedUnlockedSystems = [...player.unlocked_systems, systemId];
      console.log(`🔓 РАЗБЛОКИРУЕМ СИСТЕМУ 5 НАВСЕГДА`);
      
      await client.query(
        'UPDATE players SET unlocked_systems = $1 WHERE telegram_id = $2',
        [JSON.stringify(updatedUnlockedSystems), telegramId]
      );
    } else {
      console.log(`🔓 СИСТЕМА 5 УЖЕ РАЗБЛОКИРОВАНА НАВСЕГДА`);
    }
    
    // 🕐 ИСПРАВЛЕННАЯ вставка - ПРОСТАЯ СХЕМА БЕЗ ЛИШНИХ ПАРАМЕТРОВ
    console.log('🔥 ПОПЫТКА СОЗДАНИЯ СТЕЙКА В БД...');
    console.log('🔥 Данные для вставки:', {
      telegramId, systemId, stakeAmountNum, planType, planPercent, 
      actualDurationForDB, returnAmount, startTimeMs, endTimeMs
    });
    
    let stakeResult;
    try {
      // 🔥 ИСПРАВЛЕНО: Правильное количество параметров (9 штук)
      stakeResult = await client.query(
        `INSERT INTO ton_staking (
          telegram_id, system_id, stake_amount, plan_type, plan_percent, plan_days, 
          return_amount, start_date, end_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          TO_TIMESTAMP($8 / 1000.0) AT TIME ZONE 'UTC',
          TO_TIMESTAMP($9 / 1000.0) AT TIME ZONE 'UTC'
        ) RETURNING *`,
        [telegramId, systemId, stakeAmountNum, planType, planPercent, actualDurationForDB, 
         returnAmount, Math.floor(startTimeMs/1000), Math.floor(endTimeMs/1000)]
      );
      console.log('✅ СТЕЙК СОЗДАН С UTC ВРЕМЕНЕМ (упрощенная схема)');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Критическая ошибка создания стейка:', err);
      return res.status(500).json({ 
        success: false,
        error: 'Database error: ' + err.message 
      });
    }
    
    console.log(`✅ СТЕЙК СОЗДАН В БД:`);
    console.log(`   ID: ${stakeResult.rows[0].id}`);
    logTime('   start_date', new Date(stakeResult.rows[0].start_date).getTime());
    logTime('   end_date', new Date(stakeResult.rows[0].end_date).getTime());
    const dbStartTime = new Date(stakeResult.rows[0].start_date).getTime();
    const dbEndTime = new Date(stakeResult.rows[0].end_date).getTime();
    console.log(`   Проверка разности БД: ${dbEndTime - dbStartTime} мс`);
    console.log(`   Планируемая разность: ${endTimeMs - startTimeMs} мс`);
    
    await client.query('COMMIT');
    
    // Возвращаем обновленные данные
    const updatedPlayer = await getPlayer(telegramId);
    const createdStake = stakeResult.rows[0];
    
    res.json({
      success: true,
      message: 'Stake created successfully',
      stake: {
        id: createdStake.id,
        system_id: systemId,
        stake_amount: stakeAmount,
        plan_type: planType,
        plan_days: actualDurationForDB,
        plan_percent: planPercent,
        return_amount: returnAmount,
        end_date: new Date(endTimeMs).toISOString(),
        days_left: actualDurationForDB,
        time_unit: timeUnit
      },
      player: updatedPlayer
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка создания стейка:', err);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

// 📋 ПОЛУЧЕНИЕ СПИСКА СТЕЙКОВ - ИСПРАВЛЕНИЕ ЧАСОВЫХ ПОЯСОВ
router.get('/stakes/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    console.log(`📋 ПОЛУЧЕНИЕ СТЕЙКОВ ДЛЯ ИГРОКА: ${telegramId}`);
    
    // 🕐 ИСПРАВЛЕННОЕ чтение без лишних полей
    let result;
    try {
      // Читаем только существующие поля
      result = await pool.query(
        `SELECT 
          id, system_id, stake_amount, plan_type, plan_percent, plan_days,
          return_amount, start_date, end_date, status, created_at
        FROM ton_staking 
        WHERE telegram_id = $1 AND status = 'active'
        ORDER BY created_at DESC`,
        [telegramId]
      );
      console.log('✅ Стейки прочитаны из БД');
    } catch (err) {
      console.log('❌ Ошибка чтения стейков:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    console.log(`📋 НАЙДЕНО АКТИВНЫХ СТЕЙКОВ: ${result.rows.length}`);
    
    // 🕐 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Используем UTC время
    const currentTimeMs = getUTCTimestamp();
    logTime('Текущее UTC время сервера', currentTimeMs);
    
    const stakes = result.rows.map(stake => {
      // 🕐 УПРОЩЕННЫЙ расчет времени - только через start_date/end_date
      const endTimeMs = new Date(stake.end_date).getTime();
      const timeLeftMs = endTimeMs - currentTimeMs;
      
      console.log(`📊 СТЕЙК ${stake.id}:`);
      logTime('   Конец из БД', endTimeMs);
      logTime('   Текущее UTC', currentTimeMs);
      console.log(`   Осталось мс: ${timeLeftMs}`);
      
      let daysLeft, timeUnitForDisplay;
      
      if (TEST_MODE) {
        daysLeft = Math.max(0, Math.ceil(timeLeftMs / (1000 * 60)));
        timeUnitForDisplay = 'минут';
        console.log(`   🧪 Тест режим: ${daysLeft} минут до окончания`);
      } else {
        daysLeft = Math.max(0, Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24)));
        timeUnitForDisplay = 'дней';
        console.log(`   🏭 Прод режим: ${daysLeft} дней до окончания`);
      }
      
      const isReady = timeLeftMs <= 0;
      console.log(`   ✅ Готов к сбору: ${isReady}`);
      
      return {
        ...stake,
        days_left: daysLeft,
        is_ready: isReady,
        end_date: stake.end_date,
        start_date: stake.start_date,
        test_mode: TEST_MODE,
        time_unit: timeUnitForDisplay
      };
    });
    
    console.log(`📋 ОТПРАВЛЯЕМ КЛИЕНТУ: ${stakes.length} стейков`);
    res.json(stakes);
    
  } catch (err) {
    console.error('❌ Ошибка получения стейков:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 💸 ВЫВОД ЗАВЕРШЕННОГО СТЕЙКА - ИСПРАВЛЕНИЕ ЧАСОВЫХ ПОЯСОВ
router.post('/withdraw', async (req, res) => {
  const { telegramId, stakeId } = req.body;
  
  console.log(`💸 ЗАПРОС ВЫВОДА: игрок ${telegramId}, стейк ${stakeId}`);
  
  if (!telegramId || !stakeId) {
    return res.status(400).json({ 
      success: false,
      error: 'Missing required fields' 
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 🕐 УПРОЩЕННОЕ чтение стейка
    const stakeResult = await client.query(
      `SELECT * FROM ton_staking 
       WHERE id = $1 AND telegram_id = $2 AND status = $3`,
      [stakeId, telegramId, 'active']
    );
    
    if (stakeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Стейк не найден или уже выведен');
      return res.status(404).json({ 
        success: false,
        error: 'Stake not found or already withdrawn' 
      });
    }
    
    const stake = stakeResult.rows[0];
    
    // 🕐 УПРОЩЕННАЯ проверка времени через start_date/end_date
    const currentTimeMs = getUTCTimestamp();
    const endTimeMs = new Date(stake.end_date).getTime();
    const timeLeftMs = endTimeMs - currentTimeMs;
    
    console.log(`💸 UTC ПРОВЕРКА ВРЕМЕНИ СТЕЙКА ${stakeId}:`);
    logTime('   Текущее UTC время', currentTimeMs);
    logTime('   Время окончания из БД', endTimeMs);
    console.log(`   Разница мс: ${timeLeftMs}`);
    
    // Проверяем что срок истек
    if (timeLeftMs > 0) {
      await client.query('ROLLBACK');
      
      let timeLeftText;
      if (TEST_MODE) {
        const minutesLeft = Math.ceil(timeLeftMs / (1000 * 60));
        timeLeftText = `${minutesLeft} минут`;
      } else {
        const daysLeft = Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24));
        timeLeftText = `${daysLeft} дней`;
      }
      
      console.log(`❌ Стейк еще не готов: осталось ${timeLeftText}`);
      return res.status(400).json({ 
        success: false,
        error: 'Stake period not completed',
        time_left: timeLeftText
      });
    }
    
    // Получаем данные игрока
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Player not found' 
      });
    }
    
    // Добавляем TON к балансу
    const currentTon = parseFloat(player.ton || 0);
    const returnAmount = parseFloat(stake.return_amount);
    const newTonBalance = (currentTon + returnAmount).toFixed(8);
    
    console.log(`💰 ВЫВОД СТЕЙКА:`);
    console.log(`   Было TON: ${currentTon}`);
    console.log(`   Возврат: ${returnAmount}`);
    console.log(`   Станет TON: ${newTonBalance}`);
    
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newTonBalance, telegramId]
    );
    
    // Обновляем статус стейка
    await client.query(
      'UPDATE ton_staking SET status = $1, withdrawn_at = NOW() WHERE id = $2',
      ['withdrawn', stakeId]
    );
    
    console.log(`✅ СТЕЙК ${stakeId} УСПЕШНО ВЫВЕДЕН`);
    
    await client.query('COMMIT');
    
    // Возвращаем обновленные данные
    const updatedPlayer = await getPlayer(telegramId);
    
    res.json({
      success: true,
      message: 'Stake withdrawn successfully',
      withdrawn_amount: returnAmount,
      new_ton_balance: newTonBalance,
      player: updatedPlayer
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка вывода стейка:', err);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

// 💸 ОТМЕНА СТЕЙКА СО ШТРАФОМ 10%
router.post('/cancel', async (req, res) => {
  const { telegramId, stakeId } = req.body;
  
  console.log('🔍 ЗАПРОС ОТМЕНЫ СТЕЙКА:', { telegramId, stakeId });
  
  if (!telegramId || !stakeId) {
    return res.status(400).json({ 
      success: false,
      error: 'Missing required fields' 
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Получаем данные стейка
    const stakeResult = await client.query(
      'SELECT * FROM ton_staking WHERE id = $1 AND telegram_id = $2 AND status = $3',
      [stakeId, telegramId, 'active']
    );
    
    if (stakeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Stake not found or already processed' 
      });
    }
    
    const stake = stakeResult.rows[0];
    
    // Получаем данные игрока
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Player not found' 
      });
    }
    
    // Рассчитываем возврат с штрафом 10%
    const stakeAmount = parseFloat(stake.stake_amount);
    const penalty = stakeAmount * 0.1;
    const returnAmount = stakeAmount - penalty;
    
    console.log(`💰 РАСЧЕТ ОТМЕНЫ: вложено ${stakeAmount}, штраф ${penalty}, возврат ${returnAmount}`);
    
    // Добавляем TON к балансу (с учетом штрафа)
    const currentTon = parseFloat(player.ton || 0);
    const newTonBalance = (currentTon + returnAmount).toFixed(8);
    
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newTonBalance, telegramId]
    );
    
    // Обновляем стейк
    await client.query(
      `UPDATE ton_staking SET 
        status = $1, 
        withdrawn_at = NOW(),
        return_amount = $2,
        penalty_amount = $3
      WHERE id = $4`,
      ['withdrawn', returnAmount, penalty, stakeId]
    );
    
    console.log(`✅ СТЕЙК ${stakeId} ОТМЕНЕН С ШТРАФОМ`);
    
    await client.query('COMMIT');
    
    // Возвращаем обновленные данные
    const updatedPlayer = await getPlayer(telegramId);
    
    res.json({
      success: true,
      message: 'Stake cancelled with penalty',
      returned_amount: returnAmount,
      penalty_amount: penalty,
      new_ton_balance: newTonBalance,
      player: updatedPlayer
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка отмены стейка:', err);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

// 📚 ПОЛУЧЕНИЕ ИСТОРИИ СТЕЙКОВ ИГРОКА
router.get('/stakes/history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    console.log(`📚 ПОЛУЧЕНИЕ ИСТОРИИ СТЕЙКОВ ДЛЯ ИГРОКА: ${telegramId}`);
    
    // Получаем завершенные стейки
    let result;
    try {
      result = await pool.query(
        `SELECT 
          id, system_id, stake_amount, plan_type, plan_percent, plan_days,
          return_amount, start_date, end_date, status, created_at, withdrawn_at,
          penalty_amount, start_time_ms, end_time_ms
        FROM ton_staking 
        WHERE telegram_id = $1 AND status = 'withdrawn'
        ORDER BY withdrawn_at DESC`,
        [telegramId]
      );
    } catch (err) {
      // Фалбэк на старую схему
      result = await pool.query(
        `SELECT 
          id, system_id, stake_amount, plan_type, plan_percent, plan_days,
          return_amount, start_date, end_date, status, created_at, withdrawn_at,
          penalty_amount
        FROM ton_staking 
        WHERE telegram_id = $1 AND status = 'withdrawn'
        ORDER BY withdrawn_at DESC`,
        [telegramId]
      );
    }
    
    console.log(`📚 НАЙДЕНО ЗАВЕРШЕННЫХ СТЕЙКОВ: ${result.rows.length}`);
    
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Ошибка получения истории стейков:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔥 НОВЫЙ ENDPOINT: Диагностика времени сервера
router.get('/time/debug', (req, res) => {
  const now = getUTCTimestamp();
  
  res.json({
    server_utc_timestamp: now,
    server_utc_iso: new Date(now).toISOString(),
    test_mode: TEST_MODE,
    test_duration: {
      fast: TEST_MODE ? 2 : 20,
      standard: TEST_MODE ? 4 : 40,
      unit: TEST_MODE ? 'минут' : 'дней'
    },
    timezone_info: {
      nodejs_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      process_env_tz: process.env.TZ || 'не установлено'
    }
  });
});

// В конце файла перед module.exports
router.get('/debug/all-stakes/:telegramId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, start_date, end_date, plan_days, plan_type, created_at FROM ton_staking WHERE telegram_id = $1 ORDER BY created_at DESC',
      [req.params.telegramId]
    );
    
    const now = Date.now();
    
    const stakes = result.rows.map(stake => {
      const startTime = new Date(stake.start_date).getTime();
      const endTime = new Date(stake.end_date).getTime();
      const duration = endTime - startTime;
      const timeLeft = endTime - now;
      
      return {
        id: stake.id,
        created_at: stake.created_at,
        plan_days: stake.plan_days,
        plan_type: stake.plan_type,
        start_iso: stake.start_date,
        end_iso: stake.end_date,
        duration_ms: duration,
        duration_minutes: Math.round(duration / (1000 * 60)),
        time_left_ms: timeLeft,
        time_left_minutes: Math.round(timeLeft / (1000 * 60)),
        is_ready: timeLeft <= 0
      };
    });
    
    res.json({
      current_time: new Date(now).toISOString(),
      stakes: stakes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;