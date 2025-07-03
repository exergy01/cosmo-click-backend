const pool = require('../../db');

async function getPlayer(telegramId) {
  const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
  let player = playerResult.rows[0];

  if (!player) {
    // 🔥 ИСПРАВЛЕНО: Используем startapp вместо start для Mini Apps
    const referralLink = `https://t.me/CosmoClickBot?startapp=${telegramId}`;
    
    // Получаем данные из Telegram (если доступны)
    const telegramUser = null; // Данные Telegram будут получены на фронтенде
    let username = `user_${telegramId}`;
    let first_name = `User${telegramId.slice(-4)}`;

    // Пытаемся получить реальные данные из Telegram Web App (если доступны)
    // В production эти данные должны передаваться с фронтенда
    
    const initialCollectedBySystem = JSON.stringify({
      "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0
    });
    
    const initialLastCollectionTime = JSON.stringify({
      "1": new Date().toISOString(),
      "2": new Date().toISOString(), 
      "3": new Date().toISOString(),
      "4": new Date().toISOString(),
      "5": new Date().toISOString(),
      "6": new Date().toISOString(),
      "7": new Date().toISOString()
    });

    const initialMiningSpeedData = JSON.stringify({
      "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0
    });

    const initialAsteroidTotalData = JSON.stringify({
      "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0
    });

    const initialMaxCargoCapacityData = JSON.stringify({
      "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0
    });

    // 🔥 ИСПРАВЛЕНО: Добавляем referrer_id сразу при создании
    const insertQuery = `
      INSERT INTO players (
        telegram_id, username, first_name, ccc, cs, ton, referral_link, color, 
        collected_by_system, cargo_levels, drones, asteroids, 
        last_collection_time, language, unlocked_systems, current_system,
        mining_speed_data, asteroid_total_data, max_cargo_capacity_data,
        referrer_id, referrals_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *;
    `;
    
    const referrerId = '1222791281'; // дефолтный рефер
    
    const insertValues = [
      telegramId,
      username,
      first_name,
      0, // ccc
      0, // cs
      0, // ton
      referralLink,
      '#61dafb',
      initialCollectedBySystem,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      initialLastCollectionTime,
      null, // language остается null
      JSON.stringify([1]),
      1,
      initialMiningSpeedData,
      initialAsteroidTotalData,
      initialMaxCargoCapacityData,
      referrerId, // 🔥 ДОБАВЛЕНО: referrer_id
      0 // 🔥 ДОБАВЛЕНО: referrals_count
    ];
    
    const newPlayerResult = await pool.query(insertQuery, insertValues);
    player = newPlayerResult.rows[0];
    
    console.log(`🎯 Создан новый игрок ${telegramId} с реферером ${referrerId}`);

    // 🎯 РЕФЕРАЛЬНАЯ ЛОГИКА ПРИ СОЗДАНИИ ИГРОКА
    try {
      console.log(`🎯 Регистрируем нового игрока ${telegramId} под рефером ${referrerId}`);
      
      // Проверяем, что рефер существует и это не сам игрок
      if (referrerId !== telegramId) {
        const referrerCheck = await pool.query('SELECT telegram_id FROM players WHERE telegram_id = $1', [referrerId]);
        if (referrerCheck.rows.length > 0) {
          // Увеличиваем счетчик рефералов у реферера
          await pool.query('UPDATE players SET referrals_count = referrals_count + 1 WHERE telegram_id = $1', [referrerId]);
          
          // Записываем в таблицу рефералов
          await pool.query('INSERT INTO referrals (referrer_id, referred_id, cs_earned, ton_earned, timestamp) VALUES ($1, $2, $3, $4, NOW())', [referrerId, telegramId, 0, 0]);
          
          console.log(`✅ Реферальная регистрация успешна: ${telegramId} → ${referrerId}`);
        } else {
          console.log(`❌ Рефер ${referrerId} не найден в базе данных`);
        }
      }
      
    } catch (referralErr) {
      console.error('❌ Ошибка реферальной регистрации:', referralErr);
      // НЕ падаем если реферальная регистрация не удалась
    }
  }

  // Убеждаемся что все нужные поля существуют
  player.asteroids = player.asteroids || [];
  player.drones = player.drones || [];
  player.cargo_levels = player.cargo_levels || [];
  player.mining_speed_data = player.mining_speed_data || {};
  player.asteroid_total_data = player.asteroid_total_data || {};
  player.max_cargo_capacity_data = player.max_cargo_capacity_data || {};

  // Вычисляем актуальные данные для каждой системы
  const miningSpeedData = {};
  const maxCargoCapacityData = {};

  [1, 2, 3, 4, 5, 6, 7].forEach(system => {
    const hasAsteroid = player.asteroids.some(a => a.system === system);
    const hasDrone = player.drones.some(d => d.system === system);
    const hasCargo = player.cargo_levels.some(c => c.system === system);

    if (hasAsteroid && hasDrone && hasCargo) {
      const systemDrones = player.drones.filter(d => d.system === system);
      
      // 🔧 ИСПРАВЛЕНО: правильная логика для системы 4
      const totalDroneSpeed = systemDrones.reduce((speed, drone) => {
        if (system === 4) {
          return speed + (drone.csPerDay || 0);
        } else {
          return speed + (drone.cccPerDay || 0);
        }
      }, 0);
      
      // 🎉 БОНУС: +1% за полную коллекцию дронов (15 штук) для систем 1-4
      const droneCount = systemDrones.length;
      const bonusMultiplier = (system >= 1 && system <= 4 && droneCount === 15) ? 1.01 : 1;
      
      const speedPerSecond = (totalDroneSpeed * bonusMultiplier) / (24 * 3600);
      miningSpeedData[system] = speedPerSecond > 0 ? speedPerSecond : 0;
    } else {
      miningSpeedData[system] = 0;
    }

    // 🔥 ИСПРАВЛЕНО: берем МАКСИМАЛЬНУЮ вместимость карго, а не текущую
    const systemCargo = player.cargo_levels.filter(c => c.system === system);
    const maxCargoCapacity = systemCargo.reduce((max, c) => Math.max(max, c.capacity || 0), 0);
    maxCargoCapacityData[system] = Number(maxCargoCapacity);

    console.log(`🔧 getPlayer система ${system}: карго объекты =`, systemCargo, `максимум = ${maxCargoCapacity}`);

    if (!hasCargo || !hasAsteroid || !hasDrone) {
      maxCargoCapacityData[system] = 0;
      miningSpeedData[system] = 0;
    }
  });

  console.log('🔧 getPlayer: финальные max_cargo_capacity_data =', maxCargoCapacityData);
  console.log(`🔧 getPlayer: игрок ${telegramId}, referrer_id = ${player.referrer_id}`);

  return {
    ...player,
    mining_speed_data: miningSpeedData,
    asteroid_total_data: player.asteroid_total_data,
    max_cargo_capacity_data: maxCargoCapacityData,
  };
}

module.exports = { getPlayer };