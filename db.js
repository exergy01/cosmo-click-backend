const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') console.log('Database connected successfully');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err.message);
});

module.exports = pool;