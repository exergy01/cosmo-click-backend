const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function fixReferralQuest() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('🔧 Исправление квеста "Пригласи друга" для игроков с рефералами...\n');

    await pool.query('BEGIN');

    // 1. Находим ID квеста invite_friend
    const questResult = await pool.query(
      `SELECT id, quest_key, reward_cs FROM quest_templates WHERE quest_key = 'invite_friend'`
    );

    if (questResult.rows.length === 0) {
      if (process.env.NODE_ENV === 'development') console.log('❌ Квест invite_friend не найден!');
      return;
    }

    const questId = questResult.rows[0].id;
    const rewardCs = questResult.rows[0].reward_cs;
    if (process.env.NODE_ENV === 'development') console.log(`✅ Квест найден: ID=${questId}, quest_key=${questResult.rows[0].quest_key}, награда=${rewardCs} CS\n`);

    // 2. Находим игроков с рефералами, у которых квест не выполнен
    const poteryashki = await pool.query(`
      SELECT
        p.telegram_id,
        p.first_name,
        p.referrals_count
      FROM players p
      LEFT JOIN player_quests pq
        ON p.telegram_id = pq.telegram_id
        AND pq.quest_id = $1
      WHERE p.referrals_count > 0
        AND (pq.completed IS NULL OR pq.completed = false)
    `, [questId]);

    if (poteryashki.rows.length === 0) {
      if (process.env.NODE_ENV === 'development') console.log('✅ Потеряшек не найдено! Все игроки с рефералами уже имеют квест.');
      await pool.query('ROLLBACK');
      return;
    }

    if (process.env.NODE_ENV === 'development') console.log(`🚨 Найдено ${poteryashki.rows.length} игроков, которым нужно сделать квест доступным для получения:\n`);

    let fixed = 0;
    let skipped = 0;

    for (const player of poteryashki.rows) {
      if (process.env.NODE_ENV === 'development') console.log(`📝 ${player.first_name} (ID: ${player.telegram_id}) - ${player.referrals_count} рефералов`);

      // Проверяем, есть ли уже запись в player_quests
      const existingQuest = await pool.query(
        `SELECT * FROM player_quests WHERE telegram_id = $1 AND quest_id = $2`,
        [player.telegram_id, questId]
      );

      if (existingQuest.rows.length > 0) {
        // Если запись есть, обновляем completed = false (чтобы показать кнопку "Забрать")
        if (process.env.NODE_ENV === 'development') console.log(`   ⚠️ Запись уже есть, обновляем на completed=false`);
        await pool.query(
          `UPDATE player_quests
           SET completed = false
           WHERE telegram_id = $1 AND quest_id = $2`,
          [player.telegram_id, questId]
        );
        skipped++;
      } else {
        // Если записи нет, создаем новую с completed = false
        if (process.env.NODE_ENV === 'development') console.log(`   ✅ Создаем новую запись с completed=false`);
        await pool.query(
          `INSERT INTO player_quests (telegram_id, quest_id, quest_key, completed, reward_cs)
           VALUES ($1, $2, $3, false, $4)`,
          [player.telegram_id, questId, 'invite_friend', rewardCs]
        );
        fixed++;
      }
    }

    await pool.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log(`\n✅ ГОТОВО!`);
    if (process.env.NODE_ENV === 'development') console.log(`   Создано новых записей: ${fixed}`);
    if (process.env.NODE_ENV === 'development') console.log(`   Обновлено существующих: ${skipped}`);
    if (process.env.NODE_ENV === 'development') console.log(`\n🎉 Теперь игроки увидят кнопку "Забрать награду" вместо "На проверке"`);
    if (process.env.NODE_ENV === 'development') console.log(`   Они смогут сами забрать свои ${rewardCs} CS!`);

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка:', err.message);
  } finally {
    pool.end();
  }
}

fixReferralQuest();
