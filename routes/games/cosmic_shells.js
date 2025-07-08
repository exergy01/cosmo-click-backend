const express = require('express');
const router = express.Router();
const pool = require('../../db');
const crypto = require('crypto');

// Константы игры
const MIN_BET = 100;
const MAX_BET = 100000;
const WIN_MULTIPLIER = 2;
const DAILY_GAME_LIMIT = 5;
const MAX_AD_GAMES = 20;

// Утилита для создания безопасной игры
function createSecureGame(betAmount) {
    // Генерируем криптографически безопасный результат
    const randomBytes = crypto.randomBytes(4);
    const randomNumber = randomBytes.readUInt32BE(0);
    
    // 1 из 3 позиций содержит галактику (33.33% шанс выигрыша)
    const winningPosition = randomNumber % 3;
    const positions = [0, 1, 2];
    
    // Создаем расклад: 1 галактика + 2 черные дыры
    const gameLayout = ['blackhole', 'blackhole', 'blackhole'];
    gameLayout[winningPosition] = 'galaxy';
    
    // Создаем хеш для проверки целостности
    const gameData = {
        positions: gameLayout,
        winningPosition,
        betAmount,
        timestamp: Date.now()
    };
    
    const gameHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(gameData))
        .digest('hex');
    
    return {
        gameId: gameHash,
        positions: gameLayout,
        winningPosition,
        encrypted: true
    };
}

// Получить статус игры (лимиты, статистика)
router.get('/status/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Проверяем лимиты игр на сегодня
        const today = new Date().toDateString();
        let limitsResult = await pool.query(`
            SELECT daily_games, daily_ads_watched, last_reset_date 
            FROM player_game_limits 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        let dailyGames = 0;
        let dailyAds = 0;

        if (limitsResult.rows.length === 0) {
            // Создаем запись для нового игрока
            await pool.query(`
                INSERT INTO player_game_limits (telegram_id, game_type, daily_games, daily_ads_watched, last_reset_date)
                VALUES ($1, 'cosmic_shells', 0, 0, CURRENT_DATE)
            `, [telegramId]);
        } else {
            const limits = limitsResult.rows[0];
            const lastReset = new Date(limits.last_reset_date).toDateString();
            
            // Сброс лимитов если новый день
            if (lastReset !== today) {
                await pool.query(`
                    UPDATE player_game_limits 
                    SET daily_games = 0, daily_ads_watched = 0, last_reset_date = CURRENT_DATE
                    WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
                `, [telegramId]);
                dailyGames = 0;
                dailyAds = 0;
            } else {
                dailyGames = limits.daily_games;
                dailyAds = limits.daily_ads_watched;
            }
        }

        // Получаем статистику игрока
        const statsResult = await pool.query(`
            SELECT total_games, total_wins, total_losses, total_bet, total_won, best_streak, worst_streak
            FROM minigames_stats 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        const stats = statsResult.rows[0] || {
            total_games: 0,
            total_wins: 0,
            total_losses: 0,
            total_bet: 0,
            total_won: 0,
            best_streak: 0,
            worst_streak: 0
        };

        // Получаем баланс игрока
        const balanceResult = await pool.query(
            'SELECT ccc FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        const balance = balanceResult.rows[0]?.ccc || 0;

        res.json({
            success: true,
            balance: parseFloat(balance),
            dailyGames,
            dailyAds,
            canPlayFree: dailyGames < DAILY_GAME_LIMIT,
            canWatchAd: dailyAds < MAX_AD_GAMES,
            gamesLeft: Math.max(0, DAILY_GAME_LIMIT - dailyGames),
            adsLeft: Math.max(0, MAX_AD_GAMES - dailyAds),
            minBet: MIN_BET,
            maxBet: MAX_BET,
            winMultiplier: WIN_MULTIPLIER,
            stats
        });

    } catch (error) {
        console.error('Cosmic shells status error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Начать новую игру
router.post('/start-game/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { betAmount } = req.body;

        // Валидация ставки
        if (!betAmount || betAmount < MIN_BET || betAmount > MAX_BET) {
            return res.status(400).json({
                success: false,
                error: `Ставка должна быть от ${MIN_BET} до ${MAX_BET} CCC`
            });
        }

        await pool.query('BEGIN');

        try {
            // Проверка баланса и списание ставки
            const balanceResult = await pool.query(
                'SELECT ccc FROM players WHERE telegram_id = $1',
                [telegramId]
            );

            if (balanceResult.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Игрок не найден'
                });
            }

            const currentBalance = parseFloat(balanceResult.rows[0].ccc);
            if (currentBalance < betAmount) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно средств'
                });
            }

            // Списываем ставку сразу
            await pool.query(
                'UPDATE players SET ccc = ccc - $1 WHERE telegram_id = $2',
                [betAmount, telegramId]
            );

            // Проверка лимитов игр
            const limitsResult = await pool.query(`
                SELECT daily_games FROM player_game_limits 
                WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
            `, [telegramId]);

            const dailyGames = limitsResult.rows[0]?.daily_games || 0;
            if (dailyGames >= DAILY_GAME_LIMIT) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Дневной лимит игр исчерпан'
                });
            }

            // Создаем безопасную игру
            const game = createSecureGame(betAmount);

            // Сохраняем игру в базе
            await pool.query(`
                INSERT INTO minigames_history (telegram_id, game_type, bet_amount, game_result)
                VALUES ($1, 'cosmic_shells', $2, $3)
            `, [telegramId, betAmount, JSON.stringify({
                gameId: game.gameId,
                positions: game.positions,
                winningPosition: game.winningPosition,
                status: 'started',
                timestamp: Date.now()
            })]);

            await pool.query('COMMIT');

            res.json({
                success: true,
                gameId: game.gameId,
                message: 'Игра создана. Выберите тарелку после перемешивания!'
            });

        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Start cosmic shells game error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Сделать выбор тарелки (ИСПРАВЛЕНО)
router.post('/make-choice/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { gameId, chosenPosition } = req.body;

        // Валидация выбора
        if (chosenPosition < 0 || chosenPosition > 2) {
            return res.status(400).json({
                success: false,
                error: 'Неверная позиция тарелки'
            });
        }

        // ИСПРАВЛЕНО: Находим игру в истории правильно
        const gameResult = await pool.query(`
            SELECT id, bet_amount, game_result, win_amount FROM minigames_history 
            WHERE telegram_id = $1 AND game_result->>'gameId' = $2 
            AND game_type = 'cosmic_shells'
            ORDER BY created_at DESC LIMIT 1
        `, [telegramId, gameId]);

        if (gameResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Игра не найдена'
            });
        }

        const gameRow = gameResult.rows[0];
        const gameData = JSON.parse(gameRow.game_result);
        const betAmount = gameRow.bet_amount;

        // Проверяем что игра еще не завершена
        if (gameData.status !== 'started') {
            return res.status(400).json({
                success: false,
                error: 'Игра уже завершена'
            });
        }

        // Определяем результат
        const isWin = chosenPosition === gameData.winningPosition;
        const winAmount = isWin ? betAmount * WIN_MULTIPLIER : 0;
        const profit = winAmount - betAmount;

        await pool.query('BEGIN');

        try {
            // Обновляем баланс игрока
            if (isWin) {
                // При выигрыше начисляем выигрыш (ставка уже списана)
                await pool.query(
                    'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2',
                    [winAmount, telegramId]
                );
            }
            // При проигрыше ничего не возвращаем (ставка уже списана при старте)

            // Обновляем историю игры
            const finalGameData = {
                ...gameData,
                chosenPosition,
                isWin,
                winAmount,
                profit,
                status: 'completed',
                completedAt: Date.now()
            };

            await pool.query(`
                UPDATE minigames_history 
                SET win_amount = $1, game_result = $2
                WHERE id = $3
            `, [winAmount, JSON.stringify(finalGameData), gameRow.id]);

            // Обновляем статистику игрока
            await pool.query(`
                INSERT INTO minigames_stats (telegram_id, game_type, total_games, total_wins, total_losses, total_bet, total_won)
                VALUES ($1, 'cosmic_shells', 1, $2, $3, $4, $5)
                ON CONFLICT (telegram_id, game_type)
                DO UPDATE SET
                    total_games = minigames_stats.total_games + 1,
                    total_wins = minigames_stats.total_wins + $2,
                    total_losses = minigames_stats.total_losses + $3,
                    total_bet = minigames_stats.total_bet + $4,
                    total_won = minigames_stats.total_won + $5,
                    updated_at = CURRENT_TIMESTAMP
            `, [telegramId, isWin ? 1 : 0, isWin ? 0 : 1, betAmount, winAmount]);

            // Обновляем лимиты игр
            await pool.query(`
                UPDATE player_game_limits 
                SET daily_games = daily_games + 1
                WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
            `, [telegramId]);

            // Добавляем к джекпоту
            if (!isWin) {
                const jackpotContribution = Math.floor(betAmount * 0.001); // 0.1%
                if (jackpotContribution > 0) {
                    await pool.query(
                        'UPDATE jackpot SET current_amount = current_amount + $1, updated_at = CURRENT_TIMESTAMP',
                        [jackpotContribution]
                    );
                }
            }

            await pool.query('COMMIT');

            res.json({
                success: true,
                result: {
                    isWin,
                    chosenPosition,
                    winningPosition: gameData.winningPosition,
                    positions: gameData.positions,
                    betAmount,
                    winAmount,
                    profit
                }
            });

        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Make choice cosmic shells error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Получить историю игр
router.get('/history/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { limit = 10 } = req.query;

        const result = await pool.query(`
            SELECT 
                bet_amount,
                win_amount,
                game_result,
                created_at
            FROM minigames_history 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
            AND game_result->>'status' = 'completed'
            ORDER BY created_at DESC 
            LIMIT $2
        `, [telegramId, parseInt(limit.toString())]);

        const history = result.rows.map(row => {
            const gameData = JSON.parse(row.game_result);
            return {
                betAmount: row.bet_amount,
                winAmount: row.win_amount,
                isWin: gameData.isWin,
                profit: row.win_amount - row.bet_amount,
                chosenPosition: gameData.chosenPosition,
                winningPosition: gameData.winningPosition,
                createdAt: row.created_at
            };
        });

        res.json({
            success: true,
            history
        });

    } catch (error) {
        console.error('Get cosmic shells history error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Посмотреть рекламу за дополнительную игру
router.post('/watch-ad/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;

        // Проверяем лимит рекламы
        const limitsResult = await pool.query(`
            SELECT daily_ads_watched FROM player_game_limits 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        const dailyAds = limitsResult.rows[0]?.daily_ads_watched || 0;
        
        if (dailyAds >= MAX_AD_GAMES) {
            return res.status(400).json({
                success: false,
                error: 'Дневной лимит рекламы исчерпан'
            });
        }

        // Увеличиваем счетчик рекламы (это даёт право на еще одну игру)
        await pool.query(`
            UPDATE player_game_limits 
            SET daily_ads_watched = daily_ads_watched + 1
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        res.json({
            success: true,
            adsRemaining: MAX_AD_GAMES - dailyAds - 1,
            message: 'Получена дополнительная игра!'
        });

    } catch (error) {
        console.error('Watch ad cosmic shells error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

module.exports = router;