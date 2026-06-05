// POST /api/book — vytvoření rezervace (jeden termín na den, út/st/čt 15:00).
import { put, head } from '@vercel/blob';
import { isValidDate, formatCz, buildIcs, sendMail, SLOT_TIME } from './_shared.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { date, name, email, phone, note, web } = req.body || {};

    // honeypot — tiše projít
    if (web) return res.status(200).json({ ok: true });

    const cleanName = String(name || '').trim().slice(0, 120);
    const cleanEmail = String(email || '').trim().slice(0, 160);
    const cleanPhone = String(phone || '').trim().slice(0, 40);
    const cleanNote = String(note || '').trim().slice(0, 1000);

    if (!cleanName || cleanName.length < 3) {
      return res.status(400).json({ error: 'Vyplňte prosím jméno a příjmení.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Vyplňte prosím platný e-mail.' });
    }
    if (!isValidDate(String(date || ''))) {
      return res.status(400).json({ error: 'Neplatný termín. Vyberte úterý, středu nebo čtvrtek, nejdříve týden a nejpozději dva měsíce dopředu.' });
    }

    const pathname = `bookings/${date}.json`;

    // už obsazeno?
    try {
      await head(pathname);
      return res.status(409).json({ error: 'Tento termín byl právě obsazen. Vyberte prosím jiný.' });
    } catch { /* volno */ }

    const record = {
      date,
      time: SLOT_TIME,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      note: cleanNote,
      createdAt: new Date().toISOString(),
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    };

    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
    });

    const when = `${formatCz(date)} v ${SLOT_TIME}`;
    const ics = buildIcs({ date, name: cleanName, email: cleanEmail });

    // 1) notifikace poradci
    const notify = (process.env.NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (notify.length) {
      await sendMail({
        to: notify,
        replyTo: cleanEmail,
        subject: `Nová rezervace: ${when} — ${cleanName}`,
        ics,
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
    }

    // 2) potvrzení klientovi
    await sendMail({
      to: cleanEmail,
      replyTo: 'jan@kurdiovsky.cz',
      subject: `Potvrzení rezervace — ${when}`,
      ics,
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

    return res.status(200).json({ ok: true, date, time: SLOT_TIME, formatted: when });
  } catch (e) {
    console.error('book error', e);
    return res.status(500).json({ error: 'Rezervaci se nepodařilo dokončit. Zkuste to prosím znovu, nebo napište na jan@kurdiovsky.cz.' });
  }
}
