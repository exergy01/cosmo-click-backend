// ===== routes/ton.js ===== ИСПРАВЛЕНЫ ЧАСОВЫЕ ПОЯСА PostgreSQL
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

// 🔥 СОЗДАНИЕ СТЕЙКА (выбор тарифа после покупки системы)
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
  
  // 🔥 ТОЛЬКО СИСТЕМА 5 ПОДДЕРЖИВАЕТСЯ
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
    
    // 🔥 ИСПРАВЛЕНО: Четкая логика времени
    let actualDurationForDB, timeUnit, millisecondsToAdd;
    
    if (TEST_MODE) {
      // В тестовом режиме: 2 или 4 МИНУТЫ
      actualDurationForDB = planType === 'fast' ? 2 : 4; // Записываем в БД как минуты
      timeUnit = 'минут';
      millisecondsToAdd = actualDurationForDB * 60 * 1000; // Конвертируем в миллисекунды
      console.log(`🧪 ТЕСТОВЫЙ РЕЖИМ: ${actualDurationForDB} минут = ${millisecondsToAdd} миллисекунд`);
    } else {
      // В продакшн режиме: 20 или 40 ДНЕЙ
      actualDurationForDB = planType === 'fast' ? 20 : 40; // Записываем в БД как дни
      timeUnit = 'дней';
      millisecondsToAdd = actualDurationForDB * 24 * 60 * 60 * 1000; // Конвертируем в миллисекунды
      console.log(`🏭 ПРОДАКШН РЕЖИМ: ${actualDurationForDB} дней = ${millisecondsToAdd} миллисекунд`);
    }
    
    const returnAmount = (stakeAmountNum * (1 + planPercent / 100)).toFixed(8);
    
    // 🔥 ИСПРАВЛЕНО: Используем только миллисекунды для точности и сохраняем как timestamp
    const startTimeMs = Date.now(); // Текущее время в миллисекундах
    const endTimeMs = startTimeMs + millisecondsToAdd; // Время окончания в миллисекундах
    
    // 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Используем timestamp вместо ISO строк для PostgreSQL
    const startTimestamp = Math.floor(startTimeMs / 1000); // Unix timestamp в секундах
    const endTimestamp = Math.floor(endTimeMs / 1000); // Unix timestamp в секундах
    
    console.log(`📅 РАСЧЕТ ВРЕМЕНИ:`);
    console.log(`   Текущее время (мс): ${startTimeMs}`);
    console.log(`   Длительность (мс): ${millisecondsToAdd}`);
    console.log(`   Время окончания (мс): ${endTimeMs}`);
    console.log(`   Старт timestamp: ${startTimestamp}`);
    console.log(`   Конец timestamp: ${endTimestamp}`);
    console.log(`   Старт ISO: ${new Date(startTimeMs).toISOString()}`);
    console.log(`   Конец ISO: ${new Date(endTimeMs).toISOString()}`);
    console.log(`💰 РАСЧЕТ: ${stakeAmount} TON * ${planPercent}% = ${returnAmount} TON`);
    
    // Списываем TON с баланса
    const newTonBalance = (tonBalance - stakeAmountNum).toFixed(8);
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newTonBalance, telegramId]
    );
    
    // 🔥 ИСПРАВЛЕНО: ВСЕГДА разблокируем систему 5 при первом стейке
    // Система 5 должна оставаться разблокированной НАВСЕГДА после первой покупки
    if (!player.unlocked_systems.includes(systemId)) {
      const updatedUnlockedSystems = [...player.unlocked_systems, systemId];
      console.log(`🔓 РАЗБЛОКИРУЕМ СИСТЕМУ 5 НАВСЕГДА: было ${JSON.stringify(player.unlocked_systems)}, станет ${JSON.stringify(updatedUnlockedSystems)}`);
      
      await client.query(
        'UPDATE players SET unlocked_systems = $1 WHERE telegram_id = $2',
        [JSON.stringify(updatedUnlockedSystems), telegramId]
      );
    } else {
      console.log(`🔓 СИСТЕМА 5 УЖЕ РАЗБЛОКИРОВАНА НАВСЕГДА`);
    }
    
    // 🔥 ИСПРАВЛЕНО: Создаем запись стейка используя UTC timestamp
    const stakeResult = await client.query(
      `INSERT INTO ton_staking (
        telegram_id, system_id, stake_amount, plan_type, plan_percent, plan_days, 
        return_amount, start_date, end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8) AT TIME ZONE 'UTC', to_timestamp($9) AT TIME ZONE 'UTC') RETURNING *`,
      [telegramId, systemId, stakeAmountNum, planType, planPercent, actualDurationForDB, returnAmount, startTimestamp, endTimestamp]
    );
    
    console.log(`✅ СТЕЙК СОЗДАН В БД:`);
    console.log(`   ID: ${stakeResult.rows[0].id}`);
    console.log(`   Старт в БД: ${stakeResult.rows[0].start_date}`);
    console.log(`   Конец в БД: ${stakeResult.rows[0].end_date}`);
    console.log(`   Проверка - конец timestamp: ${Math.floor(new Date(stakeResult.rows[0].end_date).getTime() / 1000)}`);
    console.log(`   Ожидаемый timestamp: ${endTimestamp}`);
    
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
        plan_days: actualDurationForDB, // Возвращаем реальную длительность
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

// 📋 ПОЛУЧЕНИЕ СПИСКА СТЕЙКОВ ИГРОКА - С ДЕТАЛЬНОЙ ДИАГНОСТИКОЙ
router.get('/stakes/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    console.log(`📋 ПОЛУЧЕНИЕ СТЕЙКОВ ДЛЯ ИГРОКА: ${telegramId}`);
    
    // 🔥 ИСПРАВЛЕНО: Получаем активные стейки с extract для timestamp в UTC
    const result = await pool.query(
      `SELECT 
        id, system_id, stake_amount, plan_type, plan_percent, plan_days,
        return_amount, start_date, end_date, status, created_at,
        EXTRACT(EPOCH FROM end_date AT TIME ZONE 'UTC') * 1000 as end_timestamp_ms,
        EXTRACT(EPOCH FROM start_date AT TIME ZONE 'UTC') * 1000 as start_timestamp_ms
      FROM ton_staking 
      WHERE telegram_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
      [telegramId]
    );
    
    console.log(`📋 НАЙДЕНО АКТИВНЫХ СТЕЙКОВ: ${result.rows.length}`);
    
    const currentTimeMs = Date.now(); // Текущее время в миллисекундах
    console.log(`⏰ Текущее время: ${currentTimeMs} (${new Date(currentTimeMs).toISOString()})`);
    
    const stakes = result.rows.map(stake => {
      const endTimeMs = parseFloat(stake.end_timestamp_ms); // Время окончания в миллисекундах
      const timeLeftMs = endTimeMs - currentTimeMs; // Разница в миллисекундах
      
      console.log(`📊 СТЕЙК ${stake.id}:`);
      console.log(`   Конец timestamp: ${endTimeMs} (${new Date(endTimeMs).toISOString()})`);
      console.log(`   Текущее время: ${currentTimeMs} (${new Date(currentTimeMs).toISOString()})`);
      console.log(`   Осталось мс: ${timeLeftMs}`);
      
      let daysLeft, timeUnitForDisplay;
      
      if (TEST_MODE) {
        // В тестовом режиме показываем минуты
        daysLeft = Math.max(0, Math.ceil(timeLeftMs / (1000 * 60)));
        timeUnitForDisplay = 'минут';
        console.log(`   🧪 Тест режим: ${daysLeft} минут до окончания`);
      } else {
        // В обычном режиме показываем дни  
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

// 💸 ВЫВОД ЗАВЕРШЕННОГО СТЕЙКА - БЕЗ БЛОКИРОВКИ СИСТЕМЫ
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
    
    // 🔥 ИСПРАВЛЕНО: Получаем данные стейка с timestamp в UTC
    const stakeResult = await client.query(
      `SELECT *, EXTRACT(EPOCH FROM end_date AT TIME ZONE 'UTC') * 1000 as end_timestamp_ms 
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
    const endTimeMs = parseFloat(stake.end_timestamp_ms);
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
    
    // 🔥 НИКОГДА НЕ БЛОКИРУЕМ СИСТЕМУ 5!
    console.log(`🔓 СИСТЕМА 5 ОСТАЕТСЯ РАЗБЛОКИРОВАННОЙ НАВСЕГДА`);
    
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

// 💸 ОТМЕНА СТЕЙКА СО ШТРАФОМ 10% - БЕЗ БЛОКИРОВКИ СИСТЕМЫ
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
    const penalty = stakeAmount * 0.1; // 10% штраф
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
    
    // 🔥 НИКОГДА НЕ БЛОКИРУЕМ СИСТЕМУ 5!
    console.log(`🔓 СИСТЕМА 5 ОСТАЕТСЯ РАЗБЛОКИРОВАННОЙ НАВСЕГДА`);
    
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

// 🔥 ПРОВЕРКА ВОЗМОЖНОСТИ СОЗДАНИЯ СТЕЙКА В СИСТЕМЕ 5
router.post('/check-system-5', async (req, res) => {
  const { telegramId } = req.body;
  
  if (!telegramId) {
    return res.status(400).json({ 
      success: false,
      error: 'Missing telegram ID' 
    });
  }
  
  try {
    const player = await getPlayer(telegramId);
    
    if (!player) {
      return res.status(404).json({ 
        success: false,
        error: 'Player not found' 
      });
    }
    
    // Проверяем разблокирована ли система 5
    const isSystem5Unlocked = player.unlocked_systems?.includes(5);
    
    if (isSystem5Unlocked) {
      // Система 5 уже разблокирована - можно создавать новые стейки
      res.json({
        success: true,
        status: 'choose_amount',
        system_id: 5,
        min_amount: 15,
        max_amount: 1000,
        current_ton_balance: parseFloat(player.ton || 0),
        message: 'Выберите сумму для нового стейка (15-1000 TON)'
      });
    } else {
      // Система 5 не разблокирована - нужно купить за 15 TON
      res.json({
        success: true,
        status: 'need_unlock',
        system_id: 5,
        price: 15,
        currency: 'ton',
        message: 'Разблокируйте систему 5 за 15 TON'
      });
    }
    
  } catch (err) {
    console.error('❌ Ошибка проверки системы 5:', err);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

module.exports = router;