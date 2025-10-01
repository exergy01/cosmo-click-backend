const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function applyCosmicFleetMigration() {
  const client = await pool.connect();
  try {
    console.log('🚀 === ПРИМЕНЕНИЕ МИГРАЦИИ COSMIC FLEET ===');
    console.log('⏰ Время:', new Date().toISOString());

    const migrationPath = path.join(__dirname, 'migrations', '006_cosmic_fleet.sql');

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Файл миграции не найден: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log('📄 Файл миграции прочитан успешно');

    console.log('🔄 Выполняем миграцию...');
    await client.query(migrationSQL);
    console.log('✅ Миграция выполнена успешно!');

    // Проверяем созданные таблицы
    console.log('🔍 Проверяем созданные таблицы...');

    const tableChecks = [
      'cosmic_fleet_players',
      'cosmic_fleet_ships',
      'luminios_transactions',
      'cosmic_fleet_battles'
    ];

    for (const tableName of tableChecks) {
      const result = await client.query(`
        SELECT table_name, table_schema
        FROM information_schema.tables
        WHERE table_name = $1 AND table_schema = 'public'
      `, [tableName]);

      if (result.rows.length > 0) {
        console.log(`✅ Таблица ${tableName} создана`);

        // Получаем структуру таблицы
        const columns = await client.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position
        `, [tableName]);

        console.log(`   📋 Столбцы (${columns.rows.length}):`,
          columns.rows.map(c => `${c.column_name}(${c.data_type})`).join(', ')
        );
      } else {
        console.log(`❌ Таблица ${tableName} НЕ найдена`);
      }
    }

    // Проверяем индексы
    console.log('🔍 Проверяем созданные индексы...');
    const indexResult = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE tablename LIKE 'cosmic_fleet_%' OR tablename = 'luminios_transactions'
      ORDER BY tablename, indexname
    `);

    console.log(`✅ Создано индексов: ${indexResult.rows.length}`);
    indexResult.rows.forEach(idx => {
      console.log(`   📊 ${idx.tablename}.${idx.indexname}`);
    });

    console.log('🏁 === МИГРАЦИЯ COSMIC FLEET ЗАВЕРШЕНА ===');
    return {
      success: true,
      tablesCreated: tableChecks.length,
      indexesCreated: indexResult.rows.length
    };

  } catch (err) {
    console.error('❌ ОШИБКА миграции Cosmic Fleet:', err);
    console.error('❌ Stack trace:', err.stack);
    throw err;
  } finally {
    client.release();
  }
}

// Запускаем миграцию только если вызван напрямую
if (require.main === module) {
  applyCosmicFleetMigration()
    .then((result) => {
      console.log('🎉 Миграция успешна:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Миграция провалена:', error.message);
      process.exit(1);
    });
}

module.exports = { applyCosmicFleetMigration };