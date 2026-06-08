// Append-only audit log + adresář admin dat na /data.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const ADMIN_DIR = process.env.ADMIN_DATA_DIR || path.join(process.cwd(), 'data', 'admin');
const LOG = path.join(ADMIN_DIR, 'audit.log');

export async function audit(entry) {
  try {
    await fs.mkdir(ADMIN_DIR, { recursive: true });
    await fs.appendFile(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error('audit failed', e);
  }
}

export async function recentAudit(n = 50) {
  try {
    const txt = await fs.readFile(LOG, 'utf8');
    return txt.trim().split('\n').slice(-n).reverse()
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}
