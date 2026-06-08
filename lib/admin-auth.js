// Zero-dep autentizace: heslo přes scrypt + porovnání v konstantním čase,
// session = HMAC podepsaná cookie. Login throttling v paměti.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'kc_session';
const SESSION_TTL_S = 7 * 24 * 3600;

function secret() {
  return process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
}

// ---------- heslo ----------
export function checkPassword(submitted) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const salt = 'kurdiovsky-cms';
  const a = crypto.scryptSync(String(submitted ?? ''), salt, 32);
  const b = crypto.scryptSync(expected, salt, 32);
  return crypto.timingSafeEqual(a, b);
}

// ---------- podepsané tokeny (session i preview) ----------
function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function createSession() {
  return sign({ kind: 'session', exp: Date.now() + SESSION_TTL_S * 1000 });
}

export function previewToken(ttlMs = 3600 * 1000) {
  return sign({ kind: 'preview', exp: Date.now() + ttlMs });
}

export function verifyToken(token) {
  return verify(token);
}

// ---------- cookies ----------
export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookieHeader(token) {
  const secure = process.env.COOKIE_INSECURE === '1' ? '' : 'Secure; ';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${secure}SameSite=Strict; Path=/admin; Max-Age=${SESSION_TTL_S}`;
}

export function clearCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`;
}

export function isAuthed(req) {
  const data = verify(readCookie(req, SESSION_COOKIE));
  return !!(data && data.kind === 'session');
}

// ---------- throttling přihlášení ----------
const fails = new Map(); // ip -> { count, until }
export function loginBlocked(ip) {
  const e = fails.get(ip);
  return !!(e && e.until > Date.now());
}
export function recordLoginFail(ip) {
  const e = fails.get(ip) || { count: 0, until: 0 };
  e.count += 1;
  if (e.count >= 5) { e.until = Date.now() + 10 * 60 * 1000; e.count = 0; }
  fails.set(ip, e);
}
export function recordLoginSuccess(ip) {
  fails.delete(ip);
}
