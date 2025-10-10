/**
 * 🧪 ТЕСТ БОЕВОЙ СИСТЕМЫ GALACTIC EMPIRE
 * Создаёт тестового игрока и запускает бой
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const TEST_PLAYER_ID = '999999999'; // Тестовый игрок

async function setupTestPlayer() {
  console.log('🎮 Создаю тестового игрока...\n');

  try {
    await pool.query('BEGIN');

    // Удаляем старые данные если есть
    await pool.query('DELETE FROM galactic_empire_ships WHERE player_id = $1', [TEST_PLAYER_ID]);
    await pool.query('DELETE FROM galactic_empire_formations WHERE player_id = $1', [TEST_PLAYER_ID]);
    await pool.query('DELETE FROM galactic_empire_battles WHERE player1_id = $1', [TEST_PLAYER_ID]);
    await pool.query('DELETE FROM galactic_empire_players WHERE telegram_id = $1', [TEST_PLAYER_ID]);

    // Создаём игрока
    await pool.query(`
      INSERT INTO galactic_empire_players (
        telegram_id, race, luminios_balance, total_battles, total_wins
      ) VALUES ($1, $2, $3, $4, $5)
    `, [TEST_PLAYER_ID, 'amarr', 10000, 0, 0]);

    console.log('✅ Создан игрок:', TEST_PLAYER_ID, '| Раса: Amarr');

    // Создаём 5 кораблей
    const ships = [
      { type: 'frigate_t2', hp: 120, attack: 35, defense: 25, speed: 80 },
      { type: 'frigate_t2', hp: 120, attack: 35, defense: 25, speed: 75 },
      { type: 'destroyer_t1', hp: 200, attack: 50, defense: 40, speed: 60 },
      { type: 'destroyer_t2', hp: 280, attack: 70, defense: 55, speed: 55 },
      { type: 'cruiser_t1', hp: 400, attack: 90, defense: 70, speed: 45 }
    ];

    const shipIds = [];

    for (const ship of ships) {
      const result = await pool.query(`
        INSERT INTO galactic_empire_ships (
          player_id, ship_type, ship_class, tier, race,
          max_hp, current_hp, attack, defense, speed,
          built_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING id
      `, [
        TEST_PLAYER_ID,
        ship.type,
        ship.type.split('_')[0],
        parseInt(ship.type.split('_')[1].replace('t', '')),
        'amarr',
        ship.hp,
        ship.hp,
        ship.attack,
        ship.defense,
        ship.speed
      ]);

      shipIds.push(result.rows[0].id);
      console.log(`✅ Создан корабль: ${ship.type} (HP: ${ship.hp}, ATK: ${ship.attack})`);
    }

    // Создаём формацию
    await pool.query(`
      INSERT INTO galactic_empire_formations (
        player_id, race, slot_1, slot_2, slot_3, slot_4, slot_5, slot_4_unlocked, slot_5_unlocked
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [TEST_PLAYER_ID, 'amarr', shipIds[0], shipIds[1], shipIds[2], shipIds[3], shipIds[4], true, true]);

    console.log('✅ Создана формация из 5 кораблей\n');

    await pool.query('COMMIT');

    return shipIds;
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка создания тестового игрока:', error);
    throw error;
  }
}

async function testBattle() {
  console.log('⚔️ Запускаю тестовый бой...\n');

  try {
    // Симулируем POST запрос
    const axios = require('axios');
    const API_URL = process.env.API_URL || 'http://localhost:5000';

    const response = await axios.post(`${API_URL}/api/galactic-empire/battles/start-pve`, {
      telegramId: TEST_PLAYER_ID
    });

    const battle = response.data;

    console.log('🎉 Бой завершён!');
    console.log('━'.repeat(60));
    console.log(`🏆 Победитель: ${battle.winner === 1 ? 'Игрок' : battle.winner === 2 ? 'Бот' : 'Ничья'}`);
    console.log(`📊 Раунды: ${battle.rounds}`);
    console.log(`💰 Награда: ${battle.reward} Luminios`);
    console.log(`📝 Действий в логе: ${battle.battleLog.length}`);
    console.log('━'.repeat(60));

    // Показываем первые 5 действий
    console.log('\n📜 Первые 5 действий боя:');
    battle.battleLog.slice(0, 5).forEach((action, i) => {
      console.log(`  ${i + 1}. Раунд ${action.round}: ${action.attacker.shipType} → ${action.target.shipType}`);
      console.log(`     Урон: ${action.damage}${action.isCrit ? ' КРИТ!' : ''}, осталось HP: ${action.targetRemainingHP}${action.isKill ? ' 💀' : ''}`);
    });

    // Показываем состояние флотов после боя
    console.log('\n🚀 Флот игрока после боя:');
    battle.playerFleet.forEach((ship, i) => {
      console.log(`  ${i + 1}. ${ship.ship_type}: ${ship.current_hp}/${ship.max_hp} HP`);
    });

    console.log('\n🤖 Флот бота после боя:');
    battle.botFleet.forEach((ship, i) => {
      console.log(`  ${i + 1}. ${ship.ship_type}: ${ship.current_hp}/${ship.max_hp} HP`);
    });

    console.log('\n✅ Тест завершён успешно!');
    console.log(`🔗 ID боя: ${battle.battleId}`);

    return battle;
  } catch (error) {
    console.error('❌ Ошибка тестового боя:', error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  🧪 ТЕСТ БОЕВОЙ СИСТЕМЫ GALACTIC EMPIRE v2.0          ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    await setupTestPlayer();
    const battle = await testBattle();

    console.log('\n✨ Система работает! Теперь можно протестировать визуализацию.');
    console.log(`📱 Зайдите в игру с ID: ${TEST_PLAYER_ID}`);

  } catch (error) {
    console.error('\n💥 Тест провален:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
