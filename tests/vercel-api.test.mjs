// Tests for the Vercel Functions in api/ (the deployed path). These mock the
// Mailchimp fetch and the @vercel/blob calls directly, since this environment
// has no network access to either service. See tests/flow.test.mjs for the
// equivalent coverage of the self-hosted server.mjs path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createHandler as createSubscribeHandler } from '../api/subscribe.js';
import { createHandler as createPlanHandler } from '../api/plan.js';

const env = {
  DOWNLOAD_SECRET: 'a'.repeat(64),
  MAILCHIMP_API_KEY: 'test-us1',
  MAILCHIMP_AUDIENCE_ID: 'test',
  MAILCHIMP_SERVER_PREFIX: 'us1',
  BLOB_STORE_ID: 'store_test',
};

// Minimal Vercel-style req/res mock: res.status().json() chain, headers map.
function mockReqRes({ method = 'GET', headers = {}, body, query = {} } = {}) {
  const res = {
    _status: 200,
    _headers: {},
    _body: undefined,
    setHeader(k, v) {
      this._headers[k] = v;
    },
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._body = data;
      return this;
    },
  };
  const req = { method, headers, body, query, socket: { remoteAddress: '127.0.0.1' } };
  return { req, res };
}

test('subscribe: happy path writes Mailchimp contact as transactional, tags it, issues token', async () => {
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
  const handler = createSubscribeHandler(fetcher, env);
  const { req, res } = mockReqRes({
    method: 'POST',
    headers: { host: 'plan.example.com', origin: 'https://plan.example.com', 'content-type': 'application/json' },
    body: { email: 'LEON@Example.com' },
  });
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.match(res._body.downloadPageUrl, /^\/download\.html\?token=/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.email_address, 'leon@example.com');
  assert.equal(calls[0].body.status_if_new, 'transactional');
  assert.equal('status' in calls[0].body, false);
  assert.equal(calls[1].url.endsWith('/tags'), true);
});

test('subscribe: rejects bad CSRF origin, invalid email, honeypot, and provider failure', async () => {
  const okFetcher = async () => ({ ok: true, json: async () => ({}) });
  const failFetcher = async () => {
    throw new Error('offline');
  };
  const baseHeaders = { host: 'plan.example.com', origin: 'https://plan.example.com', 'content-type': 'application/json' };

  let { req, res } = mockReqRes({ method: 'POST', headers: { ...baseHeaders, origin: 'https://evil.example.com' }, body: { email: 'a@example.com' } });
  await createSubscribeHandler(okFetcher, env)(req, res);
  assert.equal(res._status, 403);

  ({ req, res } = mockReqRes({ method: 'POST', headers: baseHeaders, body: { email: 'not-an-email' } }));
  await createSubscribeHandler(okFetcher, env)(req, res);
  assert.equal(res._status, 400);

  ({ req, res } = mockReqRes({ method: 'POST', headers: baseHeaders, body: { email: 'a@example.com', website: 'bot-filled-this' } }));
  await createSubscribeHandler(okFetcher, env)(req, res);
  assert.equal(res._status, 400);

  ({ req, res } = mockReqRes({ method: 'POST', headers: baseHeaders, body: { email: 'a@example.com' } }));
  await createSubscribeHandler(failFetcher, env)(req, res);
  assert.equal(res._status, 502);
  assert.equal(res._body.downloadPageUrl, undefined);
});

test('subscribe: fails closed (503) when Mailchimp config is missing', async () => {
  const brokenEnv = { ...env, MAILCHIMP_API_KEY: '', MAILCHIMP_AUDIENCE_ID: '', MAILCHIMP_SERVER_PREFIX: '' };
  const { req, res } = mockReqRes({
    method: 'POST',
    headers: { host: 'plan.example.com', origin: 'https://plan.example.com', 'content-type': 'application/json' },
    body: { email: 'a@example.com' },
  });
  await createSubscribeHandler(async () => {
    throw new Error('should not be called');
  }, brokenEnv)(req, res);
  assert.equal(res._status, 503);
});

function issueRealToken(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 86400000, nonce: randomUUID() })).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}

test('plan: valid token returns a presigned URL; invalid or missing token is rejected', async () => {
  const token = issueRealToken(env.DOWNLOAD_SECRET);

  const blobCalls = [];
  const mockBlob = {
    issueSignedToken: async (opts) => {
      blobCalls.push(['issueSignedToken', opts]);
      return { delegationToken: 'd', clientSigningToken: 's', validUntil: Date.now() + 1000 };
    },
    presignUrl: async (signed, opts) => {
      blobCalls.push(['presignUrl', opts]);
      return { presignedUrl: 'https://store.private.blob.vercel-storage.com/ThePlanThatGotMeToTheBritishFinals.pdf?sig=abc' };
    },
  };

  let { req, res } = mockReqRes({ method: 'GET', query: { token } });
  await createPlanHandler(mockBlob, env)(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.url, 'https://store.private.blob.vercel-storage.com/ThePlanThatGotMeToTheBritishFinals.pdf?sig=abc');
  assert.equal(blobCalls[0][1].pathname, 'ThePlanThatGotMeToTheBritishFinals.pdf');
  assert.equal(blobCalls[1][1].access, 'private');

  ({ req, res } = mockReqRes({ method: 'GET', query: { token: 'garbage' } }));
  await createPlanHandler(mockBlob, env)(req, res);
  assert.equal(res._status, 403);

  ({ req, res } = mockReqRes({ method: 'GET', query: {} }));
  await createPlanHandler(mockBlob, env)(req, res);
  assert.equal(res._status, 403);
});

test('plan: fails closed (503) when Blob storage isn’t connected', async () => {
  const brokenEnv = { ...env, BLOB_STORE_ID: '', BLOB_READ_WRITE_TOKEN: '' };
  const token = issueRealToken(env.DOWNLOAD_SECRET);
  const { req, res } = mockReqRes({ method: 'GET', query: { token } });
  await createPlanHandler(
    {
      issueSignedToken: async () => {
        throw new Error('should not be called');
      },
      presignUrl: async () => {
        throw new Error('should not be called');
      },
    },
    brokenEnv,
  )(req, res);
  assert.equal(res._status, 503);
});
