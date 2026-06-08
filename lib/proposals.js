// Tier-2: návrhy strukturálních/kódových změn (ukládají se, nasazuje je správce).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ADMIN_DIR } from './audit.js';

const DIR = path.join(ADMIN_DIR, 'proposals');

export async function save({ title, explanation, files, diff, actor }) {
  await fs.mkdir(DIR, { recursive: true });
  const id = 'p-' + Date.now();
  const rec = {
    id,
    title: String(title || '').slice(0, 200),
    explanation: String(explanation || '').slice(0, 4000),
    files: Array.isArray(files) ? files.slice(0, 30) : [],
    diff: String(diff || '').slice(0, 40000),
    actor: actor || 'ai',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(DIR, id + '.json'), JSON.stringify(rec, null, 2));
  return { id, status: 'pending', note: 'Návrh změny kódu uložen. Strukturální úpravu zkontroluje a nasadí správce (Emil).' };
}

export async function list() {
  let names = [];
  try { names = await fs.readdir(DIR); } catch { return []; }
  const out = [];
  for (const n of names.filter((n) => n.endsWith('.json')).sort().reverse()) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8'))); } catch {}
  }
  return out;
}
