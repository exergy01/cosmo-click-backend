-- =====================================================
-- ОЧЕРЕДЬ ПОСТРОЙКИ КОРАБЛЕЙ - GALACTIC EMPIRE
-- =====================================================

CREATE TABLE IF NOT EXISTS galactic_empire_build_queue (
  id SERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
  ship_type VARCHAR(50) NOT NULL, -- ID корабля из конфига
  ship_class VARCHAR(30) NOT NULL, -- frigate, destroyer, cruiser, battleship, premium, drones, torpedoes, reb, ai
  tier INTEGER NOT NULL,

  started_at TIMESTAMP DEFAULT NOW(),
  finish_at TIMESTAMP NOT NULL,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_ge_build_queue_player ON galactic_empire_build_queue(player_id);
CREATE INDEX IF NOT EXISTS idx_ge_build_queue_finish ON galactic_empire_build_queue(finish_at);

-- Можно иметь только одну активную постройку одновременно
-- (или можно несколько - решим потом)
