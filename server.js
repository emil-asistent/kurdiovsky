// kurdiovsky.cz — self-hosted server (Coolify): statické stránky s clean URLs + rezervační API.
// Bez externích závislostí (Node 20+: global fetch).
import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SLOT_TIME, bookingWindow, validDates, bookedDates, isValidDate,
  formatCz, buildIcs, sendMail, saveBooking, BOOKINGS_DIR,
} from './lib/booking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// ---------- statika ----------
async function resolveStatic(urlPath) {
  // dekódovat, zahodit query/hash (řeší se před voláním), normalizovat
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p === '/' || p === '') p = '/index.html';

  // asset (long-cache média): povolit jen pod /assets/
  if (p.startsWith('/assets/')) {
    const abs = path.resolve(WEBROOT, '.' + p);
    if (!abs.startsWith(path.join(WEBROOT, 'assets') + path.sep)) return null; // traversal
    const ext = path.extname(abs).toLowerCase();
    if (!MIME[ext]) return null;
    try { const st = await fs.stat(abs); if (st.isFile()) return { abs, ext, cache: 'public, max-age=31536000, immutable' }; } catch {}
    return null;
  }

  // root favicon/robots/sitemap pokud existují
  if (/^\/(favicon\.ico|robots\.txt|sitemap\.xml|site\.webmanifest)$/.test(p)) {
    const abs = path.join(WEBROOT, p.slice(1));
    try { const st = await fs.stat(abs); if (st.isFile()) return { abs, ext: path.extname(abs).toLowerCase(), cache: 'public, max-age=86400' }; } catch {}
    return null;
  }

  // stránka: clean URL → root-level *.html (žádné podadresáře, žádné .js/.json zdrojáky)
  let rel = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rel) rel = 'index';
  if (rel.endsWith('.html')) rel = rel.slice(0, -5);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(rel)) return null; // jen jednoduché slugy
  const abs = path.join(WEBROOT, rel + '.html');
  if (path.dirname(abs) !== WEBROOT) return null;
  try { const st = await fs.stat(abs); if (st.isFile()) return { abs, ext: '.html', cache: 'no-cache' }; } catch {}
  return null;
}

function serveFile(res, { abs, ext, cache }, isHead) {
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  if (isHead) return res.end();
  const stream = createReadStream(abs);
  stream.on('error', () => { if (!res.headersSent) send(res, 500, 'Server error'); else res.end(); });
  stream.pipe(res);
}

async function serve404(res, isHead) {
  // hezká 404 = homepage by byla matoucí; vrať prostou stránku
  const abs = path.join(WEBROOT, 'index.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (isHead) return res.end();
  try { res.end(await fs.readFile(abs)); } catch { res.end('<!doctype html><meta charset=utf-8><title>404</title><h1>Stránka nenalezena</h1><p><a href="/">Zpět na úvod</a></p>'); }
}

// ---------- API: rezervace ----------
async function apiSlots(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
  try {
    const booked = await bookedDates();
    const dates = validDates().map((date) => ({ date, available: !booked.has(date) }));
    return sendJson(res, 200, { time: SLOT_TIME, window: bookingWindow(), dates });
  } catch (e) {
    console.error('slots error', e);
    return sendJson(res, 500, { error: 'Nepodařilo se načíst termíny.' });
  }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function apiBook(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return sendJson(res, 400, { error: 'Neplatný požadavek.' });
  }
  try {
    const { date, name, email, phone, note, web } = payload || {};

    // honeypot — tiše projít
    if (web) return sendJson(res, 200, { ok: true });

    const cleanName = String(name || '').trim().slice(0, 120);
    const cleanEmail = String(email || '').trim().slice(0, 160);
    const cleanPhone = String(phone || '').trim().slice(0, 40);
    const cleanNote = String(note || '').trim().slice(0, 1000);

    if (!cleanName || cleanName.length < 3) {
      return sendJson(res, 400, { error: 'Vyplňte prosím jméno a příjmení.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      return sendJson(res, 400, { error: 'Vyplňte prosím platný e-mail.' });
    }
    if (!isValidDate(String(date || ''))) {
      return sendJson(res, 400, { error: 'Neplatný termín. Vyberte úterý, středu nebo čtvrtek, nejdříve týden a nejpozději dva měsíce dopředu.' });
    }

    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const record = {
      date, time: SLOT_TIME,
      name: cleanName, email: cleanEmail, phone: cleanPhone, note: cleanNote,
      createdAt: new Date().toISOString(),
      ip: xff || req.socket.remoteAddress || '',
    };

    // atomicky obsadit termín (ochrana proti dvojí rezervaci)
    const ok = await saveBooking(date, record);
    if (!ok) return sendJson(res, 409, { error: 'Tento termín byl právě obsazen. Vyberte prosím jiný.' });

    const when = `${formatCz(date)} v ${SLOT_TIME}`;
    const ics = buildIcs({ date, name: cleanName, email: cleanEmail });

    // 1) notifikace poradci
    const notify = (process.env.NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (notify.length) {
      try {
        await sendMail({
          to: notify, replyTo: cleanEmail, ics,
          subject: `Nová rezervace: ${when} — ${cleanName}`,
          html: `
            <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a">
              <h2 style="font-weight:500">Nová rezervace konzultace</h2>
              <p style="font-size:18px"><strong>${esc(when)}</strong></p>
              <table style="font-size:15px;line-height:1.7">
                <tr><td style="color:#888;padding-right:16px">Jméno</td><td>${esc(cleanName)}</td></tr>
                <tr><td style="color:#888;padding-right:16px">E-mail</td><td>${esc(cleanEmail)}</td></tr>
                <tr><td style="color:#888;padding-right:16px">Telefon</td><td>${esc(cleanPhone) || '—'}</td></tr>
                <tr><td style="color:#888;padding-right:16px;vertical-align:top">Poznámka</td><td>${esc(cleanNote) || '—'}</td></tr>
              </table>
              <p style="color:#888;font-size:13px;margin-top:24px">Pozvánka do kalendáře je v příloze. Rezervováno přes kurdiovsky.cz.</p>
            </div>`,
        });
      } catch (e) { console.error('notify mail failed', e); }
    }

    // 2) potvrzení klientovi
    try {
      await sendMail({
        to: cleanEmail, replyTo: 'jan@kurdiovsky.cz', ics,
        subject: `Potvrzení rezervace — ${when}`,
        html: `
          <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a">
            <h2 style="font-weight:500">Termín je rezervovaný</h2>
            <p style="font-size:17px">Dobrý den, ${esc(cleanName)},<br>potvrzuji vaši konzultaci v termínu:</p>
            <p style="font-size:20px"><strong>${esc(when)}</strong></p>
            <p style="font-size:15px;line-height:1.7">Tolstého 35, 616 00 Brno — případně se domluvíme online.<br>
            Pozvánku do kalendáře najdete v příloze.</p>
            <p style="font-size:15px;line-height:1.7">Pokud vám termín nevyhovuje, stačí odpovědět na tento e-mail
            nebo zavolat na <a href="tel:+420799794670" style="color:#d31f26">799 794 670</a>.</p>
            <p style="color:#888;font-size:14px;margin-top:28px">Jan Kurdiovský · finanční poradce, PFP<br>jan@kurdiovsky.cz · kurdiovsky.cz</p>
          </div>`,
      });
    } catch (e) { console.error('confirm mail failed', e); }

    return sendJson(res, 200, { ok: true, date, time: SLOT_TIME, formatted: when });
  } catch (e) {
    console.error('book error', e);
    return sendJson(res, 500, { error: 'Rezervaci se nepodařilo dokončit. Zkuste to prosím znovu, nebo napište na jan@kurdiovsky.cz.' });
  }
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const isHead = req.method === 'HEAD';
  try {
    const url = req.url || '/';
    const pathname = url.split('?')[0];

    if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (pathname === '/api/slots') return apiSlots(req, res);
    if (pathname === '/api/book') return apiBook(req, res);
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

    if (req.method !== 'GET' && !isHead) return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

    const file = await resolveStatic(pathname);
    if (file) return serveFile(res, file, isHead);
    return serve404(res, isHead);
  } catch (e) {
    console.error('request error', e);
    if (!res.headersSent) send(res, 500, 'Server error');
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`kurdiovsky.cz server na portu ${PORT}, rezervace v ${BOOKINGS_DIR}`);
});
