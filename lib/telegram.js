// Telegram bot — long-poll, zamčený na jeden chat (TELEGRAM_CHAT_ID). Sdílí AI agenta.
// Jan napíše česky → koncept → bot pošle náhled + inline tlačítka Zveřejnit / Vrátit / Zahodit.
import { runAgent } from './agent.js';
import * as cms from './cms.js';
import { audit } from './audit.js';
import { previewToken } from './admin-auth.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://kurdiovsky.cz';

let history = [];
let started = false;

function api(method) { return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`; }
async function tg(method, params) {
  try {
    const r = await fetch(api(method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
    return r.json();
  } catch (e) { console.error('tg', method, e?.message || e); return { ok: false }; }
}
function allowed(id) { return id != null && String(id) === String(process.env.TELEGRAM_CHAT_ID); }
function previewUrl() { return `${PUBLIC_BASE}/admin/preview/index?t=${previewToken()}`; }

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text) return;
  if (text === '/start' || text === '/reset') {
    history = [];
    return void tg('sendMessage', { chat_id: chatId, text: 'Ahoj! Napiš mi vlastními slovy, co chceš na webu kurdiovsky.cz změnit (např. „změň telefon na 777 123 456"). Připravím koncept a pošlu náhled + tlačítka.' });
  }
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const out = await runAgent({ history, userText: text, ctx: { actor: `telegram:${chatId}`, previewUrl: previewUrl() } });
    history = (out.convo || []).slice(-24);
    await audit({ actor: `telegram:${chatId}`, channel: 'telegram', action: 'chat', text: text.slice(0, 200) });
    const changes = await cms.diffDraft();
    if (changes.length) {
      const list = changes.map((c) => `• ${c.label || c.key}`).join('\n');
      await tg('sendMessage', {
        chat_id: chatId,
        text: `${out.reply || 'Připraveno.'}\n\nZměny v konceptu:\n${list}\n\nNáhled: ${previewUrl()}`,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[
          { text: '✅ Zveřejnit', callback_data: 'pub' },
          { text: '↩ Vrátit', callback_data: 'rev' },
          { text: '🗑 Zahodit', callback_data: 'dis' },
        ]] },
      });
    } else {
      await tg('sendMessage', { chat_id: chatId, text: out.reply || 'Hotovo.' });
    }
  } catch (e) {
    await tg('sendMessage', { chat_id: chatId, text: '⚠️ ' + String(e.message || e).slice(0, 300) });
  }
}

async function onCallback(cq) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data;
  try {
    if (data === 'pub') {
      const v = await cms.validateDraft();
      if (!v.ok) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Koncept má problémy.', show_alert: true });
        return void tg('sendMessage', { chat_id: chatId, text: 'Nelze zveřejnit:\n' + v.problems.join('\n') });
      }
      if (v.changes === 0) {
        return void tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Není co zveřejnit.', show_alert: true });
      }
      const r = await cms.publish('Úprava přes Telegram', `telegram:${chatId}`);
      cms.bustCache(); history = [];
      await audit({ actor: `telegram:${chatId}`, channel: 'telegram', action: 'publish', version: r.version });
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Zveřejněno ✅' });
      await tg('sendMessage', { chat_id: chatId, text: '✅ Změny jsou na webu kurdiovsky.cz.' });
    } else if (data === 'rev') {
      const r = await cms.revert(undefined, `telegram:${chatId}`); cms.bustCache();
      await audit({ actor: `telegram:${chatId}`, channel: 'telegram', action: 'revert', version: r.revertedTo });
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Vráceno ↩' });
      await tg('sendMessage', { chat_id: chatId, text: '↩ Web vrácen na předchozí verzi.' });
    } else if (data === 'dis') {
      await cms.discardDraft(); history = [];
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Zahozeno' });
      await tg('sendMessage', { chat_id: chatId, text: '🗑 Koncept zahozen, na webu se nic nezměnilo.' });
    } else {
      await tg('answerCallbackQuery', { callback_query_id: cq.id });
    }
  } catch (e) {
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Chyba', show_alert: true });
    await tg('sendMessage', { chat_id: chatId, text: '⚠️ ' + String(e.message || e).slice(0, 300) });
  }
}

export function startTelegram() {
  if (started) return;
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  started = true;
  (async function loop() {
    let offset = 0;
    try { await tg('deleteWebhook', { drop_pending_updates: false }); } catch {}
    for (;;) {
      try {
        const res = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
        if (res && res.ok && Array.isArray(res.result)) {
          for (const u of res.result) {
            offset = u.update_id + 1;
            const id = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
            if (!allowed(id)) continue; // zámek na jeden chat — cizí tiše ignorovat
            if (u.message) await onMessage(u.message);
            else if (u.callback_query) await onCallback(u.callback_query);
          }
        } else if (res && !res.ok) {
          await sleep(3000);
        }
      } catch (e) {
        console.error('telegram poll', e?.message || e);
        await sleep(3000);
      }
    }
  })();
  console.log(`Telegram bot spuštěn (long-poll, zamčen na chat ${process.env.TELEGRAM_CHAT_ID}).`);
}
