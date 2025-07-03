// backend/routes/shared/getPlayer.js

const pool = require('../../db');

async function getPlayer(telegramId) {
  try {
    const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    let player = playerResult.rows[0];

    // --- ИСПРАВЛЕНИЕ НАЧИНАЕТСЯ ЗДЕСЬ ---
    // Если игрока нет, просто возвращаем null.
    // Фронтенд (usePlayerData.ts) затем вызовет POST /api/player/create
    // для регистрации нового игрока с учетом реферальных данных.
    if (!player) {
      return null;
    }
    // --- ИСПРАВЛЕНИЕ ЗАКАНЧИВАЕТСЯ ЗДЕСЬ ---

    // Далее идет код для обработки существующего игрока, который НЕ БЫЛ изменен.
    // Если игрок найден, мы можем обогатить его данные, например, скоростью добычи.

    // Вычисляем общую скорость добычи для каждой системы (системы 1-7)
    const miningSpeedData = {};
    const maxCargoCapacityData = {};

    for (let system = 1; system <= 7; system++) {
      const hasCargo = player.cargo_levels && player.cargo_levels.some(c => c.system === system && c.level > 0);
      const hasAsteroid = player.asteroid_levels && player.asteroid_levels.some(a => a.system === system && a.level > 0);
      const hasDrone = player.drone_levels && player.drone_levels.some(d => d.system === system && d.level > 0);

      // Скорость добычи
      const systemDrones = player.drone_levels.filter(d => d.system === system && d.level > 0);
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
    }

    // 🔥 ИСПРАВЛЕНО: берем МАКСИМАЛЬНУЮ вместимость карго, а не текущую
    const systemCargo = player.cargo_levels.filter(c => c.system === system);
    const maxCargoCapacity = systemCargo.reduce((max, c) => Math.max(max, c.capacity || 0), 0);
    maxCargoCapacityData[system] = Number(maxCargoCapacity);

    console.log(`🔧 getPlayer система ${system}: карго объекты =`, systemCargo, `максимум = ${maxCargoCapacity}`);

    if (!hasCargo || !hasAsteroid || !hasDrone) {
      // Игрок не готов к майнингу в этой системе
      miningSpeedData[system] = 0;
    }

    // Добавляем вычисленные данные к объекту игрока
    player.mining_speed = miningSpeedData;
    player.max_cargo_capacity = maxCargoCapacityData;
    
    return player;

  } catch (error) {
    console.error('Ошибка в getPlayer:', error);
    throw error;
  }
}

module.exports = { getPlayer };