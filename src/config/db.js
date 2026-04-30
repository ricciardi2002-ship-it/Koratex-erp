// src/config/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('Error en pool de PostgreSQL:', err);
});

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
