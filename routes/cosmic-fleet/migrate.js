/**
 * Migration endpoint for fixing player_id in cosmic_fleet_ships
 * ONE-TIME USE ONLY
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');

// Admin IDs who can run migrations
const ADMIN_IDS = ['1222791281', '850758749'];

// POST /api/cosmic-fleet/migrate/fix-player-ids
router.post('/fix-player-ids', async (req, res) => {
  try {
    const { adminId } = req.body;

    // Check admin access
    if (!adminId || !ADMIN_IDS.includes(adminId.toString())) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('🔧 Starting migration: fix player_id in cosmic_fleet_ships');

    // Begin transaction
    await pool.query('BEGIN');

    try {
      // Get current state before migration
      const beforeQuery = await pool.query(`
        SELECT
          s.id as ship_id,
          s.player_id as old_player_id,
          s.ship_name,
          p.telegram_id,
          p.id as player_internal_id
        FROM cosmic_fleet_ships s
        LEFT JOIN cosmic_fleet_players p ON s.player_id::integer = p.id
        ORDER BY s.id
      `);

      console.log('📊 Ships before migration:', beforeQuery.rows);

      // Step 1: Update ships to use telegram_id (while player_id is still integer)
      const updateResult = await pool.query(`
        UPDATE cosmic_fleet_ships s
        SET player_id = p.id
        FROM cosmic_fleet_players p
        WHERE s.player_id = p.id
      `);

      console.log('✅ Step 1: Ensured player_id references are correct');

      // Step 2: Create mapping table temporarily
      await pool.query(`
        CREATE TEMPORARY TABLE temp_player_mapping AS
        SELECT id, telegram_id::text as telegram_id_text
        FROM cosmic_fleet_players
      `);

      // Step 3: Update to telegram_id values (still as integers for now)
      await pool.query(`
        UPDATE cosmic_fleet_ships s
        SET player_id = p.telegram_id::bigint
        FROM cosmic_fleet_players p
        WHERE s.player_id = p.id
      `);

      console.log('✅ Step 2: Updated player_id to telegram_id values');

      // Step 4: Change column type to text
      await pool.query(`
        ALTER TABLE cosmic_fleet_ships
        ALTER COLUMN player_id TYPE text USING player_id::text
      `);

      console.log('✅ Step 3: Changed column type to TEXT');

      console.log('✅ Updated ships:', updateResult.rows);

      // Verify the migration
      const afterQuery = await pool.query(`
        SELECT
          s.id as ship_id,
          s.player_id as new_player_id,
          s.ship_name,
          p.telegram_id,
          CASE
            WHEN s.player_id = p.telegram_id::text THEN 'CORRECT'
            ELSE 'MISMATCH'
          END as status
        FROM cosmic_fleet_ships s
        LEFT JOIN cosmic_fleet_players p ON s.player_id = p.telegram_id::text
        ORDER BY s.id
      `);

      console.log('🔍 Ships after migration:', afterQuery.rows);

      // Check if all ships are correctly migrated
      const mismatches = afterQuery.rows.filter(row => row.status !== 'CORRECT');

      if (mismatches.length > 0) {
        await pool.query('ROLLBACK');
        return res.status(500).json({
          success: false,
          error: 'Migration validation failed',
          mismatches
        });
      }

      await pool.query('COMMIT');

      res.json({
        success: true,
        message: 'Migration completed successfully',
        before: beforeQuery.rows,
        updated: updateResult.rows,
        after: afterQuery.rows,
        stats: {
          total_ships: afterQuery.rows.length,
          updated_ships: updateResult.rowCount
        }
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Migration error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

module.exports = router;
