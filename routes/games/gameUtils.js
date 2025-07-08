const pool = require('../../db');

// Проверка баланса игрока
async function checkPlayerBalance(telegramId, amount) {
    const result = await pool.query(
        'SELECT ccc FROM players WHERE telegram_id = $1',
        [telegramId]
    );
    return result.rows[0]?.ccc >= amount;
}

// Обновление баланса
async function updatePlayerBalance(telegramId, amount) {
    await pool.query(
        'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2',
        [amount, telegramId]
    );
}

// Проверка лимитов игр
async function checkGameLimits(telegramId, gameType, maxGames = 5) {
    const today = new Date().toDateString();
    const result = await pool.query(`
        SELECT daily_games, last_reset_date 
        FROM player_game_limits 
        WHERE telegram_id = $1 AND game_type = $2
    `, [telegramId, gameType]);

    if (result.rows.length === 0) {
        // Создаем запись для нового игрока
        await pool.query(`
            INSERT INTO player_game_limits (telegram_id, game_type, daily_games, last_reset_date)
            VALUES ($1, $2, 0, CURRENT_DATE)
        `, [telegramId, gameType]);
        return { canPlay: true, gamesLeft: maxGames };
    }

    const playerLimits = result.rows[0];
    const lastReset = new Date(playerLimits.last_reset_date).toDateString();

    // Сброс лимитов если новый день
    if (lastReset !== today) {
        await pool.query(`
            UPDATE player_game_limits 
            SET daily_games = 0, last_reset_date = CURRENT_DATE
            WHERE telegram_id = $1 AND game_type = $2
        `, [telegramId, gameType]);
        return { canPlay: true, gamesLeft: maxGames };
    }

    const gamesLeft = maxGames - playerLimits.daily_games;
    return { 
        canPlay: gamesLeft > 0, 
        gamesLeft: Math.max(0, gamesLeft)
    };
}

// Добавление джекпоту
async function contributeToJackpot(amount) {
    const contribution = Math.floor(amount * 0.001); // 0.1%
    await pool.query(
        'UPDATE jackpot SET current_amount = current_amount + $1, updated_at = CURRENT_TIMESTAMP',
        [contribution]
    );
    return contribution;
}

module.exports = {
    checkPlayerBalance,
    updatePlayerBalance,
    checkGameLimits,
    contributeToJackpot
}; 
