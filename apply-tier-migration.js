/**
 * 🚀 ПРИМЕНИТЬ МИГРАЦИЮ TIER SYSTEM
 */

const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📂 Reading migration file...');
    const migrationPath = path.join(__dirname, '..', 'temp', 'migrations', 'galactic-empire-tier-system.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    if (process.env.NODE_ENV === 'development') console.log('🚀 Applying migration...');
    await pool.query(sql);

    if (process.env.NODE_ENV === 'development') console.log('✅ Migration applied successfully!');

    // Проверяем результат
    const result = await pool.query(`
      SELECT COUNT(*) as count, tier
      FROM galactic_empire_ships
      GROUP BY tier
      ORDER BY tier
    `);

    if (process.env.NODE_ENV === 'development') console.log('\n📊 Ships by tier:');
    result.rows.forEach(row => {
      if (process.env.NODE_ENV === 'development') console.log(`  Tier ${row.tier}: ${row.count} ships`);
    });

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

applyMigration();
