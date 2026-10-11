const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

// Thin wrapper so callers do not touch pg directly.
async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Allowlisted table names only; callers pass a constant from this list.
const TABLES = new Set(['users', 'orders', 'products']);
async function countRows(table) {
  if (!TABLES.has(table)) throw new Error(`unknown table ${table}`);
  const rows = await pool.query(`select count(*)::int as n from ${table}`);
  return rows.rows[0].n;
}

module.exports = { query, countRows, pool };
