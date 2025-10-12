/**
 * 🔧 MIGRATION: Create ship_modules table
 * Таблица для хранения установленных модулей на кораблях
 */

const pool = require('../db');

async function createShipModulesTable() {
  console.log('🔧 === CREATING SHIP MODULES TABLE ===');
  console.log('⏰ Time:', new Date().toISOString());

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ========================================
    // 1. Создаем таблицу ship_modules
    // ========================================
    console.log('📝 Creating ship_modules table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ship_modules (
        id SERIAL PRIMARY KEY,
        ship_id INTEGER NOT NULL REFERENCES galactic_empire_ships(id) ON DELETE CASCADE,
        module_id VARCHAR(100) NOT NULL,
        slot_type VARCHAR(20) NOT NULL CHECK (slot_type IN ('high_slot', 'mid_slot', 'low_slot', 'rig_slot')),
        slot_index INTEGER NOT NULL CHECK (slot_index >= 0),
        tier VARCHAR(10) NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
        is_active BOOLEAN DEFAULT true,
        installed_at TIMESTAMP DEFAULT NOW(),

        -- Уникальность: один слот - один модуль
        UNIQUE(ship_id, slot_type, slot_index),

        -- Индексы для быстрого поиска
        CONSTRAINT ship_modules_ship_id_fkey FOREIGN KEY (ship_id)
          REFERENCES galactic_empire_ships(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ ship_modules table created');

    // ========================================
    // 2. Создаем таблицу module_inventory (инвентарь модулей игрока)
    // ========================================
    console.log('📝 Creating module_inventory table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS module_inventory (
        id SERIAL PRIMARY KEY,
        player_id VARCHAR(100) NOT NULL,
        module_id VARCHAR(100) NOT NULL,
        tier VARCHAR(10) NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
        quantity INTEGER DEFAULT 1 CHECK (quantity >= 0),
        obtained_at TIMESTAMP DEFAULT NOW(),
        obtained_from VARCHAR(50), -- 'battle_drop', 'shop_purchase', 'craft', 'upgrade'

        -- Уникальность: игрок + модуль + тир
        UNIQUE(player_id, module_id, tier),

        -- Внешний ключ на игрока
        FOREIGN KEY (player_id) REFERENCES players(telegram_id) ON DELETE CASCADE
      )
    `);

    console.log('✅ module_inventory table created');

    // ========================================
    // 3. Создаем таблицу module_upgrades (история апгрейдов)
    // ========================================
    console.log('📝 Creating module_upgrades table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS module_upgrades (
        id SERIAL PRIMARY KEY,
        player_id VARCHAR(100) NOT NULL,
        module_id VARCHAR(100) NOT NULL,
        from_tier VARCHAR(10) NOT NULL,
        to_tier VARCHAR(10) NOT NULL,
        cost_luminios INTEGER NOT NULL,
        cost_materials INTEGER NOT NULL,
        upgraded_at TIMESTAMP DEFAULT NOW(),

        -- Внешний ключ на игрока
        FOREIGN KEY (player_id) REFERENCES players(telegram_id) ON DELETE CASCADE
      )
    `);

    console.log('✅ module_upgrades table created');

    // ========================================
    // 4. Добавляем индексы для производительности
    // ========================================
    console.log('📝 Creating indexes...');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ship_modules_ship_id
        ON ship_modules(ship_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ship_modules_module_id
        ON ship_modules(module_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_module_inventory_player_id
        ON module_inventory(player_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_module_upgrades_player_id
        ON module_upgrades(player_id);
    `);

    console.log('✅ Indexes created');

    // ========================================
    // 5. Добавляем колонку materials к игрокам (если нет)
    // ========================================
    console.log('📝 Adding materials column to players...');

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'players'
          AND column_name = 'materials'
        ) THEN
          ALTER TABLE players
          ADD COLUMN materials INTEGER DEFAULT 0 CHECK (materials >= 0);
        END IF;
      END $$;
    `);

    console.log('✅ materials column checked/added');

    await client.query('COMMIT');

    console.log('\\n🏁 Ship modules tables migration completed successfully');

    // ========================================
    // 6. Показываем структуру таблиц
    // ========================================
    const tableInfo = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name IN ('ship_modules', 'module_inventory', 'module_upgrades')
      ORDER BY table_name, ordinal_position
    `);

    console.log('\\n📊 Tables structure:');
    console.table(tableInfo.rows);

    return { success: true };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Запуск миграции
if (require.main === module) {
  createShipModulesTable()
    .then(() => {
      console.log('\\n✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\\n❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = createShipModulesTable;
