const pool = require('../../db');

async function getPlayer(telegramId) {
  console.log(`🔍 getPlayer вызван для игрока: ${telegramId}, тип: ${typeof telegramId}`);
  
  // Приводим telegramId к строке для совместимости
  const safeTelegramId = String(telegramId);
  console.log(`🔍 Используем safeTelegramId: ${safeTelegramId}`);
  
  const playerResult = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [safeTelegramId]);
  let player = playerResult.rows[0];

  if (!player) {
    console.log(`❌ getPlayer: игрок ${safeTelegramId} НЕ НАЙДЕН - возвращаем null`);
    console.log(`ℹ️ Проверяем напрямую: ${JSON.stringify(playerResult.rows)}`);
    console.log(`ℹ️ Создание игроков теперь происходит через endpoint create-with-referrer`);
    return null; // 🔥 НЕ СОЗДАЕМ ИГРОКА - возвращаем null
  }

  console.log(`✅ getPlayer: игрок ${safeTelegramId} найден, referrer_id = ${player.referrer_id}`);

  // 🔥 ИСПРАВЛЕНО: Пересчитываем точный счетчик рефералов из таблицы referrals
  try {
    const referralsCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1', 
      [safeTelegramId]
    );
    const actualCount = parseInt(referralsCountResult.rows[0].count);
    
    // Если счетчик в players отличается - обновляем
    if (player.referrals_count !== actualCount) {
      console.log(`🔄 Обновляем счетчик рефералов: ${player.referrals_count} → ${actualCount}`);
      await pool.query(
        'UPDATE players SET referrals_count = $1 WHERE telegram_id = $2', 
        [actualCount, safeTelegramId]
      );
      player.referrals_count = actualCount;
    }
  } catch (err) {
    console.error('❌ Ошибка пересчета рефералов:', err);
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
  console.log(`🔧 getPlayer: точный счетчик рефералов = ${player.referrals_count}`);

  return {
    ...player,
    mining_speed_data: miningSpeedData,
    asteroid_total_data: player.asteroid_total_data,
    max_cargo_capacity_data: maxCargoCapacityData,
  };
}

module.exports = { getPlayer };