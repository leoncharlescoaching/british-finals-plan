// Vercel Function: GET /api/plan?token=...
// Validates the signed access token issued by /api/subscribe, then mints a
// short-lived (5 minute) Vercel Blob presigned GET URL for the private PDF.
// The browser downloads directly from Blob storage — the 33MB file never
// passes through this function's response, so it isn't subject to Vercel's
// 4.5MB function response limit. See README "Why Vercel Blob" section.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { issueSignedToken, presignUrl } from '@vercel/blob';

const PDF_PATHNAME = 'Leon-Charles-British-Finals-Plan.pdf';

function validToken(value, secret) {
  if (secret.length < 32 || !value || value.length > 512) return false;
  try {
    const [p, s, ...extra] = value.split('.');
    if (extra.length || !p || !s) return false;
    const expected = createHmac('sha256', secret).update(p).digest();
    const provided = Buffer.from(s, 'base64url');
    return (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected) &&
      JSON.parse(Buffer.from(p, 'base64url')).exp > Date.now()
    );
  } catch {
    return false;
  }
}

// Factory so tests can inject a mock Blob client and an explicit env object
// instead of reading process.env directly. The default export below wires up
// the real @vercel/blob functions + process.env for production use on Vercel.
export function createHandler(blob = { issueSignedToken, presignUrl }, env = process.env) {
  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    if (!['GET', 'HEAD'].includes(req.method)) {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const secret = env.DOWNLOAD_SECRET || '';
    const tokenParam = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
    if (!validToken(tokenParam, secret)) {
      res
        .status(403)
        .json({ error: 'This download link is missing or has expired. Request your plan again from the home page.' });
      return;
    }

    if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) {
      res.status(503).json({ error: 'The plan delivery service isn’t ready yet. Please try again later.' });
      return;
    }

    try {
      const signed = await blob.issueSignedToken({
        pathname: PDF_PATHNAME,
        operations: ['get'],
        validUntil: Date.now() + 5 * 60 * 1000,
      });
      const { presignedUrl } = await blob.presignUrl(signed, {
        operation: 'get',
        pathname: PDF_PATHNAME,
        access: 'private',
        validUntil: Date.now() + 5 * 60 * 1000,
      });
      res.status(200).json({ url: presignedUrl });
    } catch (err) {
      // Logged server-side only (visible in Vercel's Runtime Logs) — never sent to the client.
      console.error('[plan] Blob presign failed:', err?.message || err);
      res.status(502).json({ error: 'We couldn’t prepare your download. Please try again shortly.' });
    }
  };
}

export default createHandler();
