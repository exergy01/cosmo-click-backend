// services/tonDepositMonitor.js - АВТОМАТИЧЕСКИЙ МОНИТОРИНГ TON ДЕПОЗИТОВ

const pool = require('../db');
const { TonWeb } = require('tonweb');
const { notifyTonDeposit } = require('../routes/telegramBot');

// Инициализация TonWeb (потребуется API ключ)
const tonweb = new TonWeb(new TonWeb.HttpProvider('https://toncenter.com/api/v2/jsonRPC', {
    apiKey: process.env.TON_API_KEY // Получить на https://toncenter.com
}));

class TonDepositMonitor {
    constructor() {
        this.isRunning = false;
        this.checkInterval = 30000; // проверка каждые 30 секунд
        this.lastProcessedLt = null; // последняя обработанная транзакция
        this.monitoringAddress = process.env.TON_DEPOSIT_ADDRESS; // основной кошелек для депозитов
    }

    async start() {
        if (this.isRunning) {
            console.log('🔄 TON мониторинг уже запущен');
            return;
        }

        this.isRunning = true;
        console.log('🚀 Запуск мониторинга TON депозитов...');
        console.log(`📍 Мониторим адрес: ${this.monitoringAddress}`);
        
        // Получаем последнюю обработанную транзакцию из БД
        await this.loadLastProcessedTransaction();
        
        // Запускаем цикл мониторинга
        this.monitorLoop();
    }

    async stop() {
        this.isRunning = false;
        console.log('⏹️ Мониторинг TON депозитов остановлен');
    }

    async loadLastProcessedTransaction() {
        try {
            const result = await pool.query(
                'SELECT transaction_hash FROM ton_deposits ORDER BY created_at DESC LIMIT 1'
            );
            
            if (result.rows.length > 0) {
                // Получаем lt последней транзакции из hash
                // Это упрощенная версия - в реальности нужно хранить lt отдельно
                console.log('📋 Найдена последняя обработанная транзакция');
            }
        } catch (err) {
            console.error('❌ Ошибка загрузки последней транзакции:', err);
        }
    }

    async monitorLoop() {
        while (this.isRunning) {
            try {
                await this.checkNewTransactions();
                await this.sleep(this.checkInterval);
            } catch (err) {
                console.error('❌ Ошибка в цикле мониторинга:', err);
                await this.sleep(this.checkInterval);
            }
        }
    }

    async checkNewTransactions() {
        try {
            console.log('🔍 Проверяем новые TON транзакции...');

            // Получаем транзакции для мониторинг-адреса
            const transactions = await tonweb.provider.getTransactions(
                this.monitoringAddress,
                10, // количество последних транзакций
                undefined, // до какой транзакции
                undefined, // с какой транзакции
                this.lastProcessedLt // только новые транзакции
            );

            console.log(`📊 Найдено транзакций: ${transactions.length}`);

            for (const tx of transactions) {
                await this.processTransaction(tx);
            }

            // Обновляем последнюю обработанную транзакцию
            if (transactions.length > 0) {
                this.lastProcessedLt = transactions[0].transaction_id.lt;
            }

        } catch (err) {
            console.error('❌ Ошибка проверки транзакций:', err);
        }
    }

    async processTransaction(tx) {
        try {
            // Проверяем, что это входящая транзакция
            if (!tx.in_msg || !tx.in_msg.value) {
                return; // пропускаем исходящие
            }

            const amount = parseFloat(tx.in_msg.value) / 1000000000; // конвертируем из nanotons
            const hash = tx.transaction_id.hash;
            const fromAddress = tx.in_msg.source;

            console.log(`💰 Обнаружен депозит: ${amount} TON от ${fromAddress}`);

            // Проверяем, не обрабатывали ли уже эту транзакцию
            const existingTx = await pool.query(
                'SELECT id FROM ton_deposits WHERE transaction_hash = $1',
                [hash]
            );

            if (existingTx.rows.length > 0) {
                console.log('⏭️ Транзакция уже обработана, пропускаем');
                return;
            }

            // Определяем игрока по memo или комментарию
            const playerId = await this.extractPlayerIdFromTransaction(tx);
            
            if (!playerId) {
                console.log('⚠️ Не удалось определить игрока для депозита');
                // Логируем неопознанные депозиты для ручной обработки
                await this.logUnidentifiedDeposit(hash, amount, fromAddress);
                return;
            }

            // Обрабатываем депозит
            await this.processDeposit(playerId, amount, hash);

        } catch (err) {
            console.error('❌ Ошибка обработки транзакции:', err);
        }
    }

    async extractPlayerIdFromTransaction(tx) {
        try {
            // Ищем комментарий с telegram_id в транзакции
            if (tx.in_msg && tx.in_msg.message) {
                const comment = tx.in_msg.message;
                
                // Ожидаем формат комментария: "deposit_123456789" или просто "123456789"
                const telegramIdMatch = comment.match(/(?:deposit_)?(\d{8,12})/);
                if (telegramIdMatch) {
                    return telegramIdMatch[1];
                }
            }

            // Дополнительные способы определения игрока
            // Можно добавить поиск по кошелькам игроков
            const playerByWallet = await pool.query(
                'SELECT telegram_id FROM players WHERE telegram_wallet = $1',
                [tx.in_msg.source]
            );

            if (playerByWallet.rows.length > 0) {
                return playerByWallet.rows[0].telegram_id;
            }

            return null;
        } catch (err) {
            console.error('❌ Ошибка извлечения ID игрока:', err);
            return null;
        }
    }

    async processDeposit(playerId, amount, transactionHash) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Получаем данные игрока
            const playerResult = await client.query(
                'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
                [playerId]
            );

            if (playerResult.rows.length === 0) {
                console.log(`❌ Игрок ${playerId} не найден`);
                await client.query('ROLLBACK');
                return;
            }

            const playerData = playerResult.rows[0];
            const currentBalance = parseFloat(playerData.ton || '0');
            const newBalance = currentBalance + amount;

            // Обновляем баланс игрока
            await client.query(
                'UPDATE players SET ton = $1 WHERE telegram_id = $2',
                [newBalance, playerId]
            );

            // Записываем транзакцию депозита
            await client.query(
                `INSERT INTO ton_deposits (
                    player_id, amount, transaction_hash, status, created_at
                ) VALUES ($1, $2, $3, 'completed', NOW())`,
                [playerId, amount, transactionHash]
            );

            // Записываем в историю баланса
            await client.query(
                `INSERT INTO balance_history (
                    telegram_id, currency, old_balance, new_balance, 
                    change_amount, reason, details, timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                [
                    playerId,
                    'ton',
                    currentBalance,
                    newBalance,
                    amount,
                    'auto_deposit',
                    JSON.stringify({
                        transaction_hash: transactionHash,
                        auto_processed: true
                    })
                ]
            );

            await client.query('COMMIT');

            console.log(`✅ Автоматически обработан депозит: ${playerId} +${amount} TON`);
            console.log(`💰 Баланс обновлен: ${currentBalance} → ${newBalance}`);

            // Отправляем уведомление игроку
            try {
                await notifyTonDeposit(playerData, amount, transactionHash);
            } catch (notifyErr) {
                console.error('❌ Ошибка отправки уведомления:', notifyErr);
            }

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ Ошибка обработки депозита:', err);
            throw err;
        } finally {
            client.release();
        }
    }

    async logUnidentifiedDeposit(hash, amount, fromAddress) {
        try {
            await pool.query(
                `INSERT INTO ton_deposits (
                    player_id, amount, transaction_hash, status, created_at
                ) VALUES ($1, $2, $3, 'unidentified', NOW())`,
                ['unknown', amount, hash]
            );

            console.log(`📝 Зарегистрирован неопознанный депозит: ${amount} TON от ${fromAddress}`);
        } catch (err) {
            console.error('❌ Ошибка логирования неопознанного депозита:', err);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Экспортируем синглтон
const tonDepositMonitor = new TonDepositMonitor();

module.exports = {
    tonDepositMonitor,
    TonDepositMonitor
};