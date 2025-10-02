-- =====================================================
-- МИГРАЦИЯ 009: COSMIC FLEET - FORMATIONS & BATTLES
-- =====================================================
-- Дата: 02.10.2025
-- Описание: Флотилии, история боёв, улучшения, достижения

-- =====================================================
-- 1. ФЛОТИЛИИ (Fleet Formations)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_formations (
    telegram_id VARCHAR(255) PRIMARY KEY,
    slot_1_ship_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE SET NULL,
    slot_2_ship_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE SET NULL,
    slot_3_ship_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE SET NULL,
    slot_4_ship_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE SET NULL,
    slot_5_ship_id INTEGER REFERENCES cosmic_fleet_ships(id) ON DELETE SET NULL,
    max_slots INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE cosmic_fleet_formations IS 'Текущий состав флота игрока';
COMMENT ON COLUMN cosmic_fleet_formations.max_slots IS 'Максимум слотов (3-5), покупается за Luminios';

-- =====================================================
-- 2. ИСТОРИЯ БОЁВ (Battle History)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_battle_history (
    battle_id SERIAL PRIMARY KEY,
    telegram_id VARCHAR(255) NOT NULL,

    -- Тип боя
    battle_type VARCHAR(50) NOT NULL, -- 'bot', 'pvp', 'boss', 'tournament'
    opponent_telegram_id VARCHAR(255), -- NULL для ботов
    bot_difficulty VARCHAR(50),        -- 'easy', 'medium', 'hard', 'boss'

    -- Составы флотов (JSON)
    player_fleet JSONB NOT NULL,      -- [{ship_id, tier, type, hp, damage, ...}]
    opponent_fleet JSONB NOT NULL,

    -- Результат боя
    result VARCHAR(20) NOT NULL,      -- 'win', 'loss', 'draw'
    rounds_count INTEGER DEFAULT 0,

    -- Статистика
    damage_dealt INTEGER DEFAULT 0,
    damage_received INTEGER DEFAULT 0,
    ships_lost INTEGER DEFAULT 0,
    is_perfect_win BOOLEAN DEFAULT false, -- все корабли выжили

    -- Награды
    reward_luminios INTEGER DEFAULT 0,
    reward_xp INTEGER DEFAULT 0,
    stars_bet INTEGER,                -- для PvP
    stars_won INTEGER,                -- для PvP

    -- Мета
    battle_log JSONB,                 -- детальный лог боя (раунды, урон)
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_battle_history_telegram ON cosmic_fleet_battle_history(telegram_id);
CREATE INDEX idx_battle_history_type ON cosmic_fleet_battle_history(battle_type);
CREATE INDEX idx_battle_history_created ON cosmic_fleet_battle_history(created_at DESC);

COMMENT ON TABLE cosmic_fleet_battle_history IS 'История всех боёв игрока';
COMMENT ON COLUMN cosmic_fleet_battle_history.battle_log IS 'Детальная запись боя для реплея';

-- =====================================================
-- 3. СТАТИСТИКА КОРАБЛЕЙ (Ship Stats & Upgrades)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_ship_stats (
    ship_id INTEGER PRIMARY KEY REFERENCES cosmic_fleet_ships(id) ON DELETE CASCADE,

    -- XP и уровень
    experience INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,

    -- Улучшения (0-3 уровень каждого)
    upgrade_weapon INTEGER DEFAULT 0,
    upgrade_shield INTEGER DEFAULT 0,
    upgrade_engine INTEGER DEFAULT 0,

    -- Статистика
    total_battles INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    total_damage_dealt BIGINT DEFAULT 0,
    total_damage_received BIGINT DEFAULT 0,

    -- Мета
    last_battle_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE cosmic_fleet_ship_stats IS 'Статистика и улучшения каждого корабля';

-- =====================================================
-- 4. ДОСТИЖЕНИЯ (Achievements)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_achievements (
    id SERIAL PRIMARY KEY,
    telegram_id VARCHAR(255) NOT NULL,
    achievement_key VARCHAR(100) NOT NULL, -- 'first_blood', 'destroyer', etc

    -- Награда
    reward_luminios INTEGER DEFAULT 0,
    reward_title VARCHAR(100),            -- титул игрока

    unlocked_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(telegram_id, achievement_key)
);

CREATE INDEX idx_achievements_telegram ON cosmic_fleet_achievements(telegram_id);

COMMENT ON TABLE cosmic_fleet_achievements IS 'Разблокированные достижения игрока';

-- =====================================================
-- 5. ЕЖЕДНЕВНАЯ СТАТИСТИКА (Daily Stats)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_daily_stats (
    id SERIAL PRIMARY KEY,
    telegram_id VARCHAR(255) NOT NULL,
    stat_date DATE NOT NULL,

    -- Счётчики дня
    battles_count INTEGER DEFAULT 0,
    wins_count INTEGER DEFAULT 0,
    damage_dealt INTEGER DEFAULT 0,
    perfect_wins INTEGER DEFAULT 0,

    -- Награды
    luminios_earned INTEGER DEFAULT 0,
    xp_earned INTEGER DEFAULT 0,

    -- Флаги
    first_win_claimed BOOLEAN DEFAULT false,
    daily_boss_defeated BOOLEAN DEFAULT false,

    -- Мета
    win_streak INTEGER DEFAULT 0,      -- текущая серия побед
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(telegram_id, stat_date)
);

CREATE INDEX idx_daily_stats_telegram ON cosmic_fleet_daily_stats(telegram_id);
CREATE INDEX idx_daily_stats_date ON cosmic_fleet_daily_stats(stat_date DESC);

COMMENT ON TABLE cosmic_fleet_daily_stats IS 'Ежедневная статистика игрока';

-- =====================================================
-- 6. PVP РЕЙТИНГ (PvP Ranking)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_pvp_ranking (
    telegram_id VARCHAR(255) PRIMARY KEY,

    -- Рейтинг (ELO)
    rating INTEGER DEFAULT 1000,
    rank_tier VARCHAR(50) DEFAULT 'Новичок', -- Новичок, Боец, Ветеран, Элита, Легенда

    -- Статистика PvP
    pvp_battles INTEGER DEFAULT 0,
    pvp_wins INTEGER DEFAULT 0,
    pvp_losses INTEGER DEFAULT 0,

    -- Награды
    total_stars_won BIGINT DEFAULT 0,
    total_stars_lost BIGINT DEFAULT 0,

    -- Мета
    highest_rating INTEGER DEFAULT 1000,
    current_season VARCHAR(50),       -- '2025_Q4'
    last_pvp_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pvp_ranking_rating ON cosmic_fleet_pvp_ranking(rating DESC);

COMMENT ON TABLE cosmic_fleet_pvp_ranking IS 'PvP рейтинг игрока (ELO система)';

-- =====================================================
-- 7. РАСХОДНИКИ (Consumables/Boosts)
-- =====================================================

CREATE TABLE IF NOT EXISTS cosmic_fleet_consumables (
    id SERIAL PRIMARY KEY,
    telegram_id VARCHAR(255) NOT NULL,
    consumable_key VARCHAR(100) NOT NULL, -- 'damage_boost', 'shield_boost'

    quantity INTEGER DEFAULT 1,
    expires_at TIMESTAMP,              -- для временных бустов

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(telegram_id, consumable_key)
);

CREATE INDEX idx_consumables_telegram ON cosmic_fleet_consumables(telegram_id);

COMMENT ON TABLE cosmic_fleet_consumables IS 'Расходники и бустеры игрока';

-- =====================================================
-- 8. ДЕФОЛТНЫЕ ДАННЫЕ
-- =====================================================

-- Создаём флотилию для всех игроков у кого есть корабли
INSERT INTO cosmic_fleet_formations (telegram_id, max_slots)
SELECT DISTINCT s.player_id::VARCHAR, 3
FROM cosmic_fleet_ships s
WHERE NOT EXISTS (
    SELECT 1 FROM cosmic_fleet_formations f WHERE f.telegram_id = s.player_id::VARCHAR
);

-- Создаём статистику для всех существующих кораблей
INSERT INTO cosmic_fleet_ship_stats (ship_id, level)
SELECT s.id, 1
FROM cosmic_fleet_ships s
WHERE NOT EXISTS (
    SELECT 1 FROM cosmic_fleet_ship_stats st WHERE st.ship_id = s.id
);

-- Создаём PvP рейтинг для всех игроков у кого есть корабли
INSERT INTO cosmic_fleet_pvp_ranking (telegram_id, current_season)
SELECT DISTINCT s.player_id::VARCHAR, '2025_Q4'
FROM cosmic_fleet_ships s
WHERE NOT EXISTS (
    SELECT 1 FROM cosmic_fleet_pvp_ranking r WHERE r.telegram_id = s.player_id::VARCHAR
);

-- =====================================================
-- ГОТОВО!
-- =====================================================

SELECT 'Миграция 009: Cosmic Fleet Formations & Battles применена успешно!' as status;
