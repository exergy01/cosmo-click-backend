const pool = require('../../db');

async function getPlayer(telegramId, telegramData = null) {
  const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
  let player = playerResult.rows[0];

  if (!player) {
    console.log(`🆕 Создание нового игрока с ID: ${telegramId}`);
    
    // 🚨 КРИТИЧЕСКАЯ ДИАГНОСТИКА
    console.log('🚨 === ДИАГНОСТИКА getPlayer ===');
    console.log('telegramId:', telegramId);
    console.log('telegramData:', telegramData);
    console.log('telegramData тип:', typeof telegramData);
    console.log('telegramData.username:', telegramData?.username);
    console.log('telegramData.first_name:', telegramData?.first_name);
    console.log('🚨 === КОНЕЦ ДИАГНОСТИКИ ===');
    
    const referralLink = `https://t.me/CosmoClickBot?start=${telegramId}`;
    
    // 🔥 ИСПОЛЬЗУЕМ РЕАЛЬНЫЕ ДАННЫЕ ИЗ TELEGRAM
    let username = `user_${telegramId}`;
    let firstName = `User${telegramId.slice(-4)}`;
    
    if (telegramData) {
      // 🔥 ПРИОРИТЕТ: берем данные из telegramData
      username = telegramData.username || `user_${telegramId}`;
      firstName = telegramData.first_name || `User${telegramId.slice(-4)}`;
      
      console.log(`✅ Используем данные из Telegram: username="${username}", firstName="${firstName}"`);
    } else {
      console.log(`⚠️ telegramData не передан, используем fallback: username="${username}", firstName="${firstName}"`);
    }
    
    // ИСПРАВЛЕНО: Используем JSON.stringify для правильного формата
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

    // 🔥 ОБНОВЛЕННЫЙ SQL ЗАПРОС с поддержкой first_name
    const insertQuery = `
      INSERT INTO players (
        telegram_id, username, first_name, ccc, cs, ton, referral_link, color, 
        collected_by_system, cargo_levels, drones, asteroids, 
        last_collection_time, language, unlocked_systems, current_system,
        mining_speed_data, asteroid_total_data, max_cargo_capacity_data, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *;
    `;
    const insertValues = [
      telegramId,
      username, // 🔥 РЕАЛЬНЫЙ USERNAME
      firstName, // 🔥 РЕАЛЬНОЕ ИМЯ (first_name)
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
      null, // 🔥 ЯЗЫК НЕ УСТАНАВЛИВАЕМ! ПУСТЬ ВЫБИРАЕТ!
      JSON.stringify([1]), // ИСПРАВЛЕНО: правильный JSON массив
      1,
      initialMiningSpeedData,
      initialAsteroidTotalData,
      initialMaxCargoCapacityData,
      new Date().toISOString() // created_at
    ];
    
    try {
      const newPlayerResult = await pool.query(insertQuery, insertValues);
      player = newPlayerResult.rows[0];
      
      console.log(`✅ СОЗДАН НОВЫЙ ИГРОК:`, {
        telegram_id: player.telegram_id,
        username: player.username,
        first_name: player.first_name,
        language: player.language
      });
    } catch (error) {
      console.error(`❌ Ошибка создания игрока:`, error);
      
      // 🔥 FALLBACK: если поле first_name не существует, создаем без него
      const fallbackQuery = `
        INSERT INTO players (
          telegram_id, username, ccc, cs, ton, referral_link, color, 
          collected_by_system, cargo_levels, drones, asteroids, 
          last_collection_time, language, unlocked_systems, current_system,
          mining_speed_data, asteroid_total_data, max_cargo_capacity_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *;
      `;
      const fallbackValues = [
        telegramId,
        username,
        0, 0, 0,
        referralLink,
        '#61dafb',
        initialCollectedBySystem,
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        initialLastCollectionTime,
        null, // 🔥 ЯЗЫК НЕ УСТАНАВЛИВАЕМ!
        JSON.stringify([1]),
        1,
        initialMiningSpeedData,
        initialAsteroidTotalData,
        initialMaxCargoCapacityData,
      ];
      
      const fallbackResult = await pool.query(fallbackQuery, fallbackValues);
      player = fallbackResult.rows[0];
      
      console.log(`✅ СОЗДАН ИГРОК (FALLBACK БЕЗ first_name):`, {
        telegram_id: player.telegram_id,
        username: player.username
      });
    }
  } else {
    console.log(`✅ Игрок найден в базе:`, {
      telegram_id: player.telegram_id,
      username: player.username,
      first_name: player.first_name
    });
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

    if (!hasCargo || !hasAsteroid || !hasDrone) {
      maxCargoCapacityData[system] = 0;
      miningSpeedData[system] = 0;
    }
  });

  return {
    ...player,
    mining_speed_data: miningSpeedData,
    asteroid_total_data: player.asteroid_total_data,
    max_cargo_capacity_data: maxCargoCapacityData,
  };
}

module.exports = { getPlayer };