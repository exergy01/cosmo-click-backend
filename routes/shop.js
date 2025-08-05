// ===== routes/shop.js - С ПОДДЕРЖКОЙ БОМБ И ПРАВИЛЬНЫМ ВОССТАНОВЛЕНИЕМ =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const shopData = require('../shopData.js');

const router = express.Router();

// 🎯 ФУНКЦИЯ НАЧИСЛЕНИЯ РЕФЕРАЛЬНОЙ НАГРАДЫ ПРИ ПОКУПКАХ - ПОЛНОСТЬЮ ИСПРАВЛЕНО!
const processReferralReward = async (client, telegramId, spentAmount, currency) => {
  try {
    const player = await getPlayer(telegramId);
    if (!player?.referrer_id) {
      console.log(`💸 Реферальная награда: игрок ${telegramId} не имеет реферера`);
      return;
    }

    // 🔥 Правильные проценты для всех валют
    let rewardPercentage, rewardCurrency;
    
    if (currency === 'ton') {
      rewardPercentage = 0.001; // 0.1% для TON
      rewardCurrency = 'ton';   // начисляем в TON
    } else if (currency === 'cs') {
      rewardPercentage = 0.01;  // 1% для CS
      rewardCurrency = 'cs';    // начисляем в CS
    } else {
      // Для CCC начисляем в CS
      rewardPercentage = 0.01;  // 1%
      rewardCurrency = 'cs';    // начисляем в CS
    }

    const rewardAmount = parseFloat((spentAmount * rewardPercentage).toFixed(8));

    if (rewardAmount <= 0) {
      console.log(`💸 Реферальная награда: слишком маленькая сумма (${rewardAmount})`);
      return;
    }

    console.log(`💸 Реферальная награда: игрок ${telegramId} потратил ${spentAmount} ${currency.toUpperCase()}, рефереру ${player.referrer_id} накапливается ${rewardAmount} ${rewardCurrency.toUpperCase()} (НЕ зачисляется сразу!)`);

    // ✅ ТОЛЬКО ЗАПИСЫВАЕМ В ТАБЛИЦУ REFERRALS - НИКАКОГО ЗАЧИСЛЕНИЯ НА БАЛАНС!
    const csEarned = rewardCurrency === 'cs' ? rewardAmount : 0;
    const tonEarned = rewardCurrency === 'ton' ? rewardAmount : 0;
    
    await client.query(`
      INSERT INTO referrals (referrer_id, referred_id, cs_earned, ton_earned, created_at) 
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (referrer_id, referred_id) 
      DO UPDATE SET 
        cs_earned = referrals.cs_earned + $3,
        ton_earned = referrals.ton_earned + $4
    `, [player.referrer_id, telegramId, csEarned, tonEarned]);

    console.log(`✅ Реферальная награда ТОЛЬКО накоплена в таблице: ${rewardAmount} ${rewardCurrency.toUpperCase()} для реферера ${player.referrer_id}`);
    
  } catch (err) {
    console.error('❌ Ошибка начисления реферальной награды:', err);
    // НЕ бросаем ошибку - пусть покупка продолжается
  }
};

// 🔥 ФУНКЦИЯ ПЕРЕСЧЕТА данных игрока (БЕЗ ЛОГИРОВАНИЯ)
const recalculatePlayerData = async (client, telegramId) => {
  try {
    const player = await getPlayer(telegramId);
    if (!player) return;

    const maxCargoCapacity = {};
    const miningSpeed = {};

    for (let system = 1; system <= 7; system++) {
      // Карго - берем МАКСИМАЛЬНУЮ вместимость
      const systemCargo = player.cargo_levels.filter(c => c.system === system);
      const maxCapacity = systemCargo.reduce((max, c) => Math.max(max, c.capacity || 0), 0);
      maxCargoCapacity[system] = maxCapacity;

      // Скорость добычи
      const systemDrones = player.drones.filter(d => d.system === system);
      let totalSpeed = 0;
      
      if (system === 4) {
        totalSpeed = systemDrones.reduce((sum, d) => sum + (d.csPerDay || 0), 0);
      } else {
        totalSpeed = systemDrones.reduce((sum, d) => sum + (d.cccPerDay || 0), 0);
      }
      
      // Бонус +1% за полную коллекцию дронов (15 штук) для систем 1-4
      const droneCount = systemDrones.length;
      const bonusMultiplier = (system >= 1 && system <= 4 && droneCount === 15) ? 1.01 : 1;
      
      miningSpeed[system] = (totalSpeed * bonusMultiplier) / 86400;
    }

    // НЕ ОБНОВЛЯЕМ asteroid_total_data! Только карго и скорость!
    await client.query(
      'UPDATE players SET max_cargo_capacity_data = $1, mining_speed_data = $2 WHERE telegram_id = $3',
      [JSON.stringify(maxCargoCapacity), JSON.stringify(miningSpeed), telegramId]
    );

  } catch (err) {
    console.error('Ошибка пересчета данных игрока:', err);
  }
};

// 🔥 ИСПРАВЛЕННАЯ ФУНКЦИЯ АВТОСБОРА перед покупкой
const autoCollectBeforePurchase = async (client, player, systemId) => {
  try {
    const systemStr = String(systemId);
    const lastCollectionTime = new Date(player.last_collection_time[systemStr]).getTime();
    const collectedAmount = player.collected_by_system[systemStr] || 0;
    const miningSpeed = player.mining_speed_data?.[systemId] || 0;
    const maxCargoCapacity = player.max_cargo_capacity_data?.[systemId] || 0;
    const totalAsteroidResources = player.asteroid_total_data?.[systemId] || 0;

    console.log(`🔄 АВТОСБОР система ${systemId}: уже_собрано=${collectedAmount}, скорость=${miningSpeed}/сек, карго=${maxCargoCapacity}, астероиды=${totalAsteroidResources}`);

    if (miningSpeed === 0 || maxCargoCapacity === 0) {
      console.log(`⏹️ Автосбор невозможен для системы ${systemId} (нет дронов или карго)`);
      return systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc);
    }

    const currentTime = Date.now();
    const timeElapsed = (currentTime - lastCollectionTime) / 1000;

    let newResources = collectedAmount + (miningSpeed * timeElapsed);
    newResources = Math.min(newResources, maxCargoCapacity);
    
    // 🔥 ИСПРАВЛЕНО: Ограничиваем только доступными ресурсами
    if (totalAsteroidResources > 0) {
      newResources = Math.min(newResources, totalAsteroidResources);
    } else {
      // Если астероидов нет - нечего собирать
      newResources = 0;
    }

    if (newResources <= 0) {
      console.log(`⏹️ Нечего собирать в системе ${systemId}`);
      return systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc);
    }

    console.log(`💰 К автосбору: ${newResources} ${systemId === 4 ? 'CS' : 'CCC'}`);

    const updatedCollected = { ...player.collected_by_system };
    updatedCollected[systemStr] = 0;
    const updatedTime = { ...player.last_collection_time };
    updatedTime[systemStr] = new Date().toISOString();
    
    // 🔥 ГЛАВНОЕ: ВЫЧИТАЕМ из asteroid_total_data!
    const updatedAsteroidTotal = { ...player.asteroid_total_data };
    updatedAsteroidTotal[systemStr] = Math.max(0, (updatedAsteroidTotal[systemStr] || 0) - newResources);
    
    if (systemId === 4) {
      const updatedCs = parseFloat(player.cs) + newResources;
      await client.query(
        'UPDATE players SET cs = $1, collected_by_system = $2, last_collection_time = $3, asteroid_total_data = $4 WHERE telegram_id = $5',
        [updatedCs, updatedCollected, updatedTime, updatedAsteroidTotal, player.telegram_id]
      );
      console.log(`✅ Автосбор CS: ${player.cs} + ${newResources} = ${updatedCs}, астероидов осталось: ${updatedAsteroidTotal[systemStr]}`);
      return updatedCs;
    } else {
      const updatedCcc = parseFloat(player.ccc) + newResources;
      await client.query(
        'UPDATE players SET ccc = $1, collected_by_system = $2, last_collection_time = $3, asteroid_total_data = $4 WHERE telegram_id = $5',
        [updatedCcc, updatedCollected, updatedTime, updatedAsteroidTotal, player.telegram_id]
      );
      console.log(`✅ Автосбор CCC: ${player.ccc} + ${newResources} = ${updatedCcc}, астероидов осталось: ${updatedAsteroidTotal[systemStr]}`);
      return updatedCcc;
    }
    
  } catch (err) {
    console.error('❌ Ошибка автосбора:', err);
    return systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc);
  }
};

// 💣 ИСПРАВЛЕННАЯ ФУНКЦИЯ БОМБЫ - УСТАНАВЛИВАЕТ МАКСИМАЛЬНЫЕ ЛИМИТЫ
const updateAsteroidLimits = async (client, telegramId, systemId) => {
  try {
    const player = await getPlayer(telegramId);
    if (!player) return;

    // 🔥 ПОЛУЧАЕМ МАКСИМАЛЬНЫЕ ЗНАЧЕНИЯ ИЗ shopData
    const systemAsteroids = shopData.asteroidData.filter(item => 
      item.system === systemId && item.id <= 12 // только основные астероиды
    );

    // 🔥 ВЫЧИСЛЯЕМ ОБЩИЙ МАКСИМУМ ВСЕХ АСТЕРОИДОВ СИСТЕМЫ
    let totalMaxResources = 0;
    
    systemAsteroids.forEach(asteroidData => {
      if (systemId === 4) {
        totalMaxResources += asteroidData.totalCs || 0;
      } else {
        totalMaxResources += asteroidData.totalCcc || 0;
      }
    });

    console.log(`💣 Бомба в системе ${systemId}: устанавливаем максимум ${totalMaxResources} ${systemId === 4 ? 'CS' : 'CCC'}`);

    // 🔥 УСТАНАВЛИВАЕМ МАКСИМАЛЬНЫЕ ЛИМИТЫ (НЕ ДОБАВЛЯЕМ!)
    const updatedAsteroidTotal = { ...player.asteroid_total_data };
    updatedAsteroidTotal[systemId] = totalMaxResources; // ✅ ЗАМЕНЯЕМ НА МАКСИМУМ

    // 🔥 ОБНОВЛЯЕМ ИНДИВИДУАЛЬНЫЕ АСТЕРОИДЫ НА МАКСИМАЛЬНЫЕ ЗНАЧЕНИЯ
    const updatedAsteroids = player.asteroids.map(asteroid => {
      if (asteroid.system === systemId && asteroid.id <= 12) {
        // Находим данные астероида из shopData
        const asteroidData = systemAsteroids.find(item => item.id === asteroid.id);
        if (asteroidData) {
          return {
            ...asteroid,
            // ✅ УСТАНАВЛИВАЕМ МАКСИМАЛЬНЫЕ ЗНАЧЕНИЯ
            totalCcc: systemId === 4 ? asteroid.totalCcc : (asteroidData.totalCcc || 0),
            totalCs: systemId === 4 ? (asteroidData.totalCs || 0) : asteroid.totalCs
          };
        }
      }
      return asteroid;
    });

    // 🔥 СБРАСЫВАЕМ СОБРАННЫЕ РЕСУРСЫ В СИСТЕМЕ
    const updatedCollected = { ...player.collected_by_system };
    updatedCollected[String(systemId)] = 0;

    await client.query(
      'UPDATE players SET asteroids = $1::jsonb, asteroid_total_data = $2, collected_by_system = $3 WHERE telegram_id = $4',
      [JSON.stringify(updatedAsteroids), updatedAsteroidTotal, updatedCollected, telegramId]
    );

    console.log(`💣 Бомба применена! Система ${systemId} восстановлена до максимума: ${totalMaxResources} ${systemId === 4 ? 'CS' : 'CCC'}`);
  } catch (err) {
    console.error('❌ Ошибка применения бомбы:', err);
  }
};

// GET маршруты для данных магазина
router.get('/asteroids', (req, res) => {
  res.json(shopData.asteroidData);
});

router.get('/drones', (req, res) => {
  res.json(shopData.droneData);
});

router.get('/cargo', (req, res) => {
  res.json(shopData.cargoData);
});

router.get('/systems', (req, res) => {
  res.json(shopData.systemData);
});

// GET маршруты для данных игрока
router.get('/asteroids/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const player = await pool.query('SELECT asteroids FROM players WHERE telegram_id = $1', [telegramId]);
    if (!player.rows[0]) return res.status(404).json({ error: 'Player not found' });
    res.json(player.rows[0].asteroids || []);
  } catch (err) {
    console.error('Error fetching player asteroids:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/drones/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const player = await pool.query('SELECT drones FROM players WHERE telegram_id = $1', [telegramId]);
    if (!player.rows[0]) return res.status(404).json({ error: 'Player not found' });
    res.json(player.rows[0].drones || []);
  } catch (err) {
    console.error('Error fetching player drones:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cargo/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const player = await pool.query('SELECT cargo_levels FROM players WHERE telegram_id = $1', [telegramId]);
    if (!player.rows[0]) return res.status(404).json({ error: 'Player not found' });
    res.json(player.rows[0].cargo_levels || []);
  } catch (err) {
    console.error('Error fetching player cargo:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/shop/buy - С РЕФЕРАЛЬНЫМИ НАГРАДАМИ И ПОДДЕРЖКОЙ БОМБ
router.post('/buy', async (req, res) => {
  const { telegramId, itemId, itemType, systemId, currency } = req.body;
  if (!telegramId || !itemId || !itemType || !systemId) return res.status(400).json({ error: 'Missing required fields' });

  console.log(`🛒 ПОКУПКА СТАРТ: игрок ${telegramId}, товар ${itemType} #${itemId}, система ${systemId}, валюта: ${currency || 'не указана'}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('🔍 Получаем игрока...');
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    console.log('🔄 Автосбор перед покупкой...');
    // 🔥 ИСПРАВЛЕН: Автосбор перед покупкой
    const updatedBalance = await autoCollectBeforePurchase(client, player, systemId);
    
    // 🔥 ИСПРАВЛЕНО: Получаем обновленные данные игрока после автосбора если был сбор
    let currentPlayer = player;
    if (updatedBalance !== (systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc))) {
      console.log('🔄 Получаем обновленные данные после автосбора...');
      currentPlayer = await getPlayer(telegramId);
    }

    console.log('🔍 Ищем товар...');
    // Поиск товара СНАЧАЛА
    const itemData = (itemType === 'asteroid' ? shopData.asteroidData :
                     (itemType === 'drone' || itemType === 'drones') ? shopData.droneData :
                     itemType === 'cargo' ? shopData.cargoData : []).find(item => item.id === itemId && item.system === systemId);
    
    if (!itemData) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `${itemType} not found` });
    }

    console.log('🔍 Определяем валюту...');
    // 🔥 ИСПРАВЛЕНО: ПРИОРИТЕТ ПЕРЕДАННОЙ ВАЛЮТЕ!
    let currencyToUse = currency; // Используем переданную валюту
    
    if (!currencyToUse) {
      // Только если валюта НЕ передана, определяем автоматически
      const isBomb = itemData.isBomb || (itemType === 'asteroid' && itemId === 13);
      
      if (isBomb || itemData.currency === 'ton') {
        currencyToUse = 'ton';
      } else {
        // Стандартная логика валют
        const useCs = systemId >= 1 && systemId <= 4;
        const useTon = systemId >= 5 && systemId <= 7;
        currencyToUse = useCs ? 'cs' : useTon ? 'ton' : 'ccc';
      }
    }
    
    console.log(`💰 Валюта для покупки: ${currencyToUse}, переданная: ${currency || 'нет'}, это бомба: ${itemData.isBomb || false}`);
    
    const price = itemData.price;
    console.log(`🔍 Цена товара: ${price} ${currencyToUse}`);

    // Проверка баланса
    let playerBalance;
    if (currencyToUse === 'ton') {
      playerBalance = parseFloat(currentPlayer.ton || 0);
    } else if (currencyToUse === 'cs') {
      if (systemId === 4) {
        playerBalance = updatedBalance; // CS из автосбора системы 4
      } else {
        playerBalance = parseFloat(currentPlayer.cs); // CS из обновленных данных для систем 1-3
      }
    } else {
      playerBalance = parseFloat(currentPlayer.ccc || 0);
    }
    
    console.log(`🔍 Баланс игрока: ${playerBalance} ${currencyToUse}`);
    
    if (playerBalance < price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    console.log('🔍 Проверяем дублирование...');
    // Проверка на дублирование покупки
    if (itemType === 'asteroid' && currentPlayer.asteroids.some(item => item.id === itemId && item.system === systemId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Asteroid already purchased' });
    }
    if ((itemType === 'drone' || itemType === 'drones') && currentPlayer.drones.some(item => item.id === itemId && item.system === systemId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Drone already purchased' });
    }
    if (itemType === 'cargo' && currentPlayer.cargo_levels.some(item => item.id === itemId && item.system === systemId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cargo already purchased' });
    }

    console.log('🔍 Добавляем товар...');
    // Добавление предмета в БД
    let updatedItems = [];
    const newLastCollectionTime = { ...currentPlayer.last_collection_time };
    newLastCollectionTime[String(systemId)] = new Date().toISOString();
    
    if (itemType === 'asteroid') {
      updatedItems = [...(currentPlayer.asteroids || [])];
      
      // 💣 ОСОБАЯ ЛОГИКА ДЛЯ БОМБ
      const isBomb = itemData.isBomb || itemId === 13;
      if (isBomb) {
        console.log('💣 ПОКУПКА БОМБЫ - восстанавливаем лимиты астероидов!');
        // Добавляем бомбу (без ресурсов)
        const bombData = { id: itemId, system: systemId, isBomb: true };
        updatedItems.push(bombData);
        
        // Обновляем астероиды в БД
        await client.query(
          'UPDATE players SET asteroids = $1::jsonb, last_collection_time = $2 WHERE telegram_id = $3',
          [JSON.stringify(updatedItems), newLastCollectionTime, telegramId]
        );
        
        // 💣 ВОССТАНАВЛИВАЕМ ВСЕ ЛИМИТЫ АСТЕРОИДОВ В СИСТЕМЕ
        await updateAsteroidLimits(client, telegramId, systemId);
      } else {
        // Обычный астероид
        const asteroidData = systemId === 4 ? 
          { id: itemId, system: systemId, totalCs: itemData.totalCs } :
          { id: itemId, system: systemId, totalCcc: itemData.totalCcc };
        
        updatedItems.push(asteroidData);
        
        const totalValue = systemId === 4 ? (itemData.totalCs || 0) : (itemData.totalCcc || 0);
        
        // 🔥 ИСПРАВЛЕНО: Получаем СВЕЖИЕ данные астероидов после автосбора из БД
        const freshPlayerQuery = await client.query('SELECT asteroid_total_data FROM players WHERE telegram_id = $1', [telegramId]);
        const freshAsteroidData = freshPlayerQuery.rows[0]?.asteroid_total_data || {};
        
        const updatedAsteroidTotal = { 
          ...freshAsteroidData, 
          [systemId]: (freshAsteroidData[systemId] || 0) + totalValue 
        };
        
        console.log(`🔍 Обновляем астероиды в БД... Было: ${freshAsteroidData[systemId] || 0}, добавляем: ${totalValue}, станет: ${updatedAsteroidTotal[systemId]}`);
        await client.query(
          'UPDATE players SET asteroids = $1::jsonb, asteroid_total_data = $2, last_collection_time = $3 WHERE telegram_id = $4',
          [JSON.stringify(updatedItems), updatedAsteroidTotal, newLastCollectionTime, telegramId]
        );
      }
      
    } else if (itemType === 'drone' || itemType === 'drones') {
      updatedItems = [...(currentPlayer.drones || [])];
      
      const droneData = systemId === 4 ? 
        { id: itemId, system: systemId, csPerDay: itemData.csPerDay } :
        { id: itemId, system: systemId, cccPerDay: itemData.cccPerDay };
      
      updatedItems.push(droneData);
      
      console.log('🔍 Обновляем дронов в БД...');
      await client.query(
        'UPDATE players SET drones = $1::jsonb, last_collection_time = $2 WHERE telegram_id = $3',
        [JSON.stringify(updatedItems), newLastCollectionTime, telegramId]
      );
      
    } else if (itemType === 'cargo') {
      updatedItems = [...(currentPlayer.cargo_levels || [])];
      
      const cargoData = { id: itemId, system: systemId, capacity: itemData.capacity };
      updatedItems.push(cargoData);
      
      console.log('🔍 Обновляем карго в БД...');
      await client.query(
        'UPDATE players SET cargo_levels = $1::jsonb, last_collection_time = $2 WHERE telegram_id = $3',
        [JSON.stringify(updatedItems), newLastCollectionTime, telegramId]
      );
    }

    console.log('🔍 Списываем валюту...');
    // Списание валюты
    const updatedBalanceAfterPurchase = (playerBalance - price).toFixed(5);
    await client.query(
      `UPDATE players SET ${currencyToUse} = $1 WHERE telegram_id = $2`,
      [updatedBalanceAfterPurchase, telegramId]
    );

    // 🎯 НАЧИСЛЯЕМ РЕФЕРАЛЬНУЮ НАГРАДУ ПРИ ПОКУПКЕ (КОПИТСЯ В БАЗЕ!)
    await processReferralReward(client, telegramId, price, currencyToUse);

    console.log('🔍 Пересчитываем данные...');
    // Пересчет данных игрока
    await recalculatePlayerData(client, telegramId);

    console.log('🔍 Коммитим транзакцию...');
    await client.query('COMMIT');
    
    console.log('🔍 Получаем обновленного игрока...');
    const finalPlayer = await getPlayer(telegramId);
    
    console.log(`✅ ПОКУПКА ЗАВЕРШЕНА: ${itemType} #${itemId} за ${price} ${currencyToUse}${itemData.isBomb ? ' (БОМБА!)' : ''}`);
    res.json(finalPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка покупки:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/shop/buy-system
router.post('/buy-system', async (req, res) => {
  const { telegramId, systemId, customPrice } = req.body;
  if (!telegramId || !systemId) return res.status(400).json({ error: 'Telegram ID and System ID are required' });
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const systemToBuy = shopData.systemData.find(system => system.id === systemId);
    if (!systemToBuy) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'System not found' });
    }
    
    let priceToCheck = systemToBuy.price;
    if (systemToBuy.dynamic && customPrice) {
      if (!Number.isInteger(customPrice) || customPrice < 15 || customPrice > 10000) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Custom price must be an integer between 15 and 10000' });
      }
      priceToCheck = customPrice;
    }
    
    if (systemToBuy.currency === 'cs' && parseFloat(player.cs) < priceToCheck) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough CS' });
    }
    if (systemToBuy.currency === 'ton' && parseFloat(player.ton) < priceToCheck) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough TON' });
    }
    if (player.unlocked_systems.includes(systemId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Player already owns this system' });
    }
    
    const updatedCs = systemToBuy.currency === 'cs' ? parseFloat(player.cs) - priceToCheck : parseFloat(player.cs);
    const updatedTon = systemToBuy.currency === 'ton' ? parseFloat(player.ton) - priceToCheck : parseFloat(player.ton);
    const updatedUnlockedSystems = [...player.unlocked_systems, systemId];
    const updatedCollectedBySystem = { ...player.collected_by_system };
    updatedCollectedBySystem[String(systemId)] = 0;
    const newLastCollectionTime = { ...player.last_collection_time };
    newLastCollectionTime[String(systemId)] = new Date().toISOString();
    
    await client.query(
      'UPDATE players SET cs = $1, ton = $2, unlocked_systems = $3, collected_by_system = $4, last_collection_time = $5 WHERE telegram_id = $6',
      [updatedCs, updatedTon, JSON.stringify(updatedUnlockedSystems), updatedCollectedBySystem, newLastCollectionTime, telegramId]
    );

    // 🎯 НАЧИСЛЯЕМ РЕФЕРАЛЬНУЮ НАГРАДУ ПРИ ПОКУПКЕ СИСТЕМЫ (КОПИТСЯ В БАЗЕ!)
    await processReferralReward(client, telegramId, priceToCheck, systemToBuy.currency);

    await recalculatePlayerData(client, telegramId);

    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error buying system:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/shop/recalculate/:telegramId
router.post('/recalculate/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await recalculatePlayerData(client, telegramId);
    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json({ message: 'Player data recalculated successfully', player: updatedPlayer });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error recalculating player data:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;