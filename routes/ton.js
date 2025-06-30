// ===== routes/ton.js ===== ИСПРАВЛЕННОЕ ВРЕМЯ + ЗАЩИТА КНОПОК
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');

const router = express.Router();

// 🔥 ТЕСТОВЫЙ РЕЖИМ: true = 2/4 минуты, false = 20/40 дней
const TEST_MODE = true;

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

// 🔥 СОЗДАНИЕ СТЕЙКА - ИСПРАВЛЕННОЕ ВРЕМЯ
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
    
    // 🔥 ИСПРАВЛЕННОЕ ВРЕМЯ: Правильные расчеты для тестового режима
    let planDaysForDB, timeUnit, millisecondsToAdd;
    
    if (TEST_MODE) {
      planDaysForDB = planType === 'fast' ? 2 : 4; // минуты для БД
      timeUnit = 'минут';
      millisecondsToAdd = planDaysForDB * 60 * 1000; // точно в миллисекундах
      console.log(`🧪 ТЕСТОВЫЙ РЕЖИМ: ${planDaysForDB} минут = ${millisecondsToAdd} мс`);
    } else {
      planDaysForDB = planType === 'fast' ? 20 : 40; // дни для БД
      timeUnit = 'дней';
      millisecondsToAdd = planDaysForDB * 24 * 60 * 60 * 1000; // дни в миллисекундах
      console.log(`🏭 ПРОДАКШН РЕЖИМ: ${planDaysForDB} дней = ${millisecondsToAdd} мс`);
    }
    
    const returnAmount = (stakeAmountNum * (1 + planPercent / 100)).toFixed(8);
    
    // 🔥 КРИТИЧЕСКИ ВАЖНО: Точное время в миллисекундах
    const startTimeMs = Date.now();
    const endTimeMs = startTimeMs + millisecondsToAdd;
    
    console.log(`📅 ТОЧНЫЙ РАСЧЕТ ВРЕМЕНИ:`);
    console.log(`   Текущее время: ${startTimeMs} мс (${new Date(startTimeMs).toISOString()})`);
    console.log(`   Добавляем: ${millisecondsToAdd} мс (${planDaysForDB} ${timeUnit})`);
    console.log(`   Время окончания: ${endTimeMs} мс (${new Date(endTimeMs).toISOString()})`);
    console.log(`   Проверка разности: ${endTimeMs - startTimeMs} мс`);
    
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
    
    // 🔥 СОЗДАНИЕ СТЕЙКА С ТОЧНЫМ ВРЕМЕНЕМ
    console.log('🔥 СОЗДАНИЕ СТЕЙКА В БД...');
    
    let stakeResult;
    try {
      // Пробуем с новыми полями start_time_ms, end_time_ms
      stakeResult = await client.query(
        `INSERT INTO ton_staking (
          telegram_id, system_id, stake_amount, plan_type, plan_percent, plan_days, 
          return_amount, start_date, end_date, start_time_ms, end_time_ms, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '${planDaysForDB} ${TEST_MODE ? 'minute' : 'day'}', $8, $9, 'active') RETURNING *`,
        [telegramId, systemId, stakeAmountNum, planType, planPercent, planDaysForDB, returnAmount, startTimeMs, endTimeMs]
      );
      console.log('✅ СТЕЙК СОЗДАН С ПОЛЯМИ ВРЕМЕНИ В МС');
    } catch (err) {
      console.log('⚠️ Ошибка с новыми полями, пробуем старую схему:', err.message);
      // Фалбэк на старую схему
      stakeResult = await client.query(
        `INSERT INTO ton_staking (
          telegram_id, system_id, stake_amount, plan_type, plan_percent, plan_days, 
          return_amount, start_date, end_date, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          NOW(),
          NOW() + INTERVAL '${planDaysForDB} ${TEST_MODE ? 'minute' : 'day'}',
          'active'
        ) RETURNING *`,
        [telegramId, systemId, stakeAmountNum, planType, planPercent, planDaysForDB, returnAmount]
      );
      console.log('✅ СТЕЙК СОЗДАН БЕЗ ПОЛЕЙ ВРЕМЕНИ В МС');
    }
    
    const createdStake = stakeResult.rows[0];
    console.log(`✅ СТЕЙК СОЗДАН В БД: ID ${createdStake.id}`);
    
    await client.query('COMMIT');
    
    // Возвращаем обновленные данные
    const updatedPlayer = await getPlayer(telegramId);
    
    res.json({
      success: true,
      message: 'Stake created successfully',
      stake: {
        id: createdStake.id,
        system_id: systemId,
        stake_amount: stakeAmount,
        plan_type: planType,
        plan_days: planDaysForDB,
        plan_percent: planPercent,
        return_amount: returnAmount,
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
        end_date: new Date(endTimeMs).toISOString(),
        days_left: planDaysForDB,
        time_unit: timeUnit,
        test_mode: TEST_MODE
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

// 📋 ПОЛУЧЕНИЕ СПИСКА СТЕЙКОВ - ИСПРАВЛЕННОЕ ВРЕМЯ
router.get('/stakes/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    console.log(`📋 ПОЛУЧЕНИЕ СТЕЙКОВ ДЛЯ ИГРОКА: ${telegramId}`);
    
    // Получаем активные стейки
    const result = await pool.query(
      `SELECT 
        id, system_id, stake_amount, plan_type, plan_percent, plan_days,
        return_amount, start_date, end_date, status, created_at,
        start_time_ms, end_time_ms
      FROM ton_staking 
      WHERE telegram_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
      [telegramId]
    );
    
    console.log(`📋 НАЙДЕНО АКТИВНЫХ СТЕЙКОВ: ${result.rows.length}`);
    
    const currentTimeMs = Date.now();
    console.log(`⏰ Текущее время сервера: ${currentTimeMs} (${new Date(currentTimeMs).toISOString()})`);
    
    const stakes = result.rows.map(stake => {
      // 🔥 ИСПРАВЛЕННЫЙ расчет времени
      let endTimeMs;
      let startTimeMs;
      
      if (stake.start_time_ms && stake.end_time_ms) {
        // Новая схема - используем числовые поля
        startTimeMs = parseInt(stake.start_time_ms);
        endTimeMs = parseInt(stake.end_time_ms);
        console.log(`📊 СТЕЙК ${stake.id} (новая схема):`);
      } else {
        // Старая схема - вычисляем из дат + план
        startTimeMs = new Date(stake.start_date).getTime();
        const durationMs = TEST_MODE ? 
          (stake.plan_days * 60 * 1000) : // минуты в мс
          (stake.plan_days * 24 * 60 * 60 * 1000); // дни в мс
        endTimeMs = startTimeMs + durationMs;
        console.log(`📊 СТЕЙК ${stake.id} (старая схема):`);
      }
      
      const timeLeftMs = endTimeMs - currentTimeMs;
      
      console.log(`   Старт: ${startTimeMs} (${new Date(startTimeMs).toISOString()})`);
      console.log(`   Конец: ${endTimeMs} (${new Date(endTimeMs).toISOString()})`);
      console.log(`   Осталось: ${timeLeftMs} мс`);
      
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
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
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

// 💸 ВЫВОД ЗАВЕРШЕННОГО СТЕЙКА - ИСПРАВЛЕННАЯ ПРОВЕРКА ВРЕМЕНИ
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
    
    // Получаем стейк
    const stakeResult = await client.query(
      `SELECT *, start_time_ms, end_time_ms
       FROM ton_staking 
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
    const currentTimeMs = Date.now();
    
    // 🔥 ИСПРАВЛЕННАЯ проверка времени
    let endTimeMs;
    if (stake.end_time_ms) {
      endTimeMs = parseInt(stake.end_time_ms);
    } else {
      // Вычисляем из start_date + план
      const startTimeMs = new Date(stake.start_date).getTime();
      const durationMs = TEST_MODE ? 
        (stake.plan_days * 60 * 1000) : 
        (stake.plan_days * 24 * 60 * 60 * 1000);
      endTimeMs = startTimeMs + durationMs;
    }
    
    const timeLeftMs = endTimeMs - currentTimeMs;
    
    console.log(`💸 ПРОВЕРКА ВРЕМЕНИ СТЕЙКА ${stakeId}:`);
    console.log(`   Текущее время: ${currentTimeMs} (${new Date(currentTimeMs).toISOString()})`);
    console.log(`   Время окончания: ${endTimeMs} (${new Date(endTimeMs).toISOString()})`);
    console.log(`   Разница: ${timeLeftMs} мс`);
    
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

// 💸 ОТМЕНА СТЕЙКА СО ШТРАФОМ 10% - ТОЛЬКО ДО ИСТЕЧЕНИЯ ВРЕМЕНИ
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
      'SELECT *, start_time_ms, end_time_ms FROM ton_staking WHERE id = $1 AND telegram_id = $2 AND status = $3',
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
    const currentTimeMs = Date.now();
    
    // 🔥 ПРОВЕРКА: можно ли отменить стейк (только до истечения времени)
    let endTimeMs;
    if (stake.end_time_ms) {
      endTimeMs = parseInt(stake.end_time_ms);
    } else {
      const startTimeMs = new Date(stake.start_date).getTime();
      const durationMs = TEST_MODE ? 
        (stake.plan_days * 60 * 1000) : 
        (stake.plan_days * 24 * 60 * 60 * 1000);
      endTimeMs = startTimeMs + durationMs;
    }
    
    const timeLeftMs = endTimeMs - currentTimeMs;
    
    console.log(`🔍 ПРОВЕРКА ВОЗМОЖНОСТИ ОТМЕНЫ СТЕЙКА ${stakeId}:`);
    console.log(`   Текущее время: ${currentTimeMs} (${new Date(currentTimeMs).toISOString()})`);
    console.log(`   Время окончания: ${endTimeMs} (${new Date(endTimeMs).toISOString()})`);
    console.log(`   Разница: ${timeLeftMs} мс`);
    
    // 🔥 ЗАЩИТА: НЕЛЬЗЯ ОТМЕНИТЬ ЗАВЕРШЕННЫЙ СТЕЙК
    if (timeLeftMs <= 0) {
      await client.query('ROLLBACK');
      console.log(`❌ СТЕЙК ЗАВЕРШЕН - ОТМЕНА НЕВОЗМОЖНА`);
      return res.status(400).json({ 
        success: false,
        error: 'Cannot cancel completed stake. Please withdraw instead.',
        message: 'Стейк завершен. Используйте кнопку "Забрать"'
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
    const result = await pool.query(
      `SELECT 
        id, system_id, stake_amount, plan_type, plan_percent, plan_days,
        return_amount, start_date, end_date, status, created_at, withdrawn_at,
        penalty_amount, start_time_ms, end_time_ms
      FROM ton_staking 
      WHERE telegram_id = $1 AND status = 'withdrawn'
      ORDER BY withdrawn_at DESC`,
      [telegramId]
    );
    
    console.log(`📚 НАЙДЕНО ЗАВЕРШЕННЫХ СТЕЙКОВ: ${result.rows.length}`);
    
    // Добавляем тестовый режим к каждому стейку
    const stakesWithTestMode = result.rows.map(stake => ({
      ...stake,
      test_mode: TEST_MODE
    }));
    
    res.json(stakesWithTestMode);
    
  } catch (err) {
    console.error('❌ Ошибка получения истории стейков:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;