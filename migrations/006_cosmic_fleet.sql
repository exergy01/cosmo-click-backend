-- 🚀 COSMIC FLEET COMMANDER - Миграция БД
-- Создание таблиц для космической мини-игры

-- Таблица игроков cosmic fleet
CREATE TABLE IF NOT EXISTS cosmic_fleet_players (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    luminios_balance INTEGER DEFAULT 0,
    total_battles INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    rank_points INTEGER DEFAULT 1000,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Таблица кораблей игроков
CREATE TABLE IF NOT EXISTS cosmic_fleet_ships (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES cosmic_fleet_players(id) ON DELETE CASCADE,
    ship_template_id VARCHAR(50) NOT NULL,
    ship_name VARCHAR(100) NOT NULL,
    health INTEGER NOT NULL,
    max_health INTEGER NOT NULL,
    damage INTEGER NOT NULL,
    speed INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    experience INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица обменов валют Luminios
CREATE TABLE IF NOT EXISTS luminios_transactions (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    transaction_type VARCHAR(20) NOT NULL, -- 'exchange', 'purchase', 'reward'
    ccc_amount INTEGER, -- Может быть NULL для наград
    luminios_amount INTEGER NOT NULL,
    exchange_rate DECIMAL(10,2), -- Может быть NULL для наград
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица боев
CREATE TABLE IF NOT EXISTS cosmic_fleet_battles (
    id SERIAL PRIMARY KEY,
    player1_id INTEGER REFERENCES cosmic_fleet_players(id) ON DELETE CASCADE,
    player2_id INTEGER REFERENCES cosmic_fleet_players(id) ON DELETE CASCADE, -- NULL для PvE
    ship1_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE CASCADE,
    ship2_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE CASCADE, -- NULL для PvE
    battle_type VARCHAR(10) NOT NULL, -- 'PvE' или 'PvP'
    winner_id INTEGER, -- NULL если ничья
    battle_log JSONB,
    luminios_reward INTEGER DEFAULT 0,
    experience_gained INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_cosmic_fleet_players_telegram_id ON cosmic_fleet_players(telegram_id);
CREATE INDEX IF NOT EXISTS idx_cosmic_fleet_ships_player_id ON cosmic_fleet_ships(player_id);
CREATE INDEX IF NOT EXISTS idx_luminios_transactions_telegram_id ON luminios_transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_cosmic_fleet_battles_player1 ON cosmic_fleet_battles(player1_id);
CREATE INDEX IF NOT EXISTS idx_cosmic_fleet_battles_created_at ON cosmic_fleet_battles(created_at);

-- Функция обновления updated_at
CREATE OR REPLACE FUNCTION update_cosmic_fleet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
CREATE TRIGGER update_cosmic_fleet_players_updated_at
    BEFORE UPDATE ON cosmic_fleet_players
    FOR EACH ROW
    EXECUTE FUNCTION update_cosmic_fleet_updated_at();

-- Комментарии к таблицам
COMMENT ON TABLE cosmic_fleet_players IS 'Игроки космического флота';
COMMENT ON TABLE cosmic_fleet_ships IS 'Корабли игроков';
COMMENT ON TABLE luminios_transactions IS 'Транзакции валюты Luminios';
COMMENT ON TABLE cosmic_fleet_battles IS 'История боев';

-- Начальные данные (опционально)
-- Можно добавить тестовых игроков для отладки

COMMIT;