const express = require('express');
const cors = require('cors');
const routes = require('./routes/index'); // ИСПРАВЛЕНО: было routes/routes

const app = express();

app.use(cors());
app.use(express.json());

app.use('/', routes);

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