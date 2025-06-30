// ===== routes/ton.js ===== ПОЛНОСТЬЮ ИСПРАВЛЕННЫЙ КОД
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');

const router = express.Router();

// 🔥 ТЕСТОВЫЙ РЕЖИМ: false = обычные сроки (20/40 дней)
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
    let planDays = planType === 'fast' ? 20 : 40;
    
    // 🔥 ИСПРАВЛЕНО: в тестовом режиме сроки в минутах, в обычном - в днях
    let timeUnit = 'дней';
    let actualDuration = planDays; // Для записи в БД используем оригинальные значения
    
    if (TEST_MODE) {
      actualDuration = planType === 'fast' ? 2 : 4; // 2 или 4 минуты для тестов
      timeUnit = 'минут';
      console.log(`🧪 ТЕСТОВЫЙ РЕЖИМ: ${actualDuration} минут вместо ${planDays} дней`);
    }
    
    const returnAmount = (stakeAmountNum * (1 + planPercent / 100)).toFixed(8);
    
    // 🔥 ИСПРАВЛЕНО: Правильный расчет времени окончания с использованием UTC
    const startDate = new Date(); // Текущее время
    const endDate = new Date(); // Создаем копию для расчета конца

    if (TEST_MODE) {
      // В тестовом режиме добавляем МИНУТЫ используя setTime()
      const currentTime = startDate.getTime(); // Получаем текущий timestamp в миллисекундах
      const minutesToAdd = actualDuration; // 2 или 4 минуты
      const millisecondsToAdd = minutesToAdd * 60 * 1000; // Конвертируем минуты в миллисекунды
      endDate.setTime(currentTime + millisecondsToAdd); // Устанавливаем новое время
      
      console.log(`🧪 ТЕСТОВЫЙ РЕЖИМ: добавляем ${actualDuration} минут (${millisecondsToAdd} мс)`);
      console.log(`🧪 Текущее время: ${currentTime}, Новое время: ${currentTime + millisecondsToAdd}`);
    } else {
      // В обычном режиме добавляем ДНИ
      endDate.setDate(endDate.getDate() + actualDuration);
      console.log(`🏭 ПРОДАКШН РЕЖИМ: добавляем ${actualDuration} дней`);
    }

    console.log(`📅 ДАТЫ (UTC):`);
    console.log(`   Старт: ${startDate.toISOString()}`);
    console.log(`   Конец: ${endDate.toISOString()}`);
    console.log(`   Разница в мс: ${endDate.getTime() - startDate.getTime()}`);
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
    
    // 🔥 ИСПРАВЛЕНО: Создаем запись стейка с правильным временем
    const stakeResult = await client.query(
      `INSERT INTO ton_staking (
        telegram_id, system_id, stake_amount, plan_type, plan_percent, plan_days, 
        return_amount, start_date, end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [telegramId, systemId, stakeAmountNum, planType, planPercent, actualDuration, returnAmount, startDate.toISOString(), endDate.toISOString()]
    );
    
    console.log(`✅ СТЕЙК СОЗДАН: ID ${stakeResult.rows[0].id}, завершится ${endDate.toISOString()}`);
    
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
        plan_days: actualDuration, // Возвращаем реальную длительность
        plan_percent: planPercent,
        return_amount: returnAmount,
        end_date: endDate.toISOString(),
        days_left: actualDuration,
        time_unit: timeUnit // 🔥 ДОБАВЛЕНО: указываем единицу времени
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

// 📋 ПОЛУЧЕНИЕ СПИСКА СТЕЙКОВ ИГРОКА - С ДИАГНОСТИКОЙ
router.get('/stakes/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    console.log(`📋 ПОЛУЧЕНИЕ СТЕЙКОВ ДЛЯ ИГРОКА: ${telegramId}`);
    
    // Сначала получаем ВСЕ стейки для диагностики
    const allStakesResult = await pool.query(
      `SELECT 
        id, system_id, stake_amount, plan_type, plan_percent, plan_days,
        return_amount, start_date, end_date, status, created_at,
        penalty_amount
      FROM ton_staking 
      WHERE telegram_id = $1 
      ORDER BY created_at DESC`,
      [telegramId]
    );
    
    console.log(`📋 ВСЕГО СТЕЙКОВ В БД: ${allStakesResult.rows.length}`);
    allStakesResult.rows.forEach(stake => {
      console.log(`   - Стейк ${stake.id}: система ${stake.system_id}, статус ${stake.status}, создан ${stake.created_at}`);
    });
    
    // Теперь фильтруем только активные
    const result = await pool.query(
      `SELECT 
        id, system_id, stake_amount, plan_type, plan_percent, plan_days,
        return_amount, start_date, end_date, status, created_at,
        penalty_amount
      FROM ton_staking 
      WHERE telegram_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
      [telegramId]
    );
    
    console.log(`📋 НАЙДЕНО АКТИВНЫХ СТЕЙКОВ: ${result.rows.length}`);
    result.rows.forEach(stake => {
      console.log(`   - Активный стейк ${stake.id}: система ${stake.system_id}, сумма ${stake.stake_amount}`);
    });
    
    const stakes = result.rows.map(stake => {
      // 🔥 ИСПРАВЛЕНО: Правильный расчет оставшегося времени
      const now = new Date(); // Текущее время
      const endDate = new Date(stake.end_date); // Время окончания стейка
      const timeLeftMs = endDate.getTime() - now.getTime(); // Разница в миллисекундах
      
      let daysLeft;
      let timeUnitForDisplay;
      
      if (TEST_MODE) {
        // В тестовом режиме показываем минуты
        daysLeft = Math.max(0, Math.ceil(timeLeftMs / (1000 * 60))); // Миллисекунды -> минуты
        timeUnitForDisplay = 'минут';
      } else {
        // В обычном режиме показываем дни  
        daysLeft = Math.max(0, Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24))); // Миллисекунды -> дни
        timeUnitForDisplay = 'дней';
      }
      
      console.log(`   📊 Стейк ${stake.id}: timeLeftMs=${timeLeftMs}, осталось ${daysLeft} ${timeUnitForDisplay}`);
      
      return {
        ...stake,
        days_left: daysLeft,
        is_ready: timeLeftMs <= 0, // Готов к сбору если время истекло
        end_date: endDate.toISOString(),
        start_date: new Date(stake.start_date).toISOString(),
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

// 💸 ВЫВОД ЗАВЕРШЕННОГО СТЕЙКА
router.post('/withdraw', async (req, res) => {
  const { telegramId, stakeId } = req.body;
  
  if (!telegramId || !stakeId) {
    return res.status(400).json({ 
      success: false,
      error: 'Missing required fields' 
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`💸 ВЫВОД СТЕЙКА: игрок ${telegramId}, стейк ${stakeId}`);
    
    // Получаем данные стейка
    const stakeResult = await client.query(
      'SELECT * FROM ton_staking WHERE id = $1 AND telegram_id = $2 AND status = $3',
      [stakeId, telegramId, 'active']
    );
    
    if (stakeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Stake not found or already withdrawn' 
      });
    }
    
    const stake = stakeResult.rows[0];
    // 🔥 ИСПРАВЛЕНО: Используем UTC время
    const now = new Date(); // UTC время
    const endDate = new Date(stake.end_date); // Конвертируем в UTC
    
    // Проверяем что срок истек
    if (now < endDate) {
      await client.query('ROLLBACK');
      const timeLeft = endDate - now;
      
      let timeLeftText;
      if (TEST_MODE) {
        const minutesLeft = Math.ceil(timeLeft / (1000 * 60));
        timeLeftText = `${minutesLeft} минут`;
      } else {
        const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
        timeLeftText = `${daysLeft} дней`;
      }
      
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
    
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newTonBalance, telegramId]
    );
    
    // 🔥 ИСПРАВЛЕНО: Обновляем статус стейка с UTC временем
    await client.query(
      'UPDATE ton_staking SET status = $1, withdrawn_at = $2 WHERE id = $3',
      ['withdrawn', new Date().toISOString(), stakeId]
    );
    
    // 🔥 ИСПРАВЛЕНО: НИКОГДА НЕ БЛОКИРУЕМ СИСТЕМУ 5 ПОСЛЕ РАЗБЛОКИРОВКИ!
    // Система 5 остается разблокированной навсегда после первой покупки за 15 TON
    console.log(`🔓 СИСТЕМА 5 ОСТАЕТСЯ РАЗБЛОКИРОВАННОЙ НАВСЕГДА - вывод стейка не влияет на разблокировку`);
    
    console.log(`✅ СТЕЙК ВЫВЕДЕН: ${returnAmount} TON добавлено к балансу`);
    
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
  
  console.log('🔍 ОТМЕНА СТЕЙКА ЗАПРОС:', { telegramId, stakeId });
  
  if (!telegramId || !stakeId) {
    console.log('❌ Отсутствуют обязательные поля');
    return res.status(400).json({ 
      success: false,
      error: 'Missing required fields' 
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`💸 ОТМЕНА СТЕЙКА: игрок ${telegramId}, стейк ${stakeId}`);
    
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
    
    // 🔥 ИСПРАВЛЕНО: Обновляем стейк с UTC временем
    await client.query(
      `UPDATE ton_staking SET 
        status = $1, 
        withdrawn_at = $2,
        return_amount = $3,
        penalty_amount = $4
      WHERE id = $5`,
      ['withdrawn', new Date().toISOString(), returnAmount, penalty, stakeId]
    );
    
    // 🔥 ИСПРАВЛЕНО: НИКОГДА НЕ БЛОКИРУЕМ СИСТЕМУ 5 ПОСЛЕ РАЗБЛОКИРОВКИ!
    // Система 5 остается разблокированной навсегда после первой покупки за 15 TON
    console.log(`🔓 СИСТЕМА 5 ОСТАЕТСЯ РАЗБЛОКИРОВАННОЙ НАВСЕГДА - отмена стейка не влияет на разблокировку`);
    
    console.log(`✅ СТЕЙК ОТМЕНЕН: возврат ${returnAmount} TON, штраф ${penalty} TON`);
    
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