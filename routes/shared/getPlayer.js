const pool = require('../../db');

async function getPlayer(telegramId) {
  const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
  let player = playerResult.rows[0];

  if (!player) {
    const referralLink = `https://t.me/CosmoClickBot?start=${telegramId}`;
    
    // 🔥 ИСПРАВЛЕНО: Получаем данные из Telegram
// Получаем данные из Telegram (если доступны)
const telegramUser = req.body?.telegramData || null; // Это будет позже
let username = telegramUser?.username || `user_${telegramId}`;
let first_name = telegramUser?.first_name || `User${telegramId.slice(-4)}`;
    
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

    const insertQuery = `
      INSERT INTO players (
        telegram_id, username, first_name, ccc, cs, ton, referral_link, color, 
        collected_by_system, cargo_levels, drones, asteroids, 
        last_collection_time, language, unlocked_systems, current_system,
        mining_speed_data, asteroid_total_data, max_cargo_capacity_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *;
    `;
    const insertValues = [
      telegramId,
      username,
      first_name, // 🔥 ДОБАВЛЕНО: first_name поле
      0,
      0,
      0,
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
    ];
    
    const newPlayerResult = await pool.query(insertQuery, insertValues);
    player = newPlayerResult.rows[0];
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

  return {
    ...player,
    mining_speed_data: miningSpeedData,
    asteroid_total_data: player.asteroid_total_data,
    max_cargo_capacity_data: maxCargoCapacityData,
  };
}

module.exports = { getPlayer };