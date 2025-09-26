-- Migration: Add ton_reserved field to players table
-- Purpose: Track reserved TON balance during withdrawal process
-- Date: 2025-09-26

BEGIN;

-- Add ton_reserved column to players table
ALTER TABLE players
ADD COLUMN ton_reserved NUMERIC DEFAULT 0 NOT NULL;

-- Add index for performance on ton_reserved queries
CREATE INDEX idx_players_ton_reserved ON players(ton_reserved) WHERE ton_reserved > 0;

-- Update existing players to have 0 reserved balance
UPDATE players SET ton_reserved = 0 WHERE ton_reserved IS NULL;

COMMIT;