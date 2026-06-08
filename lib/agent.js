// AI agent — OpenRouter tool-calling smyčka (DeepSeek V4 Flash přes Cloudflare) + denní budget guard.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TOOLS, GATED, dispatch, SYSTEM_PROMPT } from './tools.js';
import { ADMIN_DIR } from './audit.js';
import { getSiteCss } from './cms.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
const MAX_ITER = 16;
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD || 0.5);

// "Zjišťovací" nástroje — po stropu se modelu odeberou, aby musel provést změnu.
const READ_TOOLS = new Set(['inspect_design', 'list_content', 'search_content', 'get_content', 'list_images', 'list_versions', 'preview', 'validate_draft']);
// Po stropu zjišťování nabídneme JEN bezpečné akční nástroje a vynutíme jejich použití (tool_choice required).
const FORCE_TOOLS = TOOLS.filter((t) => ['set_content', 'set_image', 'set_custom_css', 'discard_draft'].includes(t.function?.name));
const READ_CAP = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date()); }
function costFile() { return path.join(ADMIN_DIR, `cost-${today()}.json`); }

export async function spentToday() {
  try { return JSON.parse(await fs.readFile(costFile(), 'utf8')); }
  catch { return { date: today(), calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }; }
}

async function addCost(usage) {
  const j = await spentToday();
  j.calls += 1;
  j.inputTokens += usage?.prompt_tokens || 0;
  j.outputTokens += usage?.completion_tokens || 0;
  const computed = ((usage?.prompt_tokens || 0) / 1e6) * 0.0983 + ((usage?.completion_tokens || 0) / 1e6) * 0.1966;
  j.usd += (typeof usage?.cost === 'number') ? usage.cost : computed;
  try { await fs.mkdir(ADMIN_DIR, { recursive: true }); await fs.writeFile(costFile(), JSON.stringify(j, null, 2)); }
  catch (e) { console.error('cost write failed', e); }
}

async function assertBudget() {
  const j = await spentToday();
  if (j.usd >= DAILY_BUDGET_USD) {
    throw new Error('Denní limit AI byl vyčerpán. Zkus to prosím zítra, nebo napiš Emilovi.');
  }
}

async function callOpenRouter(messages, tools = TOOLS, toolChoice = 'auto') {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Chybí OPENROUTER_API_KEY (nastav v Coolify env).');
  const RETRIABLE = new Set([408, 429, 500, 502, 503, 504]);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://kurdiovsky.cz',
          'X-Title': 'Kurdiovsky CMS',
        },
        body: JSON.stringify({
          model: MODEL,
          ...(MODEL.includes('deepseek') ? { provider: { only: ['Cloudflare'] } } : {}),
          messages,
          tools,
          tool_choice: toolChoice,
          temperature: 0.2,
          max_tokens: 1500,
          usage: { include: true },
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        if (RETRIABLE.has(r.status) && attempt < 2) { await sleep(400 * 2 ** attempt); continue; }
        throw new Error(`OpenRouter ${r.status}: ${txt.slice(0, 200)}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await sleep(400 * 2 ** attempt); continue; }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/**
 * Spustí jednu uživatelskou výměnu. history = předchozí zprávy (bez systémové).
 * Vrací { reply, staged, convo } — convo = nová historie (bez systémové) pro další kolo.
 */
export async function runAgent({ history = [], userText, ctx = {}, onStep }) {
  await assertBudget();
  const css = await getSiteCss();
  const sys = SYSTEM_PROMPT + (css
    ? `\n\n## SKUTEČNÉ CSS WEBU (používej tyto reálné selektory v set_custom_css — NEHÁDEJ vlastní názvy tříd):\n${css}`
    : '');
  const convo = [{ role: 'system', content: sys }, ...history, { role: 'user', content: userText }];
  let staged = false;
  const seen = new Map(); // ochrana proti zacyklení na opakovaném dotazu
  let reads = 0; // počet "zjišťovacích" volání → po stropu odebereme čtecí nástroje

  for (let i = 0; i < MAX_ITER; i++) {
    const force = reads >= READ_CAP; // po stropu: jen akční nástroje + musí je použít
    const resp = await callOpenRouter(convo, force ? FORCE_TOOLS : TOOLS, force ? 'required' : 'auto');
    if (resp.usage) await addCost(resp.usage);
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error('Prázdná odpověď modelu.');
    convo.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content || '', staged, convo: convo.slice(1) };
    }

    for (const call of msg.tool_calls) {
      const fname = call.function?.name;
      const sig = `${fname}:${call.function?.arguments || ''}`;
      const repeat = (seen.get(sig) || 0) + 1;
      seen.set(sig, repeat);
      let result;
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        if (repeat >= 2) {
          // už voláno se stejnými parametry → netoč se dokola, postrč k akci
          result = { note: 'Tohle už jsi volal se stejnými parametry — výsledek se nezmění. Neopakuj dotazy. Pokud máš dost informací, PROVEĎ změnu: u vzhledu zavolej set_custom_css, u textu set_content. Jinak rovnou napiš odpověď uživateli.' };
        } else if (READ_TOOLS.has(fname) && reads >= READ_CAP) {
          // strop na zjišťování → vynuť akci (řeší inspect-spam u větších změn)
          result = { note: `Už jsi ${reads}× zjišťoval — to stačí. NEZJIŠŤUJ dál. Hned PROVEĎ změnu: u vzhledu zavolej set_custom_css (napiš CSS, klidně nejlepší odhad podle toho, co už víš), u textu set_content. Můžeš provést i víc změn najednou. Pak napiš uživateli shrnutí.` };
        } else if (GATED.has(fname)) {
          result = { requiresHumanConfirm: true, note: 'Tuto akci musí potvrdit člověk tlačítkem (Zveřejnit / Vrátit).' };
        } else {
          if (READ_TOOLS.has(fname)) reads++;
          result = await dispatch(fname, args, ctx);
          if (fname === 'set_content' || fname === 'set_image' || fname === 'set_custom_css') staged = true;
        }
      } catch (e) {
        result = { error: String(e.message || e).slice(0, 400) };
      }
      onStep?.({ name: fname, args: call.function?.arguments, result });
      convo.push({ role: 'tool', tool_call_id: call.id, name: fname, content: JSON.stringify(result).slice(0, 8000) });
    }
  }

  return {
    reply: staged
      ? 'Část změn jsem připravil do konceptu — mrkni na náhled. Jestli něco chybí, napiš mi to prosím ještě jednou, klidně jednou větou.'
      : 'Nestihl jsem to dokončit. Zkus to prosím napsat jednodušeji nebo po jedné změně.',
    staged, convo: convo.slice(1), truncated: true,
  };
}
