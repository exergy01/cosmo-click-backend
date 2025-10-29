// ===== routes/shop.js - С ИСПРАВЛЕННОЙ МЕХАНИКОЙ БОМБЫ =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const shopData = require('../shopData.js');

const router = express.Router();

// 🎯 ФУНКЦИЯ НАЧИСЛЕНИЯ РЕФЕРАЛЬНОЙ НАГРАДЫ ПРИ ПОКУПКАХ
const processReferralReward = async (client, telegramId, spentAmount, currency) => {
  try {
    const player = await getPlayer(telegramId);
    if (!player?.referrer_id) {
      if (process.env.NODE_ENV === 'development') console.log(`💸 Реферальная награда: игрок ${telegramId} не имеет реферера`);
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
      if (process.env.NODE_ENV === 'development') console.log(`💸 Реферальная награда: слишком маленькая сумма (${rewardAmount})`);
      return;
    }

    if (process.env.NODE_ENV === 'development') console.log(`💸 Реферальная награда: игрок ${telegramId} потратил ${spentAmount} ${currency.toUpperCase()}, рефереру ${player.referrer_id} накапливается ${rewardAmount} ${rewardCurrency.toUpperCase()}`);

    // ✅ ТОЛЬКО ЗАПИСЫВАЕМ В ТАБЛИЦУ REFERRALS
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

    if (process.env.NODE_ENV === 'development') console.log(`✅ Реферальная награда накоплена: ${rewardAmount} ${rewardCurrency.toUpperCase()} для реферера ${player.referrer_id}`);
    
  } catch (err) {
    console.error('❌ Ошибка начисления реферальной награды:', err);
  }
};

// 🔥 ФУНКЦИЯ ПЕРЕСЧЕТА данных игрока
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

    await client.query(
      'UPDATE players SET max_cargo_capacity_data = $1, mining_speed_data = $2 WHERE telegram_id = $3',
      [JSON.stringify(maxCargoCapacity), JSON.stringify(miningSpeed), telegramId]
    );

  } catch (err) {
    console.error('Ошибка пересчета данных игрока:', err);
  }
};

// 🔥 АВТОСБОР перед покупкой
const autoCollectBeforePurchase = async (client, player, systemId) => {
  try {
    const systemStr = String(systemId);
    const lastCollectionTime = new Date(player.last_collection_time[systemStr]).getTime();
    const collectedAmount = player.collected_by_system[systemStr] || 0;
    const miningSpeed = player.mining_speed_data?.[systemId] || 0;
    const maxCargoCapacity = player.max_cargo_capacity_data?.[systemId] || 0;
    const totalAsteroidResources = player.asteroid_total_data?.[systemId] || 0;

    if (process.env.NODE_ENV === 'development') console.log(`🔄 АВТОСБОР система ${systemId}: собрано=${collectedAmount}, скорость=${miningSpeed}/сек, карго=${maxCargoCapacity}, астероиды=${totalAsteroidResources}`);

    if (miningSpeed === 0 || maxCargoCapacity === 0) {
      if (process.env.NODE_ENV === 'development') console.log(`⏹️ Автосбор невозможен для системы ${systemId}`);
      return systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc);
    }

    const currentTime = Date.now();
    const timeElapsed = (currentTime - lastCollectionTime) / 1000;

    let newResources = collectedAmount + (miningSpeed * timeElapsed);
    newResources = Math.min(newResources, maxCargoCapacity);
    
    if (totalAsteroidResources > 0) {
      newResources = Math.min(newResources, totalAsteroidResources);
    } else {
      newResources = 0;
    }

    if (newResources <= 0) {
      if (process.env.NODE_ENV === 'development') console.log(`⏹️ Нечего собирать в системе ${systemId}`);
      return systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc);
    }

    if (process.env.NODE_ENV === 'development') console.log(`💰 Автосбор: ${newResources} ${systemId === 4 ? 'CS' : 'CCC'}`);

    const updatedCollected = { ...player.collected_by_system };
    updatedCollected[systemStr] = 0;
    const updatedTime = { ...player.last_collection_time };
    updatedTime[systemStr] = new Date().toISOString();
    
    const updatedAsteroidTotal = { ...player.asteroid_total_data };
    updatedAsteroidTotal[systemStr] = Math.max(0, (updatedAsteroidTotal[systemStr] || 0) - newResources);
    
    if (systemId === 4) {
      const updatedCs = parseFloat(player.cs) + newResources;
      await client.query(
        'UPDATE players SET cs = $1, collected_by_system = $2, last_collection_time = $3, asteroid_total_data = $4 WHERE telegram_id = $5',
        [updatedCs, updatedCollected, updatedTime, updatedAsteroidTotal, player.telegram_id]
      );
      if (process.env.NODE_ENV === 'development') console.log(`✅ Автосбор CS: ${updatedCs}, астероидов осталось: ${updatedAsteroidTotal[systemStr]}`);
      return updatedCs;
    } else {
      const updatedCcc = parseFloat(player.ccc) + newResources;
      await client.query(
        'UPDATE players SET ccc = $1, collected_by_system = $2, last_collection_time = $3, asteroid_total_data = $4 WHERE telegram_id = $5',
        [updatedCcc, updatedCollected, updatedTime, updatedAsteroidTotal, player.telegram_id]
      );
      if (process.env.NODE_ENV === 'development') console.log(`✅ Автосбор CCC: ${updatedCcc}, астероидов осталось: ${updatedAsteroidTotal[systemStr]}`);
      return updatedCcc;
    }
    
  } catch (err) {
    console.error('❌ Ошибка автосбора:', err);
    return systemId === 4 ? parseFloat(player.cs) : parseFloat(player.ccc);
  }
};

// 💣 ИСПРАВЛЕННАЯ ФУНКЦИЯ ВОССТАНОВЛЕНИЯ ЛИМИТОВ АСТЕРОИДОВ (БОМБА)
const restoreAsteroidLimits = async (client, telegramId, systemId) => {
  try {
    const player = await getPlayer(telegramId);
    if (!player) return;

    if (process.env.NODE_ENV === 'development') console.log(`💣 ВОССТАНОВЛЕНИЕ ЛИМИТОВ для системы ${systemId} игрока ${telegramId}`);

    // 🔥 ИСПРАВЛЕНО: Получаем изначальные значения астероидов из shopData
    const systemAsteroids = shopData.asteroidData.filter(a => a.system === systemId && a.id <= 12 && !a.isBomb);
    
    // 🔥 ИСПРАВЛЕНО: Вычисляем общий лимит системы из shopData
    let totalSystemLimit = 0;
    systemAsteroids.forEach(asteroidData => {
      if (systemId === 4) {
        totalSystemLimit += asteroidData.totalCs || 0;
      } else {
        totalSystemLimit += asteroidData.totalCcc || 0;
      }
    });

    if (process.env.NODE_ENV === 'development') console.log(`💣 Восстанавливаем лимиты системы ${systemId}: ${totalSystemLimit} ${systemId === 4 ? 'CS' : 'CCC'}`);
    if (process.env.NODE_ENV === 'development') console.log(`💣 Найдено астероидов в shopData для системы ${systemId}:`, systemAsteroids.length);

    // 🔥 КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: УСТАНАВЛИВАЕМ asteroid_total_data до ПОЛНОГО изначального значения
    const updatedAsteroidTotal = { ...player.asteroid_total_data };
    updatedAsteroidTotal[systemId] = totalSystemLimit; // ЗАМЕНЯЕМ, а не добавляем!

    // ✅ СБРАСЫВАЕМ collected_by_system в 0
    const updatedCollected = { ...player.collected_by_system };
    updatedCollected[String(systemId)] = 0;

    // ✅ ОБНОВЛЯЕМ время последнего сбора
    const newLastCollectionTime = { ...player.last_collection_time };
    newLastCollectionTime[String(systemId)] = new Date().toISOString();

    await client.query(
      'UPDATE players SET asteroid_total_data = $1, collected_by_system = $2, last_collection_time = $3 WHERE telegram_id = $4',
      [updatedAsteroidTotal, updatedCollected, newLastCollectionTime, telegramId]
    );

    if (process.env.NODE_ENV === 'development') console.log(`✅ Лимиты астероидов системы ${systemId} ПОЛНОСТЬЮ ВОССТАНОВЛЕНЫ до ${totalSystemLimit}`);
    if (process.env.NODE_ENV === 'development') console.log(`💣 Было: ${player.asteroid_total_data?.[systemId] || 0}, стало: ${totalSystemLimit}`);
  } catch (err) {
    console.error('❌ Ошибка восстановления лимитов астероидов:', err);
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

// POST /api/shop/buy - ОСНОВНОЙ МАРШРУТ ПОКУПКИ
router.post('/buy', async (req, res) => {
  const { telegramId, itemId, itemType, systemId, currency } = req.body;
  if (!telegramId || !itemId || !itemType || !systemId) return res.status(400).json({ error: 'Missing required fields' });

  if (process.env.NODE_ENV === 'development') console.log(`🛒 ПОКУПКА: игрок ${telegramId}, товар ${itemType} #${itemId}, система ${systemId}, валюта: ${currency || 'не указана'}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 🔒 SECURITY: Lock player row to prevent race conditions
    const playerResult = await client.query(`
      SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // 🔄 АВТОСБОР перед покупкой из ТЕКУЩЕЙ системы (лайфхак без рекламы)
    if (process.env.NODE_ENV === 'development') console.log(`🔄 Запуск автосбора для системы ${systemId} перед покупкой`);
    await autoCollectBeforePurchase(client, player, systemId);

    // 🔥 КРИТИЧНО: Читаем данные через ТОТ ЖЕ client (внутри транзакции)!
    const updatedPlayerResult = await client.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    const currentPlayer = updatedPlayerResult.rows[0];

    // PostgreSQL возвращает JSONB поля как объекты, но на всякий случай парсим
    currentPlayer.asteroids = currentPlayer.asteroids || [];
    currentPlayer.drones = currentPlayer.drones || [];
    currentPlayer.cargo_levels = currentPlayer.cargo_levels || [];
    currentPlayer.last_collection_time = currentPlayer.last_collection_time || {};

    if (process.env.NODE_ENV === 'development') console.log(`✅ Данные игрока обновлены после автосбора: CS=${currentPlayer.cs}, CCC=${currentPlayer.ccc}`);

    // Поиск товара
    const itemData = (itemType === 'asteroid' ? shopData.asteroidData :
                     (itemType === 'drone' || itemType === 'drones') ? shopData.droneData :
                     itemType === 'cargo' ? shopData.cargoData : []).find(item => item.id === itemId && item.system === systemId);
    
    if (!itemData) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `${itemType} not found` });
    }

    // 🔥 ИСПРАВЛЕНО: ОПРЕДЕЛЯЕМ ВАЛЮТУ (с поддержкой переданной валюты и бомбы)
    let currencyToUse = currency;
    
    if (!currencyToUse) {
      // 💣 ПРОВЕРЯЕМ, ЭТО БОМБА?
      const isBomb = itemData.isBomb === true;

      if (isBomb && itemData.currency) {
        // Для бомбы используем указанную в shopData валюту
        currencyToUse = itemData.currency;
      } else if (itemData.currency === 'ton') {
        currencyToUse = 'ton';
      } else if (itemData.currency === 'cs') {
        currencyToUse = 'cs';
      } else {
        const useCs = systemId >= 1 && systemId <= 4;
        const useTon = systemId >= 5 && systemId <= 7;
        currencyToUse = useCs ? 'cs' : useTon ? 'ton' : 'ccc';
      }
    }
    
    if (process.env.NODE_ENV === 'development') console.log(`💰 Валюта: ${currencyToUse}, переданная: ${currency || 'нет'}, это бомба: ${itemData.isBomb || false}`);
    
    const price = itemData.price;

    // 🔥 ИСПРАВЛЕНО: Проверка баланса после автосбора
    let playerBalance;
    if (currencyToUse === 'ton') {
      playerBalance = parseFloat(currentPlayer.ton || 0);
    } else if (currencyToUse === 'cs') {
      // Всегда используем обновленный баланс CS из currentPlayer
      playerBalance = parseFloat(currentPlayer.cs || 0);
    } else {
      // Всегда используем обновленный баланс CCC из currentPlayer
      playerBalance = parseFloat(currentPlayer.ccc || 0);
    }
    
    if (process.env.NODE_ENV === 'development') console.log(`🔍 Баланс игрока: ${playerBalance} ${currencyToUse}, цена: ${price}`);
    
    if (playerBalance < price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    // 💣 ОСОБАЯ ЛОГИКА ДЛЯ БОМБЫ (только по флагу isBomb из shopData)
    const isBomb = itemData.isBomb === true;
    
    if (isBomb) {
      if (process.env.NODE_ENV === 'development') console.log('💣 ПОКУПКА БОМБЫ - восстанавливаем лимиты астероидов!');
      
      // ✅ НЕ ДОБАВЛЯЕМ БОМБУ В ИНВЕНТАРЬ - это просто действие!
      // ✅ Восстанавливаем лимиты астероидов
      await restoreAsteroidLimits(client, telegramId, systemId);
      
    } else {
      // Проверка на дублирование для обычных товаров
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

      // Добавление обычного товара в БД
      let updatedItems = [];
      const newLastCollectionTime = { ...currentPlayer.last_collection_time };
      newLastCollectionTime[String(systemId)] = new Date().toISOString();
      
      if (itemType === 'asteroid') {
        updatedItems = [...(currentPlayer.asteroids || [])];
        
        const asteroidData = systemId === 4 ? 
          { id: itemId, system: systemId, totalCs: itemData.totalCs } :
          { id: itemId, system: systemId, totalCcc: itemData.totalCcc };
        
        updatedItems.push(asteroidData);
        
        const totalValue = systemId === 4 ? (itemData.totalCs || 0) : (itemData.totalCcc || 0);
        
        const freshPlayerQuery = await client.query('SELECT asteroid_total_data FROM players WHERE telegram_id = $1', [telegramId]);
        const freshAsteroidData = freshPlayerQuery.rows[0]?.asteroid_total_data || {};
        
        const updatedAsteroidTotal = { 
          ...freshAsteroidData, 
          [systemId]: (freshAsteroidData[systemId] || 0) + totalValue 
        };
        
        await client.query(
          'UPDATE players SET asteroids = $1::jsonb, asteroid_total_data = $2, last_collection_time = $3 WHERE telegram_id = $4',
          [JSON.stringify(updatedItems), updatedAsteroidTotal, newLastCollectionTime, telegramId]
        );
        
      } else if (itemType === 'drone' || itemType === 'drones') {
        updatedItems = [...(currentPlayer.drones || [])];
        
        const droneData = systemId === 4 ? 
          { id: itemId, system: systemId, csPerDay: itemData.csPerDay } :
          { id: itemId, system: systemId, cccPerDay: itemData.cccPerDay };
        
        updatedItems.push(droneData);
        
        await client.query(
          'UPDATE players SET drones = $1::jsonb, last_collection_time = $2 WHERE telegram_id = $3',
          [JSON.stringify(updatedItems), newLastCollectionTime, telegramId]
        );
        
      } else if (itemType === 'cargo') {
        updatedItems = [...(currentPlayer.cargo_levels || [])];
        
        const cargoData = { id: itemId, system: systemId, capacity: itemData.capacity };
        updatedItems.push(cargoData);
        
        await client.query(
          'UPDATE players SET cargo_levels = $1::jsonb, last_collection_time = $2 WHERE telegram_id = $3',
          [JSON.stringify(updatedItems), newLastCollectionTime, telegramId]
        );
      }
    }

    // Списание валюты
    const updatedBalanceAfterPurchase = (playerBalance - price).toFixed(5);
    await client.query(
      `UPDATE players SET ${currencyToUse} = $1 WHERE telegram_id = $2`,
      [updatedBalanceAfterPurchase, telegramId]
    );

    // Реферальная награда
    await processReferralReward(client, telegramId, price, currencyToUse);

    // Пересчет данных игрока
    await recalculatePlayerData(client, telegramId);

    await client.query('COMMIT');
    
    const finalPlayer = await getPlayer(telegramId);
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ ПОКУПКА ЗАВЕРШЕНА: ${itemType} #${itemId} за ${price} ${currencyToUse}${isBomb ? ' (БОМБА - ЛИМИТЫ ВОССТАНОВЛЕНЫ!)' : ''}`);
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

    // 🔒 SECURITY: Lock player row to prevent race conditions
    const playerResult = await client.query(`
      SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

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