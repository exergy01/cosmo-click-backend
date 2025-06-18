// ===== routes/shop.js =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const shopData = require('../shopData.js');
// 🔥 ВРЕМЕННО ОТКЛЮЧАЕМ ЛОГИРОВАНИЕ
// const { logPurchase, logBalanceChange, checkSuspiciousActivity } = require('./shared/logger');

const router = express.Router();

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

// POST /api/shop/buy - С ИСПРАВЛЕННЫМ АВТОСБОРОМ
router.post('/buy', async (req, res) => {
  const { telegramId, itemId, itemType, systemId, currency } = req.body;
  if (!telegramId || !itemId || !itemType || !systemId) return res.status(400).json({ error: 'Missing required fields' });

  console.log(`🛒 ПОКУПКА СТАРТ: игрок ${telegramId}, товар ${itemType} #${itemId}, система ${systemId}`);

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

    console.log('🔍 Определяем валюту...');
    // Определяем валюту для покупки
    const useCs = systemId >= 1 && systemId <= 4;
    const useTon = systemId >= 5 && systemId <= 7;
    const currencyToUse = useCs ? 'cs' : useTon ? 'ton' : 'ccc';
    
    if (currency && currency !== currencyToUse) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Invalid currency for system ${systemId}. Use ${currencyToUse}` });
    }

    console.log('🔍 Ищем товар...');
    // Поиск товара
    const itemData = (itemType === 'asteroid' ? shopData.asteroidData :
                     (itemType === 'drone' || itemType === 'drones') ? shopData.droneData :
                     itemType === 'cargo' ? shopData.cargoData : []).find(item => item.id === itemId && item.system === systemId);
    
    if (!itemData) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `${itemType} not found` });
    }

    const price = itemData.price;
    console.log(`🔍 Цена товара: ${price} ${currencyToUse}`);

    // Проверка баланса
    let playerBalance;
    if (systemId >= 1 && systemId <= 4) {
      if (systemId === 4) {
        playerBalance = updatedBalance; // CS из автосбора системы 4
      } else {
        playerBalance = parseFloat(currentPlayer.cs); // CS из обновленных данных для систем 1-3
      }
    } else if (systemId >= 5 && systemId <= 7) {
      playerBalance = parseFloat(currentPlayer.ton || 0); // TON для систем 5-7
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
    const oldBalance = playerBalance;
    const updatedBalanceAfterPurchase = (playerBalance - price).toFixed(5);
    await client.query(
      `UPDATE players SET ${currencyToUse} = $1 WHERE telegram_id = $2`,
      [updatedBalanceAfterPurchase, telegramId]
    );

    console.log(`💰 БАЛАНС ОБНОВЛЕН: ${currencyToUse} ${oldBalance} → ${updatedBalanceAfterPurchase}`);

    console.log('🔍 Пересчитываем данные...');
    // Пересчет данных игрока
    await recalculatePlayerData(client, telegramId);

    console.log('🔍 Коммитим транзакцию...');
    await client.query('COMMIT');
    
    console.log('🔍 Получаем обновленного игрока...');
    const finalPlayer = await getPlayer(telegramId);
    
    console.log(`✅ ПОКУПКА ЗАВЕРШЕНА: ${itemType} #${itemId} за ${price} ${currencyToUse}`);
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
      if (!Number.isInteger(customPrice) || customPrice < 15 || customPrice > 1000) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Custom price must be an integer between 15 and 1000' });
      }
      priceToCheck = customPrice;
    }
    
    // Проверка баланса
    if (systemToBuy.currency === 'cs' && parseFloat(player.cs) < priceToCheck) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough CS' });
    }
    if (systemToBuy.currency === 'ton' && parseFloat(player.ton || 0) < priceToCheck) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough TON' });
    }
    if (player.unlocked_systems.includes(systemId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Player already owns this system' });
    }
    
    // 🔥 ОСОБАЯ ЛОГИКА ДЛЯ TON СИСТЕМ (5-7)
    if (systemId >= 5 && systemId <= 7) {
      // Для TON систем - НЕ завершаем покупку, а возвращаем выбор тарифа
      await client.query('ROLLBACK'); // Откатываем транзакцию
      
      return res.json({
        status: 'choose_plan',
        system_id: systemId,
        stake_amount: priceToCheck,
        currency: 'ton',
        plans: [
          {
            type: 'fast',
            days: 20,
            percent: 3,
            return_amount: (priceToCheck * 1.03).toFixed(8)
          },
          {
            type: 'standard', 
            days: 40,
            percent: 7,
            return_amount: (priceToCheck * 1.07).toFixed(8)
          }
        ]
      });
    }
    
    // 🔥 ОБЫЧНАЯ ЛОГИКА ДЛЯ СИСТЕМ 1-4
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

    console.log(`💰 СИСТЕМА КУПЛЕНА: #${systemId} за ${priceToCheck} ${systemToBuy.currency}`);

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