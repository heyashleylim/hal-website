/*
 * Student sign-in for the student area (/learn): a 6-digit code sent by email, then a session cookie remembered on
 * that device for a year from the last visit (Alex, 2026-11-14: "at least a week"). The personal link
 * /podcast/<token> students already have also signs them in (/learn/start/<token>).
 *
 * - Codes: valid 10 minutes, used once, 5 wrong tries end them, at most 5 sent per student per hour. Only an HMAC
 *   of the code is stored (PODCAST_SECRET).
 * - Sessions: the cookie holds 32 random bytes; the database keeps only their SHA-256. Renewed at most once a day.
 *   Revoking a student (or "sign out everywhere" in the admin, later) ends them at once: checked on every request.
 */
const crypto = require('node:crypto');
const db = require('../db.js');
const auth = require('../auth.js');

const COOKIE = 'hal_learn';
const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 365;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 5;

function secret() {
  const s = (process.env.PODCAST_SECRET || '').trim();
  if (s.length < 32) throw new Error('PODCAST_SECRET is missing or shorter than 32 characters');
  return s;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const codeHash = (studentId, code) => crypto.createHmac('sha256', secret()).update(`learn-code:${studentId}:${code}`).digest('hex');

function normalizeEmail(value) {
  const email = String(value || '').trim().normalize('NFC').toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && email.length <= 254 ? email : null;
}

// "123 456", "123-456" → "123456"; null unless exactly 6 digits.
function normalizeCode(value) {
  const digits = String(value || '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// A new code for this email, or a reason it wasn't created: { code, student } | { error: 'unknown' | 'too-many' }.
async function createCode(email, { ipHash = null, now = new Date() } = {}) {
  const student = await db.one(`SELECT id, email, name FROM students WHERE lower(email) = $1 AND status = 'active'`, [email]);
  if (!student) return { error: 'unknown' };
  const recent = await db.one(`SELECT count(*)::int AS n FROM learn_codes WHERE student_id = $1 AND created_at > $2`, [student.id, new Date(now - 60 * 60 * 1000)]);
  if (recent.n >= CODES_PER_HOUR) return { error: 'too-many' };
  const code = newCode();
  await db.query('INSERT INTO learn_codes (student_id, code_hash, expires_at, ip_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
    [student.id, codeHash(student.id, code), new Date(now.getTime() + CODE_MINUTES * 60 * 1000), ipHash, now]);
  return { code, student };
}

// Checks a code for this email. Every code sent in the last 10 minutes works (emails can arrive out of order).
// → { student } | { error: 'wrong' | 'expired' }
async function checkCode(email, code, { now = new Date() } = {}) {
  const student = await db.one(`SELECT id, email, name FROM students WHERE lower(email) = $1 AND status = 'active'`, [email]);
  if (!student) return { error: 'expired' };
  const live = await db.query(
    `SELECT id, code_hash FROM learn_codes WHERE student_id = $1 AND used_at IS NULL AND expires_at > $2 AND attempts < $3 ORDER BY id DESC LIMIT 5`,
    [student.id, now, CODE_TRIES]);
  if (!live.length) return { error: 'expired' };
  const hash = codeHash(student.id, code);
  const match = live.find((r) => auth.safeEqual(r.code_hash, hash));
  if (!match) {
    await db.query('UPDATE learn_codes SET attempts = attempts + 1 WHERE id = ANY($1::bigint[])', [live.map((r) => r.id)]);
    return { error: 'wrong' };
  }
  // Used once: every code of this student is closed, so an older email's code can't be used afterwards.
  await db.query('UPDATE learn_codes SET used_at = $2 WHERE student_id = $1 AND used_at IS NULL', [student.id, now]);
  return { student };
}

function cookieHeader(value, maxAgeSeconds) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

// Starts a session for this student and sets the cookie on `res`.
async function startSession(res, studentId, { via, userAgent = '', now = new Date() }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('INSERT INTO learn_sessions (student_id, token_hash, via, user_agent, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $5, $6)',
    [studentId, sha256(token), via, String(userAgent).slice(0, 300), now, new Date(now.getTime() + SESSION_DAYS * DAY)]);
  res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 24 * 3600));
}

function readToken(req) {
  const value = auth.readCookie(req, COOKIE);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

// The signed-in student (active), or null. Renews the session (and the cookie) when the last renewal is a day old.
async function studentFromRequest(req, res, { now = new Date() } = {}) {
  const token = readToken(req);
  if (!token) return null;
  const row = await db.one(
    `SELECT se.id AS session_id, se.last_seen_at, st.* FROM learn_sessions se JOIN students st ON st.id = se.student_id
      WHERE se.token_hash = $1 AND se.ended_at IS NULL AND se.expires_at > $2`, [sha256(token), now]);
  if (!row || row.status !== 'active') return null;
  if (now - new Date(row.last_seen_at) > DAY) {
    await db.query('UPDATE learn_sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1', [row.session_id, now, new Date(now.getTime() + SESSION_DAYS * DAY)]);
    if (res) res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 24 * 3600));
  }
  const { session_id: sessionId, last_seen_at: _, ...student } = row;
  return { ...student, sessionId };
}

async function endSession(req, res) {
  const token = readToken(req);
  if (token) await db.query('UPDATE learn_sessions SET ended_at = now() WHERE token_hash = $1 AND ended_at IS NULL', [sha256(token)]);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

module.exports = {
  COOKIE, SESSION_DAYS, CODE_MINUTES, CODE_TRIES, CODES_PER_HOUR,
  normalizeEmail, normalizeCode, newCode, createCode, checkCode, startSession, studentFromRequest, endSession, cookieHeader,
};
