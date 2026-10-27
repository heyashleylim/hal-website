/*
 * Small helpers shared by the podcast admin API modules (admin-content.js, admin-cohorts.js).
 */
const db = require('../db.js');

// An error whose message is shown to the admin (400 unless given).
function userError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

// The show the admin is working on (the show switcher sends its slug); the first show if none is given.
async function getShow(slug) {
  const show = slug
    ? await db.one('SELECT * FROM shows WHERE slug = $1', [String(slug)])
    : await db.one('SELECT * FROM shows ORDER BY id LIMIT 1');
  if (!show) throw userError(slug ? `program "${slug}" not found` : 'no program yet: create one on the Programs page', 404);
  return show;
}

function text(value, { max = 5000, required = false, label = 'value' } = {}) {
  const s = String(value == null ? '' : value).trim();
  if (required && !s) throw userError(`${label} is required`);
  if (s.length > max) throw userError(`${label} is too long (max ${max} characters)`);
  return s;
}

function int(value, { min = 0, max = 100000, label = 'value', optional = false } = {}) {
  if (optional && (value === '' || value == null)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw userError(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

function date(value, { label = 'date' } = {}) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw userError(`${label} must be a date (YYYY-MM-DD)`);
  return s;
}

function time(value, { label = 'time' } = {}) {
  const s = String(value || '');
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s)) throw userError(`${label} must be a time (HH:MM)`);
  return s;
}

function email(value, { label = 'email', optional = false } = {}) {
  const s = String(value || '').trim().toLowerCase();
  if (optional && !s) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254) throw userError(`${label} must be a valid email address`);
  return s;
}

// Turns Postgres unique violations into readable messages: map constraint/index name → message.
async function friendlyUnique(promise, messages) {
  try {
    return await promise;
  } catch (err) {
    if (err.code === '23505') {
      const key = Object.keys(messages).find((k) => String(err.constraint || err.message).includes(k));
      throw userError(key ? messages[key] : 'this would create a duplicate');
    }
    throw err;
  }
}

module.exports = { userError, getShow, text, int, date, time, email, friendlyUnique };
