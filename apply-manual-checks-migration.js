const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  const client = await pool.connect();
  try {
    if (process.env.NODE_ENV === 'development') console.log('Applying migration: 010_manual_quest_submissions.sql');

    const migrationPath = path.join(__dirname, 'migrations', '010_manual_quest_submissions.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    await client.query(migrationSQL);
    if (process.env.NODE_ENV === 'development') console.log('✅ Migration applied successfully!');

    // Проверяем, что таблица создана
    const result = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'manual_quest_submissions'
      ORDER BY ordinal_position
    `);

    if (result.rows.length > 0) {
      if (process.env.NODE_ENV === 'development') console.log('✅ Table manual_quest_submissions created with columns:');
      result.rows.forEach(row => {
        if (process.env.NODE_ENV === 'development') console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
    } else {
      if (process.env.NODE_ENV === 'development') console.log('❌ Table manual_quest_submissions not found');
    }

  } catch (err) {
    console.error('❌ Migration error:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

applyMigration().catch(console.error);
