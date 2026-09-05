'use strict';
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set. On Railway, add a Postgres plugin.');
}

// Railway's internal networking (*.railway.internal) does not need SSL.
// External Postgres hosts usually do — toggle with DATABASE_SSL=true.
const url = process.env.DATABASE_URL || '';
const wantSSL =
  String(process.env.DATABASE_SSL).toLowerCase() === 'true' ||
  (url && !url.includes('railway.internal') && !url.includes('localhost') && !url.includes('127.0.0.1'));

const pool = new Pool({
  connectionString: url,
  ssl: wantSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
