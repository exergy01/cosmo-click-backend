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
    console.log('\n========================================');
    console.log('🚀 ПРИМЕНЕНИЕ МИГРАЦИИ 008: КВЕСТЫ');
    console.log('========================================\n');

    // Читаем SQL файл
    const migrationPath = path.join(__dirname, 'migrations', '008_migrate_old_quests.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Файл миграции:', migrationPath);
    console.log('📊 Размер:', migrationSQL.length, 'байт\n');

    // Проверяем текущее состояние
    console.log('📊 Текущее состояние базы данных:\n');

    const oldQuests = await client.query('SELECT COUNT(*) as count FROM quests WHERE is_active = true');
    console.log('   Старых квестов (quests):', oldQuests.rows[0].count);

    const newQuests = await client.query('SELECT COUNT(*) as count FROM quest_templates');
    console.log('   Новых квестов (quest_templates):', newQuests.rows[0].count);

    const playerQuests = await client.query('SELECT COUNT(*) as count FROM player_quests WHERE quest_key IS NULL');
    console.log('   Player quests без quest_key:', playerQuests.rows[0].count);

    console.log('\n⏳ Применяю миграцию...\n');

    // Применяем миграцию
    await client.query(migrationSQL);

    console.log('\n✅ Миграция применена успешно!\n');

    // Проверяем результат
    console.log('========================================');
    console.log('📊 РЕЗУЛЬТАТЫ МИГРАЦИИ');
    console.log('========================================\n');

    const newQuestsAfter = await client.query('SELECT COUNT(*) as count FROM quest_templates');
    console.log('   Всего quest_templates:', newQuestsAfter.rows[0].count);

    const migratedQuests = await client.query("SELECT COUNT(*) as count FROM quest_templates WHERE created_by = 'migration_008'");
    console.log('   Добавлено миграцией:', migratedQuests.rows[0].count);

    const ruTranslations = await client.query("SELECT COUNT(*) as count FROM quest_translations WHERE language_code = 'ru'");
    console.log('   Русских переводов:', ruTranslations.rows[0].count);

    const enTranslations = await client.query("SELECT COUNT(*) as count FROM quest_translations WHERE language_code = 'en'");
    console.log('   Английских переводов:', enTranslations.rows[0].count);

    const updatedPlayerQuests = await client.query('SELECT COUNT(*) as count FROM player_quests WHERE quest_key IS NOT NULL');
    console.log('   Player quests с quest_key:', updatedPlayerQuests.rows[0].count);

    const stillNoKey = await client.query('SELECT COUNT(*) as count FROM player_quests WHERE quest_key IS NULL');
    console.log('   Player quests без quest_key:', stillNoKey.rows[0].count);

    // Показываем список всех квестов
    console.log('\n========================================');
    console.log('📋 ВСЕ КВЕСТЫ В НОВОЙ СИСТЕМЕ:');
    console.log('========================================\n');

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
      console.log(`${idx + 1}. ${status} ${quest.name}`);
      console.log(`   Key: ${quest.quest_key}`);
      console.log(`   Type: ${quest.quest_type}`);
      console.log(`   Reward: ${quest.reward_cs} CS`);
      console.log('');
    });

    console.log('========================================');
    console.log('✅ МИГРАЦИЯ ЗАВЕРШЕНА УСПЕШНО!');
    console.log('========================================\n');

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
