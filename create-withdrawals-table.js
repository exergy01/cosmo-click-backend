/**
 * 🔧 MIGRATION: Create withdrawals table with wallet_address
 * Fixes BLOCKER #2 from audit report
 */

const pool = require('./db');

async function createWithdrawalsTable() {
  console.log('🔧 === CREATING WITHDRAWALS TABLE ===');
  console.log('⏰ Time:', new Date().toISOString());

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'withdrawals'
      );
    `);

    const tableExists = tableCheck.rows[0].exists;

    if (tableExists) {
      console.log('✅ withdrawals table already exists');

      // Check if wallet_address column exists
      const columnCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'withdrawals'
        AND column_name = 'wallet_address';
      `);

      if (columnCheck.rows.length === 0) {
        console.log('📝 Adding wallet_address column...');
        await client.query(`
          ALTER TABLE withdrawals
          ADD COLUMN IF NOT EXISTS wallet_address TEXT;
        `);
        console.log('✅ wallet_address column added');
      } else {
        console.log('✅ wallet_address column already exists');
      }

    } else {
      console.log('📝 Creating withdrawals table...');

      await client.query(`
        CREATE TABLE withdrawals (
          id SERIAL PRIMARY KEY,
          player_id TEXT NOT NULL,
          amount NUMERIC(20, 9) NOT NULL CHECK (amount > 0),
          wallet_address TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
          transaction_hash TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMP,
          admin_notes TEXT,
          error_message TEXT,
          CONSTRAINT fk_player FOREIGN KEY (player_id) REFERENCES players(telegram_id) ON DELETE CASCADE
        );
      `);

      console.log('✅ withdrawals table created');

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_withdrawals_player_id ON withdrawals(player_id);
        CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
        CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at);
      `);

      console.log('✅ Indexes created');
    }

    // Check if ton_reserved column exists in players table
    console.log('📝 Checking ton_reserved column in players table...');
    const reservedCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'players'
      AND column_name = 'ton_reserved';
    `);

    if (reservedCheck.rows.length === 0) {
      console.log('📝 Adding ton_reserved column to players table...');
      await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS ton_reserved NUMERIC(20, 9) DEFAULT 0 CHECK (ton_reserved >= 0);
      `);
      console.log('✅ ton_reserved column added');
    } else {
      console.log('✅ ton_reserved column already exists');
    }

    await client.query('COMMIT');

    console.log('🏁 Migration completed successfully');

    // Show table structure
    const structure = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'withdrawals'
      ORDER BY ordinal_position;
    `);

    console.log('\n📊 withdrawals table structure:');
    console.table(structure.rows);

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

// Run migration
createWithdrawalsTable()
  .then(() => {
    console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });
