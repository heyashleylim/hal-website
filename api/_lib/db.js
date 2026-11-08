/*
 * Database access (Neon Postgres over HTTP). Every SQL query of the private podcast goes through here,
 * so moving to another Postgres host only means changing this file and DATABASE_URL.
 *
 * DATABASE_URL is set in Vercel by the Neon integration (POSTGRES_URL, which it also sets, works too).
 * PODCAST_DATABASE_URL, set for Preview only, points previews at their own Neon branch (a copy of production),
 * so testing never touches students' data. Locally: .env.local (git-ignored).
 */
const { neon } = require('@neondatabase/serverless');

let sql = null;

const databaseUrl = () => process.env.PODCAST_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

// Production, local runs, or a preview with its own database. A preview without one would share production's.
const separateFromProduction = (env = process.env) => env.VERCEL_ENV !== 'preview' || Boolean((env.PODCAST_DATABASE_URL || '').trim());

function client() {
  if (!sql) {
    if (!databaseUrl()) throw new Error('DATABASE_URL is not set');
    sql = neon(databaseUrl());
  }
  return sql;
}

// All rows.
async function query(text, params = []) {
  return client().query(text, params);
}

// First row or null.
async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// Several statements in one transaction: tx([[text, params], …]) → array of row arrays.
async function tx(statements) {
  const db = client();
  return db.transaction(statements.map(([text, params = []]) => db.query(text, params)));
}

module.exports = { query, one, tx, databaseUrl, separateFromProduction };
