// Vercel Function: POST /api/subscribe
// Captures the email, writes the contact to Mailchimp, tags it for attribution,
// and — only after a successful write — issues a signed 7-day access token for
// the gated download page. Mirrors server.mjs's logic exactly (see that file
// for the self-hosted equivalent); kept in sync deliberately.
import { createHash, createHmac, randomUUID } from 'node:crypto';

// Best-effort, single-instance rate limiting. Serverless instances are not
// shared, so this does not enforce a global limit — it only slows down abuse
// hitting the same warm instance. See README "Rate limiting" section.
const buckets = globalThis.__lgfBuckets || (globalThis.__lgfBuckets = new Map());

function limited(key) {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
  if (buckets.size > 10000) return true;
  const b = buckets.get(key) || { count: 0, until: now + 600000 };
  b.count++;
  buckets.set(key, b);
  return b.count > 10;
}

function issueToken(secret) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + 7 * 86400000, nonce: randomUUID() }),
  ).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}

async function provider(fetcher, url, body, method = 'POST', headers = {}) {
  const response = await fetcher(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Provider rejected request');
  return response.json();
}

// Factory so tests can inject a mock fetcher and an explicit env object
// (instead of reading process.env directly) — matches server.mjs's
// createApp(env, fetcher) pattern. The default export below wires up the
// real fetch + process.env for production use on Vercel.
export function createHandler(fetcher = fetch, env = process.env) {
  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use the email form to request your plan.' });
      return;
    }

    // CSRF check: only accept submissions whose Origin matches this deployment's
    // own host. Works automatically on preview URLs and any custom domain.
    const origin = `https://${req.headers.host}`;
    if (req.headers.origin !== origin) {
      res.status(403).json({ error: 'Please submit from the plan page.' });
      return;
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      res.status(415).json({ error: 'Invalid request.' });
      return;
    }

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    if (limited(ip)) {
      res.status(429).json({ error: 'Too many requests. Please try again in 10 minutes.' });
      return;
    }

    let input = req.body;
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch {
        res.status(400).json({ error: 'Invalid request.' });
        return;
      }
    }
    input = input || {};

    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (input.website || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (limited(createHash('sha256').update(email).digest('hex'))) {
      res.status(429).json({ error: 'Please wait 10 minutes before requesting again.' });
      return;
    }

    const secret = env.DOWNLOAD_SECRET || '';
    if (
      secret.length < 32 ||
      !env.MAILCHIMP_API_KEY ||
      !env.MAILCHIMP_AUDIENCE_ID ||
      !/^us\d+$/.test(env.MAILCHIMP_SERVER_PREFIX || '')
    ) {
      res.status(503).json({ error: 'The plan delivery service isn’t ready yet. Please try again later.' });
      return;
    }

    const hash = createHash('md5').update(email).digest('hex');
    const memberUrl = `https://${env.MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0/lists/${encodeURIComponent(
      env.MAILCHIMP_AUDIENCE_ID,
    )}/members/${hash}`;
    const auth = { Authorization: 'Basic ' + Buffer.from('lgf:' + env.MAILCHIMP_API_KEY).toString('base64') };

    // transactional = non-subscribed contact. Omit status so existing consent is never overwritten.
    try {
      await provider(fetcher, memberUrl, { email_address: email, status_if_new: 'transactional' }, 'PUT', auth);
    } catch {
      res.status(502).json({ error: 'We couldn’t save your request. Please try again shortly.' });
      return;
    }

    // A tag is attribution, not marketing permission. Tag failure never loses the download.
    try {
      await provider(
        fetcher,
        memberUrl + '/tags',
        { tags: [{ name: 'British Finals Lead Magnet – Bio', status: 'active' }] },
        'POST',
        auth,
      );
    } catch {}

    res.status(200).json({ downloadPageUrl: '/download.html?token=' + issueToken(secret) });
  };
}

export default createHandler();
