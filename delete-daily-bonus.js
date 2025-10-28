const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function deleteDailyBonus() {
  try {
    await pool.query('BEGIN');

    if (process.env.NODE_ENV === 'development') console.log('🗑️ Удаляем квест daily_bonus_2025...\n');

    // 1. Проверяем есть ли у игроков выполненные записи
    const playerQuestsCheck = await pool.query(
      `SELECT COUNT(*) as count FROM player_quests WHERE quest_key = 'daily_bonus_2025'`
    );
    if (process.env.NODE_ENV === 'development') console.log(`Найдено записей в player_quests: ${playerQuestsCheck.rows[0].count}`);

    // 2. Удаляем переводы
    const translationsResult = await pool.query(
      `DELETE FROM quest_translations WHERE quest_key = 'daily_bonus_2025' RETURNING language_code`
    );
    if (process.env.NODE_ENV === 'development') console.log(`✅ Удалено переводов: ${translationsResult.rowCount}`);

    // 3. Удаляем записи игроков (если есть)
    const playerQuestsResult = await pool.query(
      `DELETE FROM player_quests WHERE quest_key = 'daily_bonus_2025' RETURNING telegram_id`
    );
    if (process.env.NODE_ENV === 'development') console.log(`✅ Удалено записей player_quests: ${playerQuestsResult.rowCount}`);

    // 4. Удаляем записи из quest_scheduler_history
    const schedulerResult = await pool.query(
      `DELETE FROM quest_scheduler_history WHERE quest_template_id = (SELECT id FROM quest_templates WHERE quest_key = 'daily_bonus_2025') RETURNING id`
    );
    if (process.env.NODE_ENV === 'development') console.log(`✅ Удалено записей из quest_scheduler_history: ${schedulerResult.rowCount}`);

    // 5. Удаляем сам квест
    const questResult = await pool.query(
      `DELETE FROM quest_templates WHERE quest_key = 'daily_bonus_2025' RETURNING quest_key, quest_type, reward_cs`
    );

    if (questResult.rowCount > 0) {
      if (process.env.NODE_ENV === 'development') console.log(`✅ Удален квест: ${questResult.rows[0].quest_key} (${questResult.rows[0].quest_type}, ${questResult.rows[0].reward_cs} CS)`);
    } else {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Квест не найден в quest_templates');
    }

    await pool.query('COMMIT');
    if (process.env.NODE_ENV === 'development') console.log('\n🎉 Квест daily_bonus_2025 полностью удален из системы!');

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Ошибка:', err.message);
  } finally {
    pool.end();
  }
}

deleteDailyBonus();
