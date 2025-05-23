const TelegramBot = require('node-telegram-bot-api');
const pool = require('../db');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

const sendNotification = async (telegramId, message, isPremium = false) => {
  try {
    const playerResult = await pool.query('SELECT verified FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player || (!isPremium && !player.verified)) return;

    await bot.sendMessage(telegramId, message);
    console.log(`Notification sent to ${telegramId}: ${message}`);
  } catch (err) {
    console.error(`Failed to send notification to ${telegramId}: ${err.message}`);
  }
};

module.exports = { sendNotification };