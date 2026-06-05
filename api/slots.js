// GET /api/slots — platné termíny (út/st/čt 15:00, +7 dní až +2 měsíce) + obsazenost.
import { validDates, bookedDates, SLOT_TIME, bookingWindow } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const booked = await bookedDates();
    const dates = validDates().map((date) => ({ date, available: !booked.has(date) }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ time: SLOT_TIME, window: bookingWindow(), dates });
  } catch (e) {
    console.error('slots error', e);
    return res.status(500).json({ error: 'Nepodařilo se načíst termíny.' });
  }
}
