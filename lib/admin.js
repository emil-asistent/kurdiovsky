// Mini-router pro /admin: login, aplikace, chat s agentem, náhled, zveřejnění, vrácení, upload.
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cms from './cms.js';
import * as proposals from './proposals.js';
import { runAgent, spentToday } from './agent.js';
import { audit, recentAudit } from './audit.js';
import {
  isAuthed, checkPassword, createSession, sessionCookieHeader, clearCookieHeader,
  loginBlocked, recordLoginFail, recordLoginSuccess, verifyToken, readCookie, SESSION_COOKIE,
} from './admin-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'admin');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { return null; }
}

async function serveAsset(res, name) {
  const safe = name.replace(/[^a-z0-9._-]/gi, '');
  const abs = path.join(ASSETS, safe);
  if (!abs.startsWith(ASSETS + path.sep)) return send(res, 404, 'Not found');
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return send(res, 404, 'Not found');
  } catch { return send(res, 404, 'Not found'); }
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  createReadStream(abs).pipe(res);
}

// jednoduchá historie chatu (jeden uživatel) — web a telegram mají vlastní
let webHistory = [];
function trimHistory(h) { return h.length > 24 ? h.slice(h.length - 24) : h; }

export async function handleAdmin(req, res) {
  const url = req.url || '/admin';
  const pathname = url.split('?')[0];
  const query = new URLSearchParams(url.split('?')[1] || '');
  const method = req.method || 'GET';

  // --- veřejné (bez session) ---
  if (pathname === '/admin' && method === 'GET') {
    const to = isAuthed(req) ? '/admin/app' : '/admin/login';
    return send(res, 302, '', { Location: to });
  }
  if (pathname === '/admin/login' && method === 'GET') {
    return serveAsset(res, 'login.html');
  }
  if (pathname === '/admin/login' && method === 'POST') {
    const ip = clientIp(req);
    if (loginBlocked(ip)) return sendJson(res, 429, { error: 'Příliš mnoho pokusů. Zkuste to za chvíli.' });
    const body = await readJson(req) || {};
    if (checkPassword(body.password)) {
      recordLoginSuccess(ip);
      await audit({ actor: 'admin', channel: 'web', action: 'login', ip });
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookieHeader(createSession()) });
    }
    recordLoginFail(ip);
    return sendJson(res, 401, { error: 'Špatné heslo.' });
  }

  // --- náhled konceptu: session NEBO podepsaný preview token ---
  if (pathname.startsWith('/admin/preview/')) {
    const t = query.get('t');
    const tokOk = t && verifyToken(t);
    if (!isAuthed(req) && !tokOk) return send(res, 401, 'Nepřihlášeno');
    const slug = pathname.slice('/admin/preview/'.length).replace(/\/+$/, '') || 'index';
    const html = await cms.renderSlug(slug, { mode: 'draft' });
    if (html == null) return send(res, 404, 'Stránka nenalezena');
    return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  }

  // --- vše ostatní vyžaduje session ---
  if (!isAuthed(req)) {
    if (pathname.startsWith('/admin/api/')) return sendJson(res, 401, { error: 'Nepřihlášeno' });
    return send(res, 302, '', { Location: '/admin/login' });
  }

  if (pathname === '/admin/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
  }
  if (pathname === '/admin/app' && method === 'GET') return serveAsset(res, 'app.html');
  if (pathname.startsWith('/admin/assets/') && method === 'GET') {
    return serveAsset(res, pathname.slice('/admin/assets/'.length));
  }

  // --- API ---
  if (pathname === '/admin/api/state' && method === 'GET') {
    const [changes, versions, cost, log, props] = await Promise.all([
      cms.diffDraft(), cms.listVersions(), spentToday(), recentAudit(40), proposals.list(),
    ]);
    return sendJson(res, 200, { changes, hasDraft: changes.length > 0, versions, cost, audit: log, proposals: props, pages: cms.PAGES });
  }

  if (pathname === '/admin/api/content' && method === 'GET') {
    const list = await cms.listContent(query.get('page') || undefined);
    return sendJson(res, 200, { content: list });
  }

  if (pathname === '/admin/api/chat' && method === 'POST') {
    const body = await readJson(req) || {};
    const text = String(body.message || '').slice(0, 4000);
    if (!text.trim()) return sendJson(res, 400, { error: 'Prázdná zpráva.' });
    try {
      const steps = [];
      const out = await runAgent({
        history: webHistory,
        userText: text,
        ctx: { actor: 'web', previewUrl: '/admin/preview/index' },
        onStep: (s) => steps.push({ name: s.name }),
      });
      webHistory = trimHistory(out.convo);
      const changes = await cms.diffDraft();
      await audit({ actor: 'admin', channel: 'web', action: 'chat', text: text.slice(0, 200), tools: steps.map((s) => s.name) });
      return sendJson(res, 200, { reply: out.reply, staged: out.staged, changes });
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e).slice(0, 300) });
    }
  }

  if (pathname === '/admin/api/quick' && method === 'POST') {
    const body = await readJson(req) || {};
    try {
      const r = await cms.setDraft(body.key, body.value, 'admin');
      const changes = await cms.diffDraft();
      await audit({ actor: 'admin', channel: 'web', action: 'quick-edit', key: body.key });
      return sendJson(res, 200, { ok: true, changed: r, changes });
    } catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  }

  if (pathname === '/admin/api/publish' && method === 'POST') {
    const body = await readJson(req) || {};
    try {
      const v = await cms.validateDraft();
      if (!v.ok) return sendJson(res, 400, { error: 'Koncept má problémy:\n' + v.problems.join('\n'), problems: v.problems });
      if (v.changes === 0) return sendJson(res, 400, { error: 'Není co zveřejnit.' });
      const r = await cms.publish(body.summary || 'Úprava obsahu', 'admin');
      cms.bustCache();
      webHistory = [];
      await audit({ actor: 'admin', channel: 'web', action: 'publish', summary: r.summary, version: r.version });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  }

  if (pathname === '/admin/api/revert' && method === 'POST') {
    const body = await readJson(req) || {};
    try {
      const r = await cms.revert(body.version, 'admin');
      cms.bustCache();
      await audit({ actor: 'admin', channel: 'web', action: 'revert', version: r.revertedTo });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  }

  if (pathname === '/admin/api/discard' && method === 'POST') {
    await cms.discardDraft();
    webHistory = [];
    await audit({ actor: 'admin', channel: 'web', action: 'discard' });
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/admin/api/reset' && method === 'POST') {
    webHistory = [];
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/admin/api/upload' && method === 'POST') {
    try {
      const buf = await readBody(req, 6 * 1024 * 1024);
      const name = query.get('name') || 'obrazek';
      const r = await cms.saveUpload(name, buf);
      await audit({ actor: 'admin', channel: 'web', action: 'upload', file: r.file });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
  }

  if (pathname.startsWith('/admin/api/')) return sendJson(res, 404, { error: 'Not found' });
  return send(res, 404, 'Not found');
}
