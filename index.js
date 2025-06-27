const express = require('express');
const cors = require('cors');
const routes = require('./routes/index'); // ИСПРАВЛЕНО: было routes/routes

const app = express();

app.use(cors());
app.use(express.json());

// 🔥 ОСНОВНЫЕ МАРШРУТЫ
app.use('/', routes);

// 🔥 TON МАРШРУТЫ (ПЕРЕНЕСЕНО ВЫШЕ app.listen)
const tonRoutes = require('./routes/ton');
app.use('/api/ton', tonRoutes);

// 🔥 ДОПОЛНИТЕЛЬНЫЕ МАРШРУТЫ
app.get('/api/time', (req, res) => {
  res.json({ serverTime: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('CosmoClick Backend');
});

// 🔥 ЗАПУСК СЕРВЕРА (В КОНЦЕ)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});