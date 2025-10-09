-- Migration 010: Manual Quest Submissions
-- Система подачи заявок на ручную проверку заданий

-- ========================================
-- 📋 ТАБЛИЦА ДЛЯ ЗАЯВОК НА РУЧНУЮ ПРОВЕРКУ
-- ========================================

DROP TABLE IF EXISTS manual_quest_submissions CASCADE;

CREATE TABLE manual_quest_submissions (
    id SERIAL PRIMARY KEY,
    telegram_id VARCHAR(50) NOT NULL,
    quest_key VARCHAR(100) NOT NULL,

    -- Данные заявки
    submission_data JSONB NOT NULL, -- { account_number, notes, etc. }

    -- Статус
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected

    -- Данные проверки
    reviewed_by VARCHAR(50), -- telegram_id админа
    reviewed_at TIMESTAMP,
    review_notes TEXT, -- Причина отказа или комментарий

    -- Метаданные
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Индексы для быстрого поиска
    CONSTRAINT fk_quest_key FOREIGN KEY (quest_key) REFERENCES quest_templates(quest_key) ON DELETE CASCADE
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_manual_submissions_telegram ON manual_quest_submissions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_manual_submissions_quest ON manual_quest_submissions(quest_key);
CREATE INDEX IF NOT EXISTS idx_manual_submissions_status ON manual_quest_submissions(status);

-- Триггер автообновления updated_at
CREATE OR REPLACE FUNCTION update_manual_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_manual_submissions_updated_at
    BEFORE UPDATE ON manual_quest_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_manual_submissions_updated_at();

-- Комментарии
COMMENT ON TABLE manual_quest_submissions IS 'Заявки игроков на ручную проверку выполнения заданий';
COMMENT ON COLUMN manual_quest_submissions.submission_data IS 'JSON с данными заявки (номер счёта, скриншоты, etc.)';
COMMENT ON COLUMN manual_quest_submissions.status IS 'pending - на проверке, approved - одобрено, rejected - отклонено';
COMMENT ON COLUMN manual_quest_submissions.review_notes IS 'Причина отказа или комментарий администратора';
