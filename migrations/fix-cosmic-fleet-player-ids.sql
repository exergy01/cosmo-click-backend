-- Migration: Fix player_id in cosmic_fleet_ships to use telegram_id instead of internal id
-- Date: 2025-10-03
-- Description: Updates existing ships to reference telegram_id instead of internal player id

-- Update all ships to use telegram_id from cosmic_fleet_players
UPDATE cosmic_fleet_ships s
SET player_id = p.telegram_id::text
FROM cosmic_fleet_players p
WHERE s.player_id::integer = p.id;

-- Verify the update
SELECT
  s.id as ship_id,
  s.player_id as new_player_id,
  s.ship_name,
  p.telegram_id as expected_telegram_id
FROM cosmic_fleet_ships s
LEFT JOIN cosmic_fleet_players p ON s.player_id = p.telegram_id::text
ORDER BY s.id;
