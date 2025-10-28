/**
 * 🔧 MIGRATION: Add database constraints for data integrity
 * Fixes HIGH SEVERITY issue from audit report
 */

const pool = require('./db');

async function addDatabaseConstraints() {
  if (process.env.NODE_ENV === 'development') console.log('🔧 === ADDING DATABASE CONSTRAINTS ===');
  if (process.env.NODE_ENV === 'development') console.log('⏰ Time:', new Date().toISOString());

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (process.env.NODE_ENV === 'development') console.log('📝 Adding constraints to players table...');

    // Add CHECK constraints for balance columns
    const constraints = [
      {
        table: 'players',
        constraint: 'players_ccc_positive',
        check: 'ccc >= 0',
        description: 'CCC balance must be non-negative'
      },
      {
        table: 'players',
        constraint: 'players_cs_positive',
        check: 'cs >= 0',
        description: 'CS balance must be non-negative'
      },
      {
        table: 'players',
        constraint: 'players_ton_positive',
        check: 'ton >= 0',
        description: 'TON balance must be non-negative'
      },
      {
        table: 'players',
        constraint: 'players_ton_reserved_positive',
        check: 'ton_reserved >= 0',
        description: 'TON reserved must be non-negative'
      },
      {
        table: 'players',
        constraint: 'players_ton_reserved_not_exceed_balance',
        check: 'ton_reserved <= ton',
        description: 'Reserved TON cannot exceed total TON balance'
      }
    ];

    for (const constraint of constraints) {
      try {
        // Check if constraint already exists
        const existsQuery = `
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_name = $1
          AND constraint_name = $2
          AND constraint_type = 'CHECK'
        `;

        const exists = await client.query(existsQuery, [constraint.table, constraint.constraint]);

        if (exists.rows.length === 0) {
          if (process.env.NODE_ENV === 'development') console.log(`  Adding constraint: ${constraint.constraint}`);
          await client.query(`
            ALTER TABLE ${constraint.table}
            ADD CONSTRAINT ${constraint.constraint}
            CHECK (${constraint.check})
          `);
          if (process.env.NODE_ENV === 'development') console.log(`  ✅ ${constraint.description}`);
        } else {
          if (process.env.NODE_ENV === 'development') console.log(`  ℹ️  Constraint ${constraint.constraint} already exists`);
        }
      } catch (error) {
        console.error(`  ⚠️  Error adding constraint ${constraint.constraint}:`, error.message);
        // Continue with other constraints
      }
    }

    // Add UNIQUE constraint for telegram_id if not exists
    if (process.env.NODE_ENV === 'development') console.log('\n📝 Checking UNIQUE constraint on telegram_id...');
    try {
      const uniqueExists = await client.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'players'
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%telegram_id%'
      `);

      if (uniqueExists.rows.length === 0) {
        if (process.env.NODE_ENV === 'development') console.log('  Adding UNIQUE constraint on telegram_id...');
        await client.query(`
          ALTER TABLE players
          ADD CONSTRAINT players_telegram_id_unique
          UNIQUE (telegram_id)
        `);
        if (process.env.NODE_ENV === 'development') console.log('  ✅ telegram_id is now UNIQUE');
      } else {
        if (process.env.NODE_ENV === 'development') console.log('  ℹ️  UNIQUE constraint on telegram_id already exists');
      }
    } catch (error) {
      console.error('  ⚠️  Error adding UNIQUE constraint:', error.message);
    }

    // Add constraints to withdrawals table
    if (process.env.NODE_ENV === 'development') console.log('\n📝 Adding constraints to withdrawals table...');

    const withdrawalConstraints = [
      {
        table: 'withdrawals',
        constraint: 'withdrawals_amount_positive',
        check: 'amount > 0',
        description: 'Withdrawal amount must be positive'
      },
      {
        table: 'withdrawals',
        constraint: 'withdrawals_valid_status',
        check: "status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')",
        description: 'Withdrawal status must be valid'
      }
    ];

    for (const constraint of withdrawalConstraints) {
      try {
        const existsQuery = `
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_name = $1
          AND constraint_name = $2
          AND constraint_type = 'CHECK'
        `;

        const exists = await client.query(existsQuery, [constraint.table, constraint.constraint]);

        if (exists.rows.length === 0) {
          if (process.env.NODE_ENV === 'development') console.log(`  Adding constraint: ${constraint.constraint}`);
          await client.query(`
            ALTER TABLE ${constraint.table}
            ADD CONSTRAINT ${constraint.constraint}
            CHECK (${constraint.check})
          `);
          if (process.env.NODE_ENV === 'development') console.log(`  ✅ ${constraint.description}`);
        } else {
          if (process.env.NODE_ENV === 'development') console.log(`  ℹ️  Constraint ${constraint.constraint} already exists`);
        }
      } catch (error) {
        console.error(`  ⚠️  Error adding constraint ${constraint.constraint}:`, error.message);
      }
    }

    await client.query('COMMIT');

    if (process.env.NODE_ENV === 'development') console.log('\n🏁 Database constraints migration completed successfully');

    // Show current constraints
    const allConstraints = await client.query(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        cc.check_clause
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
      WHERE tc.table_name IN ('players', 'withdrawals')
        AND tc.constraint_type IN ('CHECK', 'UNIQUE')
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
    `);

    if (process.env.NODE_ENV === 'development') console.log('\n📊 Current constraints:');
    console.table(allConstraints.rows);

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
addDatabaseConstraints()
  .then(() => {
    if (process.env.NODE_ENV === 'development') console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });
