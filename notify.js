const pool = require('./db');
const { sendNotification } = require('./routes/telegramBot');

const checkNotifications = async () => {
  try {
    const notifications = await pool.query(
      'SELECT * FROM notifications WHERE event_time <= NOW() AND notified = FALSE'
    );

    for (const notification of notifications.rows) {
      await sendNotification(notification.telegram_id, 'Cargo is full!', true);
      await pool.query('UPDATE notifications SET notified = TRUE WHERE id = $1', [notification.id]);
    }
  } catch (err) {
    console.error('Notification check failed:', err.message);
  }
};

// Проверка каждую минуту
setInterval(checkNotifications, 60000);

module.exports = { checkNotifications };