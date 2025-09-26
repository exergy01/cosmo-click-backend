const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  const client = await pool.connect();
  try {
    console.log('Applying migration: add_ton_reserved_field.sql');

    const migrationPath = path.join(__dirname, 'migrations', 'add_ton_reserved_field.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    await client.query(migrationSQL);
    console.log('Migration applied successfully!');

    // Проверяем, что поле добавлено
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'ton_reserved'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Field ton_reserved added:', result.rows[0]);
    } else {
      console.log('❌ Field ton_reserved not found');
    }

  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

applyMigration().catch(console.error);