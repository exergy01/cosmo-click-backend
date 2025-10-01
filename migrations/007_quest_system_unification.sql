-- Migration 007: Quest System Unification
-- Объединение старой и новой систем заданий

-- ========================================
-- 📋 СОЗДАНИЕ НОВЫХ ТАБЛИЦ СИСТЕМЫ ЗАДАНИЙ
-- ========================================

-- Шаблоны заданий (основная таблица)
CREATE TABLE IF NOT EXISTS quest_templates (
    id SERIAL PRIMARY KEY,
    quest_key VARCHAR(100) UNIQUE NOT NULL, -- Уникальный ключ задания
    quest_type VARCHAR(50) NOT NULL, -- partner_link, manual_check, daily, etc.
    reward_cs INTEGER NOT NULL DEFAULT 0,
    quest_data JSONB, -- Данные задания (ссылки, параметры и т.д.)
    target_languages TEXT[], -- Целевые языки ['en', 'ru', etc.] или NULL для всех
    sort_order INTEGER DEFAULT 999,
    manual_check_instructions TEXT, -- Инструкции для админа при ручной проверке

    -- Планирование заданий
    is_scheduled BOOLEAN DEFAULT FALSE,
    schedule_type VARCHAR(20), -- daily, weekly, monthly, custom
    schedule_pattern VARCHAR(100), -- cron-like pattern или custom
    schedule_time TIME, -- время активации
    schedule_start_date TIMESTAMP,
    schedule_end_date TIMESTAMP,
    schedule_metadata JSONB, -- дополнительные данные планирования
    schedule_status VARCHAR(20) DEFAULT 'inactive', -- active, inactive, completed
    auto_activate BOOLEAN DEFAULT FALSE,
    auto_deactivate BOOLEAN DEFAULT FALSE,
    last_scheduled_activation TIMESTAMP,
    next_scheduled_activation TIMESTAMP,

    -- Метаданные
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(50), -- telegram_id создателя
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Переводы заданий
CREATE TABLE IF NOT EXISTS quest_translations (
    id SERIAL PRIMARY KEY,
    quest_key VARCHAR(100) NOT NULL REFERENCES quest_templates(quest_key) ON DELETE CASCADE,
    language_code VARCHAR(5) NOT NULL, -- en, ru, es, fr, de, zh, ja
    quest_name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    manual_check_user_instructions TEXT, -- Инструкции для пользователя при ручной проверке
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(quest_key, language_code)
);

-- История планировщика заданий
CREATE TABLE IF NOT EXISTS quest_scheduler_history (
    id SERIAL PRIMARY KEY,
    quest_key VARCHAR(100) NOT NULL,
    quest_template_id INTEGER REFERENCES quest_templates(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL, -- activated, deactivated, error, expired
    scheduled_time TIMESTAMP NOT NULL,
    actual_time TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20) NOT NULL, -- completed, failed, skipped
    details JSONB, -- дополнительные данные
    error_message TEXT,
    created_by VARCHAR(50) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- 🔄 ОБНОВЛЕНИЕ СТАРЫХ ТАБЛИЦ
-- ========================================

-- Добавляем поле quest_key в player_quests для связи с новой системой
ALTER TABLE player_quests
ADD COLUMN IF NOT EXISTS quest_key VARCHAR(100);

-- Добавляем индексы для производительности
CREATE INDEX IF NOT EXISTS idx_quest_templates_active ON quest_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_quest_templates_key ON quest_templates(quest_key);
CREATE INDEX IF NOT EXISTS idx_quest_templates_scheduled ON quest_templates(is_scheduled, schedule_status, next_scheduled_activation);
CREATE INDEX IF NOT EXISTS idx_quest_translations_key_lang ON quest_translations(quest_key, language_code);
CREATE INDEX IF NOT EXISTS idx_player_quests_key ON player_quests(quest_key);
CREATE INDEX IF NOT EXISTS idx_quest_scheduler_history_key ON quest_scheduler_history(quest_key);

-- ========================================
-- 📊 МИГРАЦИЯ ДАННЫХ ИЗ СТАРОЙ СИСТЕМЫ
-- ========================================

-- Создаем шаблоны заданий на основе существующих заданий
INSERT INTO quest_templates (
    quest_key,
    quest_type,
    reward_cs,
    quest_data,
    sort_order,
    is_active,
    created_by,
    created_at
)
SELECT
    COALESCE(quest_name, 'legacy_quest_' || quest_id::TEXT) as quest_key,
    COALESCE(quest_type, 'manual_check') as quest_type,
    COALESCE(reward_cs, 0) as reward_cs,
    quest_data,
    quest_id as sort_order,
    COALESCE(is_active, true) as is_active,
    'migration_007' as created_by,
    NOW() as created_at
FROM quests
WHERE NOT EXISTS (
    SELECT 1 FROM quest_templates qt
    WHERE qt.quest_key = COALESCE(quests.quest_name, 'legacy_quest_' || quests.quest_id::TEXT)
);

-- Создаем английские переводы для мигрированных заданий
INSERT INTO quest_translations (
    quest_key,
    language_code,
    quest_name,
    description,
    created_at
)
SELECT
    COALESCE(q.quest_name, 'legacy_quest_' || q.quest_id::TEXT) as quest_key,
    'en' as language_code,
    COALESCE(q.quest_name, 'Legacy Quest ' || q.quest_id::TEXT) as quest_name,
    COALESCE(q.description, 'Migrated from legacy quest system') as description,
    NOW() as created_at
FROM quests q
WHERE NOT EXISTS (
    SELECT 1 FROM quest_translations qt
    WHERE qt.quest_key = COALESCE(q.quest_name, 'legacy_quest_' || q.quest_id::TEXT)
    AND qt.language_code = 'en'
);

-- Обновляем quest_key в player_quests для связи с новой системой
UPDATE player_quests
SET quest_key = (
    SELECT COALESCE(q.quest_name, 'legacy_quest_' || q.quest_id::TEXT)
    FROM quests q
    WHERE q.quest_id = player_quests.quest_id
)
WHERE quest_key IS NULL;

-- ========================================
-- 🛠️ СОЗДАНИЕ ФУНКЦИЙ ДЛЯ ПЛАНИРОВЩИКА
-- ========================================

-- Функция для вычисления следующей активации задания
CREATE OR REPLACE FUNCTION calculate_next_quest_activation(
    p_quest_id INTEGER,
    p_current_time TIMESTAMP DEFAULT NOW()
) RETURNS TIMESTAMP AS $$
DECLARE
    quest_data RECORD;
    next_activation TIMESTAMP;
BEGIN
    SELECT
        schedule_type,
        schedule_pattern,
        schedule_time,
        schedule_start_date,
        schedule_end_date
    INTO quest_data
    FROM quest_templates
    WHERE id = p_quest_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Если расписание истекло
    IF quest_data.schedule_end_date IS NOT NULL AND quest_data.schedule_end_date < p_current_time THEN
        RETURN NULL;
    END IF;

    CASE quest_data.schedule_type
        WHEN 'daily' THEN
            next_activation := (DATE(p_current_time) + INTERVAL '1 day' + COALESCE(quest_data.schedule_time, '00:00:00'::TIME))::TIMESTAMP;
        WHEN 'weekly' THEN
            next_activation := (DATE(p_current_time) + INTERVAL '7 days' + COALESCE(quest_data.schedule_time, '00:00:00'::TIME))::TIMESTAMP;
        WHEN 'monthly' THEN
            next_activation := (DATE(p_current_time) + INTERVAL '1 month' + COALESCE(quest_data.schedule_time, '00:00:00'::TIME))::TIMESTAMP;
        ELSE
            next_activation := NULL;
    END CASE;

    -- Проверяем что активация не позже окончания расписания
    IF quest_data.schedule_end_date IS NOT NULL AND next_activation > quest_data.schedule_end_date THEN
        RETURN NULL;
    END IF;

    RETURN next_activation;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 🔧 СОЗДАНИЕ ТРИГГЕРОВ
-- ========================================

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_quest_templates_updated_at
    BEFORE UPDATE ON quest_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quest_translations_updated_at
    BEFORE UPDATE ON quest_translations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 📊 СТАТИСТИКИ И ПРЕДСТАВЛЕНИЯ
-- ========================================

-- Представление для статистики заданий
CREATE OR REPLACE VIEW quest_statistics AS
SELECT
    qt.id,
    qt.quest_key,
    qt.quest_type,
    qt.is_active,
    qt.reward_cs,
    COUNT(DISTINCT qtr.language_code) as translation_count,
    ARRAY_AGG(DISTINCT qtr.language_code ORDER BY qtr.language_code) FILTER (WHERE qtr.language_code IS NOT NULL) as available_languages,
    COUNT(DISTINCT pq.telegram_id) FILTER (WHERE pq.completed = true) as completion_count,
    COUNT(DISTINCT pq.telegram_id) as attempt_count,
    qt.created_at,
    qt.updated_at
FROM quest_templates qt
LEFT JOIN quest_translations qtr ON qt.quest_key = qtr.quest_key
LEFT JOIN player_quests pq ON qt.quest_key = pq.quest_key
GROUP BY qt.id, qt.quest_key, qt.quest_type, qt.is_active, qt.reward_cs, qt.created_at, qt.updated_at;

-- ========================================
-- 📝 ДАННЫЕ ПО УМОЛЧАНИЮ
-- ========================================

-- Создаем базовые задания если их нет
INSERT INTO quest_templates (quest_key, quest_type, reward_cs, sort_order, created_by) VALUES
('telegram_subscribe', 'partner_link', 50, 1, 'system'),
('twitter_follow', 'partner_link', 30, 2, 'system'),
('discord_join', 'partner_link', 40, 3, 'system')
ON CONFLICT (quest_key) DO NOTHING;

-- Создаем переводы для базовых заданий
INSERT INTO quest_translations (quest_key, language_code, quest_name, description) VALUES
-- Telegram Subscribe
('telegram_subscribe', 'en', 'Join Telegram Channel', 'Subscribe to our official Telegram channel'),
('telegram_subscribe', 'ru', 'Подписаться на Telegram', 'Подпишитесь на наш официальный Telegram канал'),
-- Twitter Follow
('twitter_follow', 'en', 'Follow on Twitter', 'Follow our official Twitter account'),
('twitter_follow', 'ru', 'Подписаться на Twitter', 'Подпишитесь на наш официальный Twitter аккаунт'),
-- Discord Join
('discord_join', 'en', 'Join Discord Server', 'Join our community Discord server'),
('discord_join', 'ru', 'Присоединиться к Discord', 'Присоединитесь к нашему Discord серверу')
ON CONFLICT (quest_key, language_code) DO NOTHING;

-- ========================================
-- ✅ ФИНАЛЬНАЯ ПРОВЕРКА
-- ========================================

-- Проверяем что миграция прошла успешно
DO $$
DECLARE
    template_count INTEGER;
    translation_count INTEGER;
    player_quest_with_key_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO template_count FROM quest_templates;
    SELECT COUNT(*) INTO translation_count FROM quest_translations;
    SELECT COUNT(*) INTO player_quest_with_key_count FROM player_quests WHERE quest_key IS NOT NULL;

    RAISE NOTICE 'Migration 007 completed successfully:';
    RAISE NOTICE '- Quest templates: %', template_count;
    RAISE NOTICE '- Quest translations: %', translation_count;
    RAISE NOTICE '- Player quests with quest_key: %', player_quest_with_key_count;
END $$;