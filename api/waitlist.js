// /api/waitlist — server-side waitlist signup for collabaroo.app
//
// Inserts one row into public.waitlist in Supabase using the SERVICE-ROLE key.
// The service-role key bypasses Row Level Security, so the table can stay
// locked down (RLS on, no anon/authenticated policies). This code runs ONLY
// on the server — the service-role key is read from a server-only env var and
// must NEVER be sent to the browser or given a NEXT_PUBLIC_/client prefix.
//
// No external dependencies: talks to Supabase's REST API (PostgREST) with the
// runtime's built-in fetch, so the static site needs no package.json/build.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Normalise an Indian mobile down to 10 digits (drop +91 / leading 0 / spaces).
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  else if (d.length > 10) d = d.slice(-10);
  return d;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('waitlist: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured.' });
  }

  // Parse the JSON body (Vercel usually pre-parses it into req.body).
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  // Server-side validation — client validation is UX only, this is the gate.
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const instagram = String(body.instagram || '').trim().replace(/^@+/, '');
  const whatsapp = normalizePhone(body.whatsapp);
  const source = body.source ? String(body.source).trim().slice(0, 100) : null;

  if (name.length < 2 || name.length > 120) {
    return res.status(400).json({ error: 'Enter your name.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!instagram) {
    return res.status(400).json({ error: 'Enter your social handle.' });
  }
  if (!/^[6-9]\d{9}$/.test(whatsapp)) {
    return res.status(400).json({ error: 'Enter a 10-digit mobile number.' });
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ name, email, instagram, whatsapp, source }),
    });

    if (resp.ok) {
      return res.status(200).json({ ok: true });
    }

    // A duplicate WhatsApp trips the unique constraint. That means the person
    // is ALREADY on the list — treat it as success, show the same thank-you.
    const detail = await resp.text();
    if (resp.status === 409 || detail.includes('23505')) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    console.error('waitlist: supabase insert failed', resp.status, detail);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  } catch (err) {
    console.error('waitlist: insert error', err);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }
};
