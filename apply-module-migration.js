/**
 * 🔧 ПРИМЕНИТЬ МИГРАЦИЮ MODULE SYSTEM
 */

const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📂 Reading migration file...');
    const migrationPath = path.join(__dirname, '..', 'temp', 'migrations', 'galactic-empire-module-system.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    if (process.env.NODE_ENV === 'development') console.log('🔧 Applying module system migration...');
    await pool.query(sql);

    if (process.env.NODE_ENV === 'development') console.log('✅ Migration applied successfully!');

    // Проверяем результат
    const moduleResult = await pool.query(`
      SELECT player_id, module_type, module_tier, quantity
      FROM galactic_empire_modules
      ORDER BY player_id, module_type, module_tier
      LIMIT 20
    `);

    if (process.env.NODE_ENV === 'development') console.log('\n📊 Sample modules in inventory:');
    moduleResult.rows.forEach(row => {
      if (process.env.NODE_ENV === 'development') console.log(`  ${row.player_id}: ${row.module_type} T${row.module_tier} x${row.quantity}`);
    });

    const totalModules = await pool.query(`
      SELECT COUNT(*) as count, module_type, module_tier
      FROM galactic_empire_modules
      GROUP BY module_type, module_tier
      ORDER BY module_type, module_tier
    `);

    if (process.env.NODE_ENV === 'development') console.log('\n📦 Total modules by type:');
    totalModules.rows.forEach(row => {
      if (process.env.NODE_ENV === 'development') console.log(`  ${row.module_type} T${row.module_tier}: ${row.count} stacks`);
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
