/**
 * Сброс данных игрока в Galactic Empire
 * Удаляет все данные игрока из Galactic Empire, но НЕ удаляет основного игрока
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetPlayer() {
  const telegramId = process.argv[2] || '123456789';

  try {
    if (process.env.NODE_ENV === 'development') console.log(`🔄 Сброс данных игрока ${telegramId} в Galactic Empire...`);
    if (process.env.NODE_ENV === 'development') console.log('   (основной игрок НЕ удаляется, только данные из GE)\n');

    await pool.query('BEGIN');

    // Удаляем бои
    const battles = await pool.query(`
      DELETE FROM galactic_empire_battles
      WHERE player1_id = $1 OR player2_id = $1
    `, [telegramId]);
    if (process.env.NODE_ENV === 'development') console.log(`   ✓ Удалено боёв: ${battles.rowCount}`);

    // Удаляем логины (для Zerg)
    const logins = await pool.query(`
      DELETE FROM galactic_empire_daily_logins
      WHERE player_id = $1
    `, [telegramId]);
    if (process.env.NODE_ENV === 'development') console.log(`   ✓ Удалено логинов: ${logins.rowCount}`);

    // Удаляем лут
    const loot = await pool.query(`
      DELETE FROM galactic_empire_loot
      WHERE player_id = $1
    `, [telegramId]);
    if (process.env.NODE_ENV === 'development') console.log(`   ✓ Удалено лута: ${loot.rowCount}`);

    // Удаляем корабли
    const ships = await pool.query(`
      DELETE FROM galactic_empire_ships
      WHERE player_id = $1
    `, [telegramId]);
    if (process.env.NODE_ENV === 'development') console.log(`   ✓ Удалено кораблей: ${ships.rowCount}`);

    // Удаляем формации
    const formations = await pool.query(`
      DELETE FROM galactic_empire_formations
      WHERE player_id = $1
    `, [telegramId]);
    if (process.env.NODE_ENV === 'development') console.log(`   ✓ Удалено формаций: ${formations.rowCount}`);

    // Удаляем данные игрока из GE
    const player = await pool.query(`
      DELETE FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);
    if (process.env.NODE_ENV === 'development') console.log(`   ✓ Сброшены данные игрока GE: ${player.rowCount}`);

    await pool.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log('\n✅ Данные игрока в Galactic Empire сброшены!');
    if (process.env.NODE_ENV === 'development') console.log('   Основной игрок остался в системе.');
    if (process.env.NODE_ENV === 'development') console.log('   Теперь можно заново выбрать расу.\n');

    process.exit(0);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

resetPlayer();
