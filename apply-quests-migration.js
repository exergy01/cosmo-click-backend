const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Читаем DATABASE_URL из .env
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function applyMigration() {
  const client = await pool.connect();

  try {
    if (process.env.NODE_ENV === 'development') console.log('\n========================================');
    if (process.env.NODE_ENV === 'development') console.log('🚀 ПРИМЕНЕНИЕ МИГРАЦИИ 008: КВЕСТЫ');
    if (process.env.NODE_ENV === 'development') console.log('========================================\n');

    // Читаем SQL файл
    const migrationPath = path.join(__dirname, 'migrations', '008_migrate_old_quests.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    if (process.env.NODE_ENV === 'development') console.log('📄 Файл миграции:', migrationPath);
    if (process.env.NODE_ENV === 'development') console.log('📊 Размер:', migrationSQL.length, 'байт\n');

    // Проверяем текущее состояние
    if (process.env.NODE_ENV === 'development') console.log('📊 Текущее состояние базы данных:\n');

    const oldQuests = await client.query('SELECT COUNT(*) as count FROM quests WHERE is_active = true');
    if (process.env.NODE_ENV === 'development') console.log('   Старых квестов (quests):', oldQuests.rows[0].count);

    const newQuests = await client.query('SELECT COUNT(*) as count FROM quest_templates');
    if (process.env.NODE_ENV === 'development') console.log('   Новых квестов (quest_templates):', newQuests.rows[0].count);

    const playerQuests = await client.query('SELECT COUNT(*) as count FROM player_quests WHERE quest_key IS NULL');
    if (process.env.NODE_ENV === 'development') console.log('   Player quests без quest_key:', playerQuests.rows[0].count);

    if (process.env.NODE_ENV === 'development') console.log('\n⏳ Применяю миграцию...\n');

    // Применяем миграцию
    await client.query(migrationSQL);

    if (process.env.NODE_ENV === 'development') console.log('\n✅ Миграция применена успешно!\n');

    // Проверяем результат
    if (process.env.NODE_ENV === 'development') console.log('========================================');
    if (process.env.NODE_ENV === 'development') console.log('📊 РЕЗУЛЬТАТЫ МИГРАЦИИ');
    if (process.env.NODE_ENV === 'development') console.log('========================================\n');

    const newQuestsAfter = await client.query('SELECT COUNT(*) as count FROM quest_templates');
    if (process.env.NODE_ENV === 'development') console.log('   Всего quest_templates:', newQuestsAfter.rows[0].count);

    const migratedQuests = await client.query("SELECT COUNT(*) as count FROM quest_templates WHERE created_by = 'migration_008'");
    if (process.env.NODE_ENV === 'development') console.log('   Добавлено миграцией:', migratedQuests.rows[0].count);

    const ruTranslations = await client.query("SELECT COUNT(*) as count FROM quest_translations WHERE language_code = 'ru'");
    if (process.env.NODE_ENV === 'development') console.log('   Русских переводов:', ruTranslations.rows[0].count);

    const enTranslations = await client.query("SELECT COUNT(*) as count FROM quest_translations WHERE language_code = 'en'");
    if (process.env.NODE_ENV === 'development') console.log('   Английских переводов:', enTranslations.rows[0].count);

    const updatedPlayerQuests = await client.query('SELECT COUNT(*) as count FROM player_quests WHERE quest_key IS NOT NULL');
    if (process.env.NODE_ENV === 'development') console.log('   Player quests с quest_key:', updatedPlayerQuests.rows[0].count);

    const stillNoKey = await client.query('SELECT COUNT(*) as count FROM player_quests WHERE quest_key IS NULL');
    if (process.env.NODE_ENV === 'development') console.log('   Player quests без quest_key:', stillNoKey.rows[0].count);

    // Показываем список всех квестов
    if (process.env.NODE_ENV === 'development') console.log('\n========================================');
    if (process.env.NODE_ENV === 'development') console.log('📋 ВСЕ КВЕСТЫ В НОВОЙ СИСТЕМЕ:');
    if (process.env.NODE_ENV === 'development') console.log('========================================\n');

    const allQuests = await client.query(`
      SELECT
        qt.quest_key,
        qt.quest_type,
        qt.reward_cs,
        qt.is_active,
        COALESCE(qtr_ru.quest_name, qtr_en.quest_name, qt.quest_key) as name
      FROM quest_templates qt
      LEFT JOIN quest_translations qtr_ru ON qt.quest_key = qtr_ru.quest_key AND qtr_ru.language_code = 'ru'
      LEFT JOIN quest_translations qtr_en ON qt.quest_key = qtr_en.quest_key AND qtr_en.language_code = 'en'
      ORDER BY qt.sort_order
    `);

    allQuests.rows.forEach((quest, idx) => {
      const status = quest.is_active ? '✅' : '❌';
      if (process.env.NODE_ENV === 'development') console.log(`${idx + 1}. ${status} ${quest.name}`);
      if (process.env.NODE_ENV === 'development') console.log(`   Key: ${quest.quest_key}`);
      if (process.env.NODE_ENV === 'development') console.log(`   Type: ${quest.quest_type}`);
      if (process.env.NODE_ENV === 'development') console.log(`   Reward: ${quest.reward_cs} CS`);
      if (process.env.NODE_ENV === 'development') console.log('');
    });

    if (process.env.NODE_ENV === 'development') console.log('========================================');
    if (process.env.NODE_ENV === 'development') console.log('✅ МИГРАЦИЯ ЗАВЕРШЕНА УСПЕШНО!');
    if (process.env.NODE_ENV === 'development') console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА при применении миграции:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Запуск
applyMigration().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
