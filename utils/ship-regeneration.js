/**
 * 🔄 СИСТЕМА РЕГЕНЕРАЦИИ HP КОРАБЛЕЙ
 * Galactic Empire v2.0
 */

const racesConfig = require('../config/galactic-empire/races.config');

/**
 * Вычисляет регенерацию HP для корабля
 * @param {Object} ship - Корабль из БД
 * @param {string} race - Раса игрока
 * @returns {number} - Новый current_hp
 */
function calculateRegeneratedHP(ship, race) {
  const now = Date.now();
  const lastUpdate = new Date(ship.updated_at).getTime();
  const timePassedSeconds = (now - lastUpdate) / 1000;

  // Время полного восстановления (от 0 до max_hp)
  const FULL_REGEN_TIME_HOURS = 6; // 6 часов для всех рас
  const ZERG_REGEN_TIME_HOURS = 3;  // 3 часа для Zerg (в 2 раза быстрее)

  let fullRegenSeconds = FULL_REGEN_TIME_HOURS * 60 * 60; // 6 часов в секундах

  // Бонус расы Zerg: восстановление в 2 раза быстрее
  if (race === 'zerg' && racesConfig.zerg.bonuses.regeneration) {
    fullRegenSeconds = ZERG_REGEN_TIME_HOURS * 60 * 60; // 3 часа
  }

  // Вычисляем процент восстановления
  const regenPercent = timePassedSeconds / fullRegenSeconds;

  // Вычисляем сколько HP восстановилось (от текущего HP до max)
  const hpToRegenerate = Math.floor((ship.max_hp - ship.current_hp) * regenPercent);

  if (process.env.NODE_ENV === 'development') console.log(`🔄 Regen calc for ship ${ship.id} (${race}): timePassed=${Math.floor(timePassedSeconds)}s (${(timePassedSeconds/3600).toFixed(2)}h), fullRegen=${fullRegenSeconds}s, percent=${(regenPercent*100).toFixed(2)}%, regen=${hpToRegenerate} HP, current=${ship.current_hp}/${ship.max_hp}`);

  if (hpToRegenerate <= 0) {
    return ship.current_hp; // Нет регенерации
  }

  // Новый HP не может превышать max_hp
  // ВАЖНО: регенерация работает даже с 0 HP (уничтоженные корабли медленно восстанавливаются)
  const newHP = Math.min(ship.max_hp, ship.current_hp + hpToRegenerate);

  if (process.env.NODE_ENV === 'development') console.log(`✅ Regeneration: ${ship.current_hp} → ${newHP} HP (+${hpToRegenerate})`);

  return newHP;
}

/**
 * Применяет штраф за пропуск логина (только для Zerg)
 * @param {Object} ship - Корабль из БД
 * @param {string} race - Раса игрока
 * @param {Date} lastLogin - Последний вход игрока
 * @returns {number} - Новый current_hp
 */
function applyLoginPenalty(ship, race, lastLogin) {
  if (race !== 'zerg') {
    return ship.current_hp; // Штраф только для Zerg
  }

  const zergReqs = racesConfig.zerg.requirements;
  if (!zergReqs || !zergReqs.dailyLoginRequired) {
    return ship.current_hp;
  }

  const now = Date.now();
  const lastLoginTime = new Date(lastLogin).getTime();
  const daysPassed = Math.floor((now - lastLoginTime) / (1000 * 60 * 60 * 24));

  if (daysPassed <= 1) {
    return ship.current_hp; // Нет штрафа если логин был сегодня или вчера
  }

  // Штраф: -10 HP за каждый день пропуска (начиная со 2-го дня)
  const penaltyDays = daysPassed - 1;
  const hpPenalty = penaltyDays * Math.abs(zergReqs.dailyLoginPenalty.value);

  // HP не может упасть ниже 0
  const newHP = Math.max(0, ship.current_hp - hpPenalty);

  if (process.env.NODE_ENV === 'development') console.log(`⚠️ Zerg penalty: ${penaltyDays} days missed, -${hpPenalty} HP (ship ${ship.id})`);

  return newHP;
}

/**
 * Обновляет HP всех кораблей игрока
 * @param {Object} pool - DB pool
 * @param {string} telegramId - ID игрока
 * @param {string} race - Раса игрока
 * @param {Date} lastLogin - Последний вход
 * @returns {Promise<void>}
 */
async function updateShipsHP(pool, telegramId, race, lastLogin) {
  try {
    // Получаем все корабли игрока
    const shipsResult = await pool.query(`
      SELECT * FROM galactic_empire_ships
      WHERE player_id = $1
    `, [telegramId]);

    if (shipsResult.rows.length === 0) {
      return; // Нет кораблей
    }

    for (const ship of shipsResult.rows) {
      let newHP = ship.current_hp;

      // 1. Применяем регенерацию
      newHP = calculateRegeneratedHP(ship, race);

      // 2. Применяем штраф за пропуск (только Zerg)
      newHP = applyLoginPenalty(ship, race, lastLogin);

      // Обновляем HP в БД только если изменился
      if (newHP !== ship.current_hp) {
        await pool.query(`
          UPDATE galactic_empire_ships
          SET current_hp = $1, updated_at = NOW()
          WHERE id = $2
        `, [newHP, ship.id]);

        if (process.env.NODE_ENV === 'development') console.log(`🔄 Regenerated ship ${ship.id}: ${ship.current_hp} → ${newHP} HP`);
      }
    }
  } catch (error) {
    console.error('❌ Error updating ships HP:', error);
    throw error;
  }
}

/**
 * Обновляет last_login игрока
 * @param {Object} pool - DB pool
 * @param {string} telegramId - ID игрока
 * @returns {Promise<void>}
 */
async function updateLastLogin(pool, telegramId) {
  try {
    await pool.query(`
      UPDATE galactic_empire_players
      SET last_login = NOW()
      WHERE telegram_id = $1
    `, [telegramId]);
  } catch (error) {
    console.error('❌ Error updating last login:', error);
    throw error;
  }
}

module.exports = {
  calculateRegeneratedHP,
  applyLoginPenalty,
  updateShipsHP,
  updateLastLogin
};
