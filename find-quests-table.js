const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function findQuestsTable() {
  try {
    console.log('🔍 Ищем таблицы связанные с квестами...\n');

    // Все таблицы со словом quest
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%quest%'
      ORDER BY table_name
    `);

    console.log('📋 Таблицы с "quest":');
    tables.rows.forEach(t => console.log(`  - ${t.table_name}`));

    console.log('\n🔍 Проверяем структуру каждой таблицы:\n');

    for (const table of tables.rows) {
      console.log(`\n📊 Таблица: ${table.table_name}`);

      const columns = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
        LIMIT 10
      `, [table.table_name]);

      columns.rows.forEach(c => {
        console.log(`    ${c.column_name}: ${c.data_type}`);
      });

      // Показываем пример данных
      const sample = await pool.query(`SELECT * FROM ${table.table_name} LIMIT 2`);
      if (sample.rows.length > 0) {
        console.log(`  Записей: ${sample.rowCount}`);
      }
    }

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

findQuestsTable();
