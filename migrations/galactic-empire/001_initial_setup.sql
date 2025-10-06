-- =====================================================
-- GALACTIC EMPIRE v2.0 - НАЧАЛЬНАЯ НАСТРОЙКА БД
-- =====================================================
-- Дата: 03.10.2025
-- Описание: Создание всех таблиц для Galactic Empire

-- =====================================================
-- 1. ТАБЛИЦА ИГРОКОВ
-- =====================================================
CREATE TABLE IF NOT EXISTS galactic_empire_players (
  telegram_id BIGINT PRIMARY KEY,

  -- Раса и прогресс
  race VARCHAR(50) NOT NULL,                          -- amarr, caldari, gallente, minmatar, human, zerg
  dual_race_unlocked BOOLEAN DEFAULT FALSE,           -- Разблокирована ли вторая раса
  secondary_race VARCHAR(50),                         -- Вторая раса (если разблокирована)

  -- Валюты (общие для всех рас)
  luminios_balance BIGINT DEFAULT 1000,               -- Внутренняя валюта

  -- Статистика
  total_battles INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  pvp_rating INTEGER DEFAULT 1000,                    -- ELO рейтинг

  -- Для Zerg расы - отслеживание логинов
  last_login TIMESTAMP DEFAULT NOW(),
  login_streak INTEGER DEFAULT 0,                     -- Сколько дней подряд заходил

  -- Метаданные
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 2. ТАБЛИЦА КОРАБЛЕЙ
-- =====================================================
CREATE TABLE IF NOT EXISTS galactic_empire_ships (
  id SERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES galactic_empire_players(telegram_id) ON DELETE CASCADE,

  -- Характеристики корабля
  ship_type VARCHAR(100) NOT NULL,                    -- frigate_t1, destroyer_t2 и т.д.
  ship_class VARCHAR(50) NOT NULL,                    -- frigate, destroyer, cruiser, battleship, premium, drones, torpedoes, reb, ai
  tier INTEGER DEFAULT 1,                              -- Уровень корабля
  race VARCHAR(50) NOT NULL,                           -- Раса корабля

  -- Боевые характеристики
  max_hp INTEGER NOT NULL,
  current_hp INTEGER NOT NULL,
  attack INTEGER NOT NULL,
  defense INTEGER NOT NULL,
  speed INTEGER NOT NULL,

  -- Слоты оружия (3 слота, могут быть разных типов)
  weapon_slot_1 VARCHAR(50),                           -- laser, missiles, drones, artillery, biological, ballistic
  weapon_slot_2 VARCHAR(50),
  weapon_slot_3 VARCHAR(50),

  -- Редкость оружия в слотах
  weapon_slot_1_rarity VARCHAR(20),                    -- common, rare, epic, legendary
  weapon_slot_2_rarity VARCHAR(20),
  weapon_slot_3_rarity VARCHAR(20),

  -- Постройка корабля
  built_at TIMESTAMP DEFAULT NOW(),                    -- Когда будет построен

  -- Метаданные
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_ships_player ON galactic_empire_ships(player_id);
CREATE INDEX IF NOT EXISTS idx_ships_built_at ON galactic_empire_ships(built_at);

-- =====================================================
-- 3. ТАБЛИЦА ФОРМАЦИЙ
-- =====================================================
CREATE TABLE IF NOT EXISTS galactic_empire_formations (
  id SERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES galactic_empire_players(telegram_id) ON DELETE CASCADE,
  race VARCHAR(50) NOT NULL,                           -- Для какой расы формация (если dual race)

  -- Слоты формации (до 5 кораблей)
  slot_1 INTEGER REFERENCES galactic_empire_ships(id) ON DELETE SET NULL,
  slot_2 INTEGER REFERENCES galactic_empire_ships(id) ON DELETE SET NULL,
  slot_3 INTEGER REFERENCES galactic_empire_ships(id) ON DELETE SET NULL,
  slot_4 INTEGER REFERENCES galactic_empire_ships(id) ON DELETE SET NULL,  -- Платный слот
  slot_5 INTEGER REFERENCES galactic_empire_ships(id) ON DELETE SET NULL,  -- Платный слот

  -- Разблокированные слоты
  slot_4_unlocked BOOLEAN DEFAULT FALSE,
  slot_5_unlocked BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(player_id, race)                              -- Одна формация на расу
);

-- =====================================================
-- 4. ТАБЛИЦА БОЁВ (ИСТОРИЯ)
-- =====================================================
CREATE TABLE IF NOT EXISTS galactic_empire_battles (
  id SERIAL PRIMARY KEY,

  -- Участники
  player1_id BIGINT NOT NULL REFERENCES galactic_empire_players(telegram_id),
  player2_id BIGINT,                                   -- NULL если PvE
  is_pve BOOLEAN DEFAULT FALSE,

  -- Настройки боя
  battle_mode VARCHAR(20) NOT NULL,                    -- auto, manual
  battle_type VARCHAR(20) NOT NULL,                    -- practice, ranked, pve

  -- Результаты
  winner_id BIGINT,                                    -- telegram_id победителя
  total_rounds INTEGER,
  battle_log JSONB,                                    -- Полный лог боя для replay

  -- Ставки (если PvP ranked)
  stake_amount BIGINT,
  stake_currency VARCHAR(20),                          -- luminios, stars, ton

  -- Награды
  reward_amount BIGINT,
  reward_currency VARCHAR(20),

  -- Метаданные
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  duration_seconds INTEGER
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_battles_player1 ON galactic_empire_battles(player1_id);
CREATE INDEX IF NOT EXISTS idx_battles_player2 ON galactic_empire_battles(player2_id);
CREATE INDEX IF NOT EXISTS idx_battles_started ON galactic_empire_battles(started_at DESC);

-- =====================================================
-- 5. ТАБЛИЦА ЛУТА (ВЫПАВШЕЕ ОРУЖИЕ)
-- =====================================================
CREATE TABLE IF NOT EXISTS galactic_empire_loot (
  id SERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES galactic_empire_players(telegram_id) ON DELETE CASCADE,
  battle_id INTEGER REFERENCES galactic_empire_battles(id),

  -- Оружие
  weapon_type VARCHAR(50) NOT NULL,
  weapon_rarity VARCHAR(20) NOT NULL,

  -- Использовано или нет
  equipped_on_ship INTEGER REFERENCES galactic_empire_ships(id) ON DELETE SET NULL,
  is_used BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_loot_player ON galactic_empire_loot(player_id);
CREATE INDEX IF NOT EXISTS idx_loot_unused ON galactic_empire_loot(player_id, is_used) WHERE is_used = FALSE;

-- =====================================================
-- 6. ТАБЛИЦА ЕЖЕДНЕВНЫХ ЛОГИНОВ (для Zerg)
-- =====================================================
CREATE TABLE IF NOT EXISTS galactic_empire_daily_logins (
  id SERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES galactic_empire_players(telegram_id) ON DELETE CASCADE,
  login_date DATE NOT NULL,

  UNIQUE(player_id, login_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_logins ON galactic_empire_daily_logins(player_id, login_date DESC);

-- =====================================================
-- КОММЕНТАРИИ К ТАБЛИЦАМ
-- =====================================================
COMMENT ON TABLE galactic_empire_players IS 'Игроки Galactic Empire';
COMMENT ON TABLE galactic_empire_ships IS 'Корабли игроков';
COMMENT ON TABLE galactic_empire_formations IS 'Формации флотов';
COMMENT ON TABLE galactic_empire_battles IS 'История всех боёв';
COMMENT ON TABLE galactic_empire_loot IS 'Выпавшее оружие противника';
COMMENT ON TABLE galactic_empire_daily_logins IS 'Ежедневные логины (для Zerg расы)';

-- Успех!
SELECT 'Galactic Empire v2.0: Начальная настройка БД выполнена!' as status;
