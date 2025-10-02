-- ========================================
-- МИГРАЦИЯ 008: ПЕРЕНОС СТАРЫХ КВЕСТОВ В НОВУЮ СИСТЕМУ
-- ========================================
-- Дата: 02.10.2025
-- Цель: Мигрировать 12 квестов из quests в quest_templates
--       с увеличенными наградами и переводами на EN/RU

-- ========================================
-- 1. МИГРАЦИЯ КВЕСТОВ В quest_templates
-- ========================================

INSERT INTO quest_templates (quest_key, quest_type, reward_cs, quest_data, sort_order, is_active, created_by, created_at) VALUES

-- ID 1: Пригласи друга (referral) - награда: 1 CS → 100 CS
('invite_friend', 'referral', 100, NULL, 1, true, 'migration_008', NOW()),

-- ID 2: Tapps игра (partner_link) - награда: 1 CS → 50 CS
('tapps_game', 'partner_link', 50, '{"url": "https://t.me/tapps/app?startapp=ref_1_84920"}'::jsonb, 2, true, 'migration_008', NOW()),

-- ID 3: Hot Labs игра (partner_link) - награда: 1 CS → 50 CS
('hot_labs_game', 'partner_link', 50, '{"url": "https://app.hot-labs.org/link?claim-144c36d7ab"}'::jsonb, 3, true, 'migration_008', NOW()),

-- ID 4: YupLand игра (partner_link) - награда: 1 CS → 50 CS
('yupland_game', 'partner_link', 50, '{"url": "https://t.me/YupLand_bot/Yupalka_DarAi?startapp=850758749"}'::jsonb, 4, true, 'migration_008', NOW()),

-- ID 5: Tea Bank игра (partner_link) - награда: 1 CS → 50 CS
('tea_bank_game', 'partner_link', 50, '{"url": "https://t.me/tea_bank_bot/app?startapp=58528"}'::jsonb, 5, true, 'migration_008', NOW()),

-- ID 6: Duck игра (partner_link) - награда: 1 CS → 50 CS
('duck_game', 'partner_link', 50, '{"url": "https://t.me/duckmyduck_bot?start=r1248921fcae4adca"}'::jsonb, 6, true, 'migration_008', NOW()),

-- ID 7: Bybit регистрация (partner_link) - награда: 2 CS → 300 CS
('bybit_registration', 'partner_link', 300, '{"url": "https://t.me/Bybitglobal_Official_Bot/referral?startapp=3ABPWRK"}'::jsonb, 7, true, 'migration_008', NOW()),

-- ID 8: Bitget регистрация (partner_link) - награда: 2 CS → 300 CS
('bitget_registration', 'partner_link', 300, '{"url": "https://share.bitget.com/u/2LD2UEEK&shareid=telegram"}'::jsonb, 8, true, 'migration_008', NOW()),

-- ID 9: Binance регистрация (partner_link) - награда: 2 CS → 300 CS
('binance_registration', 'partner_link', 300, '{"url": "https://www.binance.com/activity/referral-entry/CPA?ref=CPA_00ZAY67UXW&utm_medium=app_share_link_telegram"}'::jsonb, 9, true, 'migration_008', NOW()),

-- ID 11: RoboForex регистрация (partner_link) - награда: 1 CS → 200 CS
('roboforex_registration', 'partner_link', 200, '{"url": "https://my.roboforex.com/en/?a=hgtd"}'::jsonb, 10, true, 'migration_008', NOW()),

-- ID 12: RoboForex сделка (manual_check) - награда: 100 CS → 1000 CS
('roboforex_trade', 'manual_check', 1000, '{"manual_verification": true}'::jsonb, 11, true, 'migration_008', NOW()),

-- ID 20: Альфа-банк регистрация (partner_link, только RU) - награда: 3 CS → 500 CS
('alfabank_registration', 'partner_link', 500, '{"url": "https://alfa.me/rsph7o", "language": "ru"}'::jsonb, 12, true, 'migration_008', NOW())

ON CONFLICT (quest_key) DO NOTHING;

-- ========================================
-- 2. РУССКИЕ ПЕРЕВОДЫ
-- ========================================

INSERT INTO quest_translations (quest_key, language_code, quest_name, description, created_at) VALUES

-- Пригласи друга
('invite_friend', 'ru', 'Пригласи друга', 'Пригласи друга в игру и получи награду', NOW()),

-- Tapps игра
('tapps_game', 'ru', 'Tapps игра', 'Перейди в игру Tapps и получи награду', NOW()),

-- Hot Labs игра
('hot_labs_game', 'ru', 'Hot Labs игра', 'Перейди в Hot Labs и получи награду', NOW()),

-- YupLand игра
('yupland_game', 'ru', 'YupLand игра', 'Перейди в игру YupLand и получи награду', NOW()),

-- Tea Bank игра
('tea_bank_game', 'ru', 'Tea Bank игра', 'Перейди в Tea Bank и получи награду', NOW()),

-- Duck игра
('duck_game', 'ru', 'Duck игра', 'Перейди в Duck игру и получи награду', NOW()),

-- Bybit регистрация
('bybit_registration', 'ru', 'Bybit регистрация', 'Зарегистрируйся на Bybit и получи награду', NOW()),

-- Bitget регистрация
('bitget_registration', 'ru', 'Bitget регистрация', 'Зарегистрируйся на Bitget и получи награду', NOW()),

-- Binance регистрация
('binance_registration', 'ru', 'Binance регистрация', 'Зарегистрируйся на Binance и получи награду', NOW()),

-- RoboForex регистрация
('roboforex_registration', 'ru', 'RoboForex регистрация', 'Зарегистрируйся у форекс брокера RoboForex', NOW()),

-- RoboForex сделка
('roboforex_trade', 'ru', 'RoboForex сделка', 'Зарегистрируйся и соверши первую сделку на RoboForex', NOW()),

-- Альфа-банк регистрация
('alfabank_registration', 'ru', 'Альфа-банк регистрация', 'Зарегистрируйся в Альфа-банке и получи награду', NOW())

ON CONFLICT (quest_key, language_code) DO NOTHING;

-- ========================================
-- 3. АНГЛИЙСКИЕ ПЕРЕВОДЫ
-- ========================================

INSERT INTO quest_translations (quest_key, language_code, quest_name, description, created_at) VALUES

-- Пригласи друга
('invite_friend', 'en', 'Invite a Friend', 'Invite a friend to the game and get a reward', NOW()),

-- Tapps игра
('tapps_game', 'en', 'Tapps Game', 'Join Tapps game and get a reward', NOW()),

-- Hot Labs игра
('hot_labs_game', 'en', 'Hot Labs Game', 'Join Hot Labs and get a reward', NOW()),

-- YupLand игра
('yupland_game', 'en', 'YupLand Game', 'Join YupLand game and get a reward', NOW()),

-- Tea Bank игра
('tea_bank_game', 'en', 'Tea Bank Game', 'Join Tea Bank and get a reward', NOW()),

-- Duck игра
('duck_game', 'en', 'Duck Game', 'Join Duck game and get a reward', NOW()),

-- Bybit регистрация
('bybit_registration', 'en', 'Bybit Registration', 'Register on Bybit exchange and get a reward', NOW()),

-- Bitget регистрация
('bitget_registration', 'en', 'Bitget Registration', 'Register on Bitget exchange and get a reward', NOW()),

-- Binance регистрация
('binance_registration', 'en', 'Binance Registration', 'Register on Binance exchange and get a reward', NOW()),

-- RoboForex регистрация
('roboforex_registration', 'en', 'RoboForex Registration', 'Register with RoboForex forex broker', NOW()),

-- RoboForex сделка
('roboforex_trade', 'en', 'RoboForex Trade', 'Register and make your first trade on RoboForex', NOW()),

-- Альфа-банк регистрация
('alfabank_registration', 'en', 'Alfa Bank Registration', 'Register with Alfa Bank and get a reward', NOW())

ON CONFLICT (quest_key, language_code) DO NOTHING;

-- ========================================
-- 4. ОБНОВЛЕНИЕ quest_key В player_quests
-- ========================================

-- Создаем маппинг quest_id → quest_key
UPDATE player_quests SET quest_key = 'invite_friend' WHERE quest_id = 1 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'tapps_game' WHERE quest_id = 2 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'hot_labs_game' WHERE quest_id = 3 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'yupland_game' WHERE quest_id = 4 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'tea_bank_game' WHERE quest_id = 5 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'duck_game' WHERE quest_id = 6 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'bybit_registration' WHERE quest_id = 7 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'bitget_registration' WHERE quest_id = 8 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'binance_registration' WHERE quest_id = 9 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'roboforex_registration' WHERE quest_id = 11 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'roboforex_trade' WHERE quest_id = 12 AND quest_key IS NULL;
UPDATE player_quests SET quest_key = 'alfabank_registration' WHERE quest_id = 20 AND quest_key IS NULL;

-- ========================================
-- 5. ДЕАКТИВАЦИЯ СТАРЫХ КВЕСТОВ (опционально)
-- ========================================

-- ПОКА НЕ ДЕАКТИВИРУЕМ! Оставим для совместимости с V1 API
-- UPDATE quests SET is_active = false WHERE quest_id IN (1,2,3,4,5,6,7,8,9,11,12,20);

-- ========================================
-- 6. ПРОВЕРКА РЕЗУЛЬТАТОВ
-- ========================================

DO $$
DECLARE
    new_templates_count INTEGER;
    translations_ru_count INTEGER;
    translations_en_count INTEGER;
    updated_player_quests INTEGER;
BEGIN
    SELECT COUNT(*) INTO new_templates_count
    FROM quest_templates
    WHERE created_by = 'migration_008';

    SELECT COUNT(*) INTO translations_ru_count
    FROM quest_translations
    WHERE language_code = 'ru'
    AND quest_key IN ('invite_friend', 'tapps_game', 'hot_labs_game', 'yupland_game', 'tea_bank_game', 'duck_game', 'bybit_registration', 'bitget_registration', 'binance_registration', 'roboforex_registration', 'roboforex_trade', 'alfabank_registration');

    SELECT COUNT(*) INTO translations_en_count
    FROM quest_translations
    WHERE language_code = 'en'
    AND quest_key IN ('invite_friend', 'tapps_game', 'hot_labs_game', 'yupland_game', 'tea_bank_game', 'duck_game', 'bybit_registration', 'bitget_registration', 'binance_registration', 'roboforex_registration', 'roboforex_trade', 'alfabank_registration');

    SELECT COUNT(*) INTO updated_player_quests
    FROM player_quests
    WHERE quest_key IN ('invite_friend', 'tapps_game', 'hot_labs_game', 'yupland_game', 'tea_bank_game', 'duck_game', 'bybit_registration', 'bitget_registration', 'binance_registration', 'roboforex_registration', 'roboforex_trade', 'alfabank_registration');

    RAISE NOTICE '========================================';
    RAISE NOTICE 'МИГРАЦИЯ 008 ЗАВЕРШЕНА';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Новых quest_templates: %', new_templates_count;
    RAISE NOTICE 'Русских переводов: %', translations_ru_count;
    RAISE NOTICE 'Английских переводов: %', translations_en_count;
    RAISE NOTICE 'Обновлено player_quests: %', updated_player_quests;
    RAISE NOTICE '========================================';

    IF new_templates_count < 12 THEN
        RAISE WARNING 'Не все квесты мигрировали! Ожидалось 12, получено %', new_templates_count;
    END IF;
END $$;
