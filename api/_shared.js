// Sdílená logika rezervací — termíny út/st/čt 15:00, min 7 dní a max 2 měsíce dopředu.
import { list } from '@vercel/blob';

export const SLOT_TIME = '15:00';
export const SLOT_DAYS = [2, 3, 4]; // út, st, čt (UTC day-of-week na poledním kotvení)
export const MIN_DAYS_AHEAD = 7;
export const MAX_MONTHS_AHEAD = 2;

/** Dnešní datum v Europe/Prague jako YYYY-MM-DD. */
export function pragueToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date());
}

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso, months) {
  const [y, m, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, day, 12));
  // přetečení (např. 31. + měsíc s 30 dny) srovnat na poslední den měsíce
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function bookingWindow() {
  const today = pragueToday();
  return { min: addDays(today, MIN_DAYS_AHEAD), max: addMonths(today, MAX_MONTHS_AHEAD) };
}

export function isSlotDay(iso) {
  return SLOT_DAYS.includes(new Date(iso + 'T12:00:00Z').getUTCDay());
}

/** Všechny platné termíny v okně (út/st/čt), vzestupně. */
export function validDates() {
  const { min, max } = bookingWindow();
  const out = [];
  for (let d = min; d <= max; d = addDays(d, 1)) {
    if (isSlotDay(d)) out.push(d);
  }
  return out;
}

export function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { min, max } = bookingWindow();
  return iso >= min && iso <= max && isSlotDay(iso);
}

/** Seznam už obsazených termínů (pathname bookings/<date>.json). */
export async function bookedDates() {
  const out = new Set();
  let cursor;
  do {
    const res = await list({ prefix: 'bookings/', cursor, limit: 1000 });
    for (const b of res.blobs) {
      const m = b.pathname.match(/^bookings\/(\d{4}-\d{2}-\d{2})\.json$/);
      if (m) out.add(m[1]);
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return out;
}

const CZ_DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const CZ_MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

export function formatCz(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return `${CZ_DAYS[d.getUTCDay()]} ${d.getUTCDate()}. ${CZ_MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ICS pozvánka (Europe/Prague, 15:00–16:00). */
export function buildIcs({ date, name, email }) {
  const dt = date.replaceAll('-', '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//kurdiovsky.cz//rezervace//CS',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Prague',
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:rezervace-${date}@kurdiovsky.cz`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Prague:${dt}T150000`,
    `DTEND;TZID=Europe/Prague:${dt}T160000`,
    `SUMMARY:Konzultace — ${name}`,
    'LOCATION:Tolstého 35\\, 616 00 Brno (případně online)',
    `DESCRIPTION:Konzultace s Janem Kurdiovským.\\nKlient: ${name} (${email})`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Odeslání e-mailu přes Resend. */
export async function sendMail({ to, replyTo, subject, html, ics }) {
  const body = {
    from: process.env.FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo) body.reply_to = replyTo;
  if (ics) {
    body.attachments = [{
      filename: 'konzultace.ics',
      content: Buffer.from(ics).toString('base64'),
    }];
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Resend ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}
