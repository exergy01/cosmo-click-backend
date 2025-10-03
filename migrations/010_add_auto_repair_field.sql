-- =====================================================
-- МИГРАЦИЯ 010: ДОБАВЛЕНИЕ АВТО-РЕМОНТА
-- =====================================================
-- Дата: 03.10.2025
-- Описание: Поле для отслеживания авто-ремонта кораблей

-- Добавляем поле last_auto_repair
ALTER TABLE cosmic_fleet_ships
ADD COLUMN IF NOT EXISTS last_auto_repair TIMESTAMP DEFAULT NOW();

-- Индекс для быстрого поиска кораблей, требующих ремонта
CREATE INDEX IF NOT EXISTS idx_ships_auto_repair
ON cosmic_fleet_ships(last_auto_repair)
WHERE health < max_health;

-- Комментарий
COMMENT ON COLUMN cosmic_fleet_ships.last_auto_repair IS 'Время последнего авто-ремонта (+1 HP каждые 5 минут)';

-- Успех!
SELECT 'Миграция 010: Авто-ремонт применена успешно!' as status;
