// Obsahový engine (CMS) — Tier 1.
// Editovatelná místa v HTML jsou označená párovými komentáři:
//   <!--cms:home.hero.lead type=text label="Podnadpis na úvodu"-->VÝCHOZÍ<!--/cms:home.hero.lead-->
// Výchozí obsah zůstává v gitu (v HTML), přepisy žijí na /data (přežijí redeploy).
// Bez externích závislostí (Node 20+).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WEBROOT = path.resolve(__dirname, '..'); // lib/ je pod rootem repa

// Úložiště obsahu (Coolify persistent volume → /data/cms).
export const CMS_DIR = process.env.CMS_DIR || path.join(process.cwd(), 'data', 'cms');
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(CMS_DIR, 'uploads');
const LIVE = path.join(CMS_DIR, 'content.live.json');
const DRAFT = path.join(CMS_DIR, 'content.draft.json');
const VERSIONS = path.join(CMS_DIR, 'versions');
const MAX_VERSIONS = 60;

// Stránky, které se renderují přes CMS (deployované; varianty a.html/b.html/c.html sem nepatří).
export const PAGES = ['index', 'sluzby', 'o-mne', 'kontakt', 'rezervace', 'portal', 'ochrana-osobnich-udaju'];

// Celý marker: skupina 1 = klíč, 2 = atributy (type/label), 3 = výchozí obsah.
// Skupina 2 = cokoli až po první "-->" (tolerantní k drobným chybám v zápisu atributů/labelu).
const MARKER_RE = /<!--cms:([a-z0-9._-]+)((?:(?!-->)[\s\S])*?)-->([\s\S]*?)<!--\/cms:\1-->/g;
const ATTR_RE = /([a-z]+)=(?:"([^"]*)"|([^\s">]+))/gi;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// ---------- sanitizace ----------
// text: neutralizuj jen tagy (< >), ale ponech & → HTML entity jako &nbsp; fungují
// (česká typografie). Tagy nelze vytvořit, takže XSS nehrozí.
function escText(s) {
  return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// richtext: default-deny — vše se zaescapuje a pak se znovu povolí jen pár jednoduchých
// tagů + HTML entity (&nbsp; apod.).
function sanitizeRich(s) {
  let out = esc(String(s ?? ''));
  out = out
    .replace(/&lt;(\/?)(em|strong|b|i|br)\s*\/?&gt;/gi, '<$1$2>')
    .replace(/&lt;span class=&quot;([a-z0-9 _-]{0,40})&quot;&gt;/gi, '<span class="$1">')
    .replace(/&lt;\/span&gt;/gi, '</span>')
    .replace(/&lt;a href=&quot;((?:https?:\/\/|mailto:|tel:|\/)[^"&<>]{0,300})&quot;&gt;/gi, '<a href="$1">')
    .replace(/&lt;\/a&gt;/gi, '</a>')
    // znovu povol HTML entity (&amp;nbsp; → &nbsp;, &amp;#160; → &#160;)
    .replace(/&amp;(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, '&$1;');
  return out;
}

// image/url: povolíme jen bezpečné cesty/schémata.
function isSafeUrl(v) {
  return /^(https?:\/\/|mailto:|tel:|\/)[^\s"'<>]*$/i.test(String(v ?? ''));
}

// Speciální „klíč" pro vlastní CSS celého webu (real-time změny vzhledu) — vkládá se do <head>.
export const CUSTOM_CSS_KEY = '__customcss__';

// CSS se vkládá do <style>; znemožni únik z tagu a vložení skriptu.
function sanitizeCss(css) {
  return String(css ?? '')
    .replace(/<\/(style|script)/gi, '<\\/$1')
    .replace(/<!--|-->/g, '')
    .slice(0, 20000);
}

function injectCss(html, css) {
  const safe = sanitizeCss(css);
  if (!safe.trim()) return html;
  const tag = `\n<style id="cms-custom-css">\n${safe}\n</style>\n`;
  return html.includes('</head>') ? html.replace('</head>', tag + '</head>') : html + tag;
}

// ---------- parsování značek (cache dle mtime souboru) ----------
const tplCache = new Map(); // abs -> { mtimeMs, segments }

function parseAttrs(str) {
  const out = {};
  if (!str) return out;
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(str))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  return out;
}

async function getSegments(abs) {
  const st = await fs.stat(abs);
  const cached = tplCache.get(abs);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.segments;
  const html = await fs.readFile(abs, 'utf8');
  const segments = [];
  let last = 0;
  let m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(html))) {
    if (m.index > last) segments.push({ t: 'lit', s: html.slice(last, m.index) });
    const attrs = parseAttrs(m[2]);
    segments.push({ t: 'slot', key: m[1], type: (attrs.type || 'text').toLowerCase(), label: attrs.label || '', def: m[3] });
    last = m.index + m[0].length;
  }
  if (last < html.length) segments.push({ t: 'lit', s: html.slice(last) });
  tplCache.set(abs, { mtimeMs: st.mtimeMs, segments });
  return segments;
}

function absForSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return path.join(WEBROOT, slug + '.html');
}

// ---------- registr klíčů (odvozený ze značek napříč stránkami) ----------
// Cache: klíč na max(mtime) HTML souborů. V produkci se HTML mění jen redeployem.
let regCache = { sig: '', reg: null, defaults: null };

export async function getRegistry() {
  // podpis = mtime všech stránek
  const stats = await Promise.all(PAGES.map(async (slug) => {
    try { return (await fs.stat(path.join(WEBROOT, slug + '.html'))).mtimeMs; } catch { return 0; }
  }));
  const sig = stats.join(',');
  if (regCache.reg && regCache.sig === sig) return { reg: regCache.reg, defaults: regCache.defaults };

  const reg = {};
  const defaults = {};
  for (const slug of PAGES) {
    const abs = path.join(WEBROOT, slug + '.html');
    let segs;
    try { segs = await getSegments(abs); } catch { continue; }
    for (const s of segs) {
      if (s.t !== 'slot') continue;
      defaults[s.key] = s.def;
      if (!reg[s.key]) reg[s.key] = { key: s.key, type: s.type, label: s.label, page: slug };
      else if (reg[s.key].page !== slug && reg[s.key].page !== 'global') reg[s.key].page = 'global';
    }
  }
  regCache = { sig, reg, defaults };
  return { reg, defaults };
}

// ---------- obsah (live/draft) ----------
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function writeAtomic(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, file); // atomické na stejném FS
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// vrátí přepisy (values) pro daný režim; draft padá zpět na live, když koncept neexistuje
async function loadOverrides(mode) {
  if (mode === 'draft') {
    const d = await readJson(DRAFT);
    if (d) return d.values || {};
  }
  const l = await readJson(LIVE);
  return (l && l.values) || {};
}

async function ensureDraft() {
  const d = await readJson(DRAFT);
  if (d) return d;
  const live = await readJson(LIVE);
  return { updatedAt: '', updatedBy: '', values: { ...((live && live.values) || {}) } };
}

// ---------- render ----------
function renderSlot(seg, overrides, regEntry) {
  if (!(seg.key in overrides)) return seg.def;
  const val = overrides[seg.key];
  const type = (regEntry && regEntry.type) || seg.type || 'text';
  if (type === 'richtext') return sanitizeRich(val);
  if (type === 'image' || type === 'url') return isSafeUrl(val) ? String(val) : seg.def;
  return escText(val);
}

/** Vyrenderuje stránku (abs cesta k *.html) s přepisy z live nebo draft. */
export async function renderPage(abs, { mode = 'live' } = {}) {
  const segments = await getSegments(abs);
  const overrides = await loadOverrides(mode);
  const hasSlots = segments.some((s) => s.t === 'slot');
  let out;
  if (hasSlots) {
    const { reg } = await getRegistry();
    out = '';
    for (const s of segments) out += s.t === 'lit' ? s.s : renderSlot(s, overrides, reg[s.key]);
  } else {
    out = await fs.readFile(abs, 'utf8'); // žádné značky → původní HTML
  }
  if (overrides[CUSTOM_CSS_KEY]) out = injectCss(out, overrides[CUSTOM_CSS_KEY]); // real-time vzhled
  return out;
}

export async function renderSlug(slug, opts) {
  const abs = absForSlug(slug);
  if (!abs) return null;
  if (!(await exists(abs))) return null;
  return renderPage(abs, opts);
}

// ---------- editace (vždy do draftu) ----------
function validateValue(meta, value) {
  const v = String(value ?? '');
  if (v.length > 20000) throw new Error('Hodnota je příliš dlouhá (max 20 000 znaků).');
  if (meta && (meta.type === 'image' || meta.type === 'url')) {
    if (!isSafeUrl(v)) throw new Error('Neplatná adresa/cesta (povolené: https://, mailto:, tel:, /cesta).');
  }
}

export async function setDraft(key, value, actor) {
  let label, page;
  if (key === CUSTOM_CSS_KEY) {
    if (String(value ?? '').length > 20000) throw new Error('CSS je příliš dlouhé (max 20 000 znaků).');
    label = 'Vlastní vzhled (CSS)'; page = 'vzhled';
  } else {
    const { reg } = await getRegistry();
    if (!reg[key]) throw new Error(`Neznámý klíč „${key}". Nejdřív použij list_content / search_content.`);
    validateValue(reg[key], value);
    label = reg[key].label; page = reg[key].page;
  }
  const draft = await ensureDraft();
  const before = (draft.values[key] !== undefined) ? draft.values[key] : undefined;
  draft.values[key] = String(value);
  draft.updatedAt = new Date().toISOString();
  draft.updatedBy = actor || 'ai';
  await writeAtomic(DRAFT, draft);
  return { key, label, page, before, value: String(value) };
}

/** Vrátí zdrojový CSS (z <style> bloků) + řádky odpovídající dotazu — aby agent věděl, jak je vzhled udělaný. */
export async function inspectDesign(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return { matches: [] };
  const matches = [];
  const seenText = new Set();
  for (const slug of PAGES) {
    let s;
    try { s = await fs.readFile(path.join(WEBROOT, slug + '.html'), 'utf8'); } catch { continue; }
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        const text = lines[i].trim().slice(0, 150);
        if (seenText.has(text)) continue; // nehromaď stejné řádky (footery apod.)
        seenText.add(text);
        matches.push({ page: slug, line: i + 1, text });
        if (matches.length >= 15) return { matches, hint: 'Máš dost; teď zavolej set_custom_css s kompletním CSS.' };
      }
    }
  }
  return { matches, hint: 'Teď zavolej set_custom_css s kompletním CSS.' };
}

export async function getCustomCss(mode = 'live') {
  const o = await loadOverrides(mode);
  return o[CUSTOM_CSS_KEY] || '';
}

export async function setImageDraft(key, urlOrPath, actor) {
  return setDraft(key, urlOrPath, actor);
}

export async function discardDraft() {
  await fs.rm(DRAFT, { force: true });
  return { ok: true };
}

// ---------- čtení pro UI / agenta ----------
export async function listContent(page) {
  const { reg, defaults } = await getRegistry();
  const live = await loadOverrides('live');
  const draft = await readJson(DRAFT);
  const draftVals = (draft && draft.values) || null;
  return Object.values(reg)
    .filter((m) => !page || m.page === page)
    .map((m) => ({
      key: m.key, page: m.page, type: m.type, label: m.label,
      current: (m.key in live) ? live[m.key] : defaults[m.key],
      draft: draftVals && (m.key in draftVals) ? draftVals[m.key] : undefined,
    }));
}

export async function getContent(key) {
  const { reg, defaults } = await getRegistry();
  if (!reg[key]) return null;
  const live = await loadOverrides('live');
  return { key, ...reg[key], current: (key in live) ? live[key] : defaults[key] };
}

export async function searchContent(text) {
  const q = String(text || '').toLowerCase().trim();
  if (!q) return [];
  const items = await listContent();
  const strip = (s) => String(s || '').replace(/<[^>]*>/g, ' ').toLowerCase();
  return items.filter((it) =>
    strip(it.current).includes(q) || (it.label && it.label.toLowerCase().includes(q)) || it.key.includes(q),
  ).slice(0, 40);
}

/** Rozdíl draft vs live — seznam změněných klíčů. */
export async function diffDraft() {
  const draft = await readJson(DRAFT);
  if (!draft) return [];
  const { reg, defaults } = await getRegistry();
  const live = await loadOverrides('live');
  const out = [];
  for (const [key, value] of Object.entries(draft.values || {})) {
    const before = (key in live) ? live[key] : defaults[key];
    if (String(before ?? '') !== String(value ?? '')) {
      const label = key === CUSTOM_CSS_KEY ? 'Vlastní vzhled (CSS)' : ((reg[key] && reg[key].label) || key);
      const page = key === CUSTOM_CSS_KEY ? 'vzhled' : (reg[key] && reg[key].page);
      out.push({ key, label, page, before, after: value });
    }
  }
  return out;
}

export async function hasDraft() {
  return exists(DRAFT);
}

// ---------- validace konceptu před zveřejněním ----------
export async function validateDraft() {
  const problems = [];
  const draft = await readJson(DRAFT);
  if (!draft) return { ok: true, problems, changes: 0 };
  const { reg } = await getRegistry();
  const changes = await diffDraft();
  for (const [key, value] of Object.entries(draft.values || {})) {
    if (key === CUSTOM_CSS_KEY) continue; // CSS je volný text, vkládá se sanitizovaně
    const meta = reg[key];
    if (!meta) { problems.push(`Neznámý klíč: ${key}`); continue; }
    const v = String(value ?? '');
    if ((meta.type === 'image' || meta.type === 'url') && !isSafeUrl(v)) problems.push(`Neplatná adresa u „${meta.label || key}".`);
    if (meta.type === 'text' && v.trim() === '') problems.push(`Prázdný text u „${meta.label || key}".`);
    if (/\b(\d{2,})\s*(\+|plus)\s*(klient|klientů|projekt|projektů|let|miliard|milion)/i.test(v)) {
      problems.push(`Pozor na možnou smyšlenou statistiku u „${meta.label || key}": „${v.slice(0, 60)}".`);
    }
  }
  return { ok: problems.length === 0, problems, changes: changes.length };
}

// ---------- publish / verze / revert ----------
async function pruneVersions(keep = MAX_VERSIONS) {
  let names = [];
  try { names = await fs.readdir(VERSIONS); } catch { return; }
  const files = names.filter((n) => n.endsWith('.json')).sort();
  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  await Promise.all(toDelete.map((n) => fs.rm(path.join(VERSIONS, n), { force: true })));
}

export async function publish(summary, actor) {
  const draft = await readJson(DRAFT);
  if (!draft) throw new Error('Není co zveřejnit — žádný koncept.');
  const live = {
    updatedAt: new Date().toISOString(),
    updatedBy: actor || 'admin',
    summary: String(summary || '').slice(0, 500),
    values: draft.values || {},
  };
  await writeAtomic(LIVE, live);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeAtomic(path.join(VERSIONS, `${stamp}.json`), live);
  await fs.rm(DRAFT, { force: true });
  await pruneVersions();
  return { publishedAt: live.updatedAt, summary: live.summary, version: `${stamp}.json` };
}

export async function listVersions() {
  let names = [];
  try { names = await fs.readdir(VERSIONS); } catch { return []; }
  const files = names.filter((n) => n.endsWith('.json')).sort().reverse().slice(0, 30);
  const out = [];
  for (const n of files) {
    const v = await readJson(path.join(VERSIONS, n));
    out.push({ version: n, updatedAt: v && v.updatedAt, updatedBy: v && v.updatedBy, summary: (v && v.summary) || '' });
  }
  return out;
}

export async function revert(version, actor) {
  let values, label, revertedTo;
  if (version) {
    const snap = await readJson(path.join(VERSIONS, version));
    if (!snap) throw new Error(`Verze „${version}" neexistuje.`);
    values = snap.values || {}; label = `Návrat na verzi ${version}`; revertedTo = version;
  } else {
    const list = await listVersions(); // newest first; list[0] = aktuálně živá verze
    if (list[1]) {
      const snap = await readJson(path.join(VERSIONS, list[1].version));
      values = (snap && snap.values) || {}; label = 'Vrácení poslední změny'; revertedTo = list[1].version;
    } else {
      // jen jedna (nebo žádná) zveřejněná verze → návrat na původní obsah z webu (bez přepisů)
      values = {}; label = 'Vrácení na původní obsah'; revertedTo = 'původní obsah';
    }
  }
  // ulož nový stav jako verzi (revert je revertovatelný)
  const live = {
    updatedAt: new Date().toISOString(),
    updatedBy: actor || 'admin',
    summary: label,
    values,
  };
  await writeAtomic(LIVE, live);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeAtomic(path.join(VERSIONS, `${stamp}.json`), live);
  await fs.rm(DRAFT, { force: true });
  await pruneVersions();
  return { revertedTo, at: live.updatedAt };
}

// ---------- obrázky ----------
const IMG_MAGIC = [
  { ext: 'webp', test: (b) => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: 'png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { ext: 'gif', test: (b) => b.length > 6 && b.slice(0, 6).toString('latin1').match(/^GIF8[79]a$/) },
];

function sniffImage(buf) {
  for (const m of IMG_MAGIC) if (m.test(buf)) return m.ext;
  return null;
}

function slugifyName(name) {
  return String(name || 'obrazek').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'obrazek';
}

/** Uloží nahraný obrázek (Buffer) na /data/cms/uploads. Vrací veřejnou cestu /data-uploads/<name>. */
export async function saveUpload(name, buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('Prázdný soubor.');
  if (buf.length > 5 * 1024 * 1024) throw new Error('Obrázek je větší než 5 MB.');
  const ext = sniffImage(buf);
  if (!ext) throw new Error('Nepodporovaný formát. Nahraj WebP, JPG, PNG nebo GIF.');
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const base = slugifyName(name.replace(/\.[a-z0-9]+$/i, ''));
  const fname = `${base}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, fname), buf, { flag: 'wx' });
  return { path: `/data-uploads/${fname}`, file: fname, bytes: buf.length };
}

export function uploadAbs(fileName) {
  if (!/^[a-z0-9][a-z0-9._-]*\.(webp|jpe?g|png|gif)$/i.test(fileName)) return null;
  const abs = path.join(UPLOADS_DIR, fileName);
  if (!abs.startsWith(UPLOADS_DIR + path.sep)) return null; // traversal guard
  return abs;
}

/** Obrázky dostupné v knihovně assets/img (pro výměnu). */
export async function listImages() {
  const dir = path.join(WEBROOT, 'assets', 'img');
  let names = [];
  try { names = await fs.readdir(dir); } catch {}
  const assets = names.filter((n) => /\.(webp|jpe?g|png|gif|svg)$/i.test(n)).map((n) => `/assets/img/${n}`);
  let ups = [];
  try { ups = (await fs.readdir(UPLOADS_DIR)).filter((n) => /\.(webp|jpe?g|png|gif)$/i.test(n)).map((n) => `/data-uploads/${n}`); } catch {}
  // klíče typu image z registru
  const { reg, defaults } = await getRegistry();
  const live = await loadOverrides('live');
  const slots = Object.values(reg).filter((m) => m.type === 'image')
    .map((m) => ({ key: m.key, label: m.label, page: m.page, current: (m.key in live) ? live[m.key] : defaults[m.key] }));
  return { slots, library: [...assets, ...ups] };
}

export function bustCache() {
  tplCache.clear();
  regCache = { sig: '', reg: null, defaults: null };
}
