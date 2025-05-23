// index.js
const express = require('express');
const cors = require('cors');
const playerRoutes = require('./routes/player');
const exchangeRoutes = require('./routes/exchange');
const referralRoutes = require('./routes/referrals');
const shopRoutes = require('./routes/shop');
const questRoutes = require('./routes/quests');
const safeRoutes = require('./routes/safe');
const logRoutes = require('./routes/log');
const harvestRoutes = require('./routes/harvest');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/player', playerRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/safe', safeRoutes);
app.use('/api/log', logRoutes);
app.use('/api/harvest', harvestRoutes); // Исправляем путь для harvest

app.get('/api/time', (req, res) => {
  res.json({ serverTime: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('CosmoClick Backend');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});