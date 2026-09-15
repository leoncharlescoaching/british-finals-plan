# Look Good Fitness — British Finals plan

Email-only form → contact saved in Mailchimp → protected download page → automatic PDF download, with a manual button as fallback. No guide emails or paid transactional add-on.

## Deploy to Vercel (the live path)

This is what's actually deployed. `server.mjs` further down this file is a
self-hosted alternative kept for portability — it isn't used on Vercel and
you can ignore it unless you ever want to run this somewhere other than
Vercel.

**Why not just upload the old server as-is:** Vercel Functions cap every
response at 4.5 MB. The plan PDF is ~33 MB, so streaming it straight from a
Vercel Function (the way `server.mjs` does from local disk) fails outright.
The fix here is [Vercel Blob](https://vercel.com/docs/vercel-blob) private
storage: the PDF lives there instead of in this repo, and `/api/plan` mints a
short-lived signed URL that the browser downloads **directly from Blob
storage** — the file itself never passes through a Function response, so the
4.5 MB limit never applies. Everything else (email capture, Mailchimp write,
tagging, the signed 7-day access token, rate limiting, honeypot, CSP headers)
works exactly as it did before.

### One-time setup, in order

1. **Import the repo into Vercel** (if not already): Vercel dashboard → Add
   New → Project → pick this GitHub repo. Framework preset: "Other" (no
   build command needed — it's static files + `api/` functions).
2. **Create a private Blob store**: in the project → Storage tab → Create
   Database → Blob → set access to **Private** → connect it to this project.
   This automatically adds `BLOB_STORE_ID` to the project's environment —
   no token needed in production, the functions authenticate via Vercel's
   built-in OIDC.
3. **Set these environment variables** in Project Settings → Environment
   Variables:
   - `DOWNLOAD_SECRET` — a random 64-char hex string (generate with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `MAILCHIMP_API_KEY`
   - `MAILCHIMP_SERVER_PREFIX` (`us5`)
   - `MAILCHIMP_AUDIENCE_ID` (`b895da0481`, the LGF audience)

   `PUBLIC_BASE_URL` is **not** needed on Vercel — the functions read the
   request's own `Host` header, so it works automatically on preview URLs
   and any custom domain without extra config.
4. **Upload the PDF to Blob storage** (one-time, or whenever the PDF
   changes): from your machine, with the Vercel CLI installed and logged in
   (`npm i -g vercel && vercel login && vercel link` inside this folder),
   grab a read-write token from the Blob store's ".env.local" tab in the
   dashboard, then run:
   ```sh
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx node scripts/upload-pdf-to-blob.mjs
   ```
   This uploads `private/british-finals-plan.pdf` as a **private** blob
   named `Leon-Charles-British-Finals-Plan.pdf`. Re-run it (it overwrites)
   whenever the PDF content changes.
5. **Deploy** (push to the connected branch, or `vercel --prod`). Test by
   submitting your own email on the live URL and confirming the PDF
   downloads.

### Rate limiting on Vercel

`api/subscribe.js` keeps the same in-memory limiter as `server.mjs`, but
serverless instances aren't shared — this slows down abuse hitting the same
warm instance, it doesn't enforce a hard global cap. Fine for normal bio-link
traffic; if this ever gets hit by a coordinated bot run, add a proper
distributed limiter (Vercel Firewall rules, or Upstash Redis) rather than
relying on this alone.

### What's in `api/`

- `api/subscribe.js` — `POST /api/subscribe`, same validation/Mailchimp
  logic as `server.mjs`'s route of the same name.
- `api/plan.js` — `GET /api/plan?token=...`, validates the access token and
  returns `{ url }`, a 5-minute presigned Blob URL. `download.js` on the
  front end fetches this and redirects the browser to it directly.

Both export a `createHandler(...)` factory for testing (see
`tests/vercel-api.test.mjs`) and a wired-up `default` export for Vercel.


## Mailchimp setup

Configured and checked in Leon’s account:

- Existing audience: **LGF**
- Audience ID: `b895da0481`
- Server prefix: `us5`
- New source tag: **British Finals Lead Magnet – Bio** (created)
- Only email is required; all six other audience fields are optional.
- Existing sender: `leon@lookgoodfitness.co.uk`; marketing domain is authenticated.

Still needed: a dedicated Mailchimp Marketing API key, saved only as a server secret. No credentials are included in this package. The existing ManyChat source tag is unchanged.

New contacts are stored as **non-subscribed**, using Mailchimp’s API status `transactional` (this status name does not enable or require the paid Transactional service). Existing contacts retain their existing subscription status. Downloading does not grant new marketing permission. Do not use the source tag alone to enrol contacts in marketing automations.

## Self-hosted alternative (not used on Vercel)

Everything below this point describes `server.mjs`, a standalone Node
server that does the same job by streaming the PDF from local disk. It's
kept in the repo as a portable fallback in case this ever needs to move off
Vercel, but it is not what's deployed — see "Deploy to Vercel" above for the
live setup. If you're just trying to get the live site working, you can stop
reading here.

## Run and deploy

Use Node.js 22 or later. In this folder:

```sh
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save that random value as `DOWNLOAD_SECRET` in `.env`; add your `MAILCHIMP_API_KEY`. Audience and server prefix are already filled in. Keep `.env` private and out of GitHub/source downloads.

```sh
npm start
```

Open http://localhost:3000. Without credentials, the page reports that the service is not ready; it never pretends to capture an email.

For deployment, use a Node/container host, set `PUBLIC_BASE_URL` to the exact HTTPS origin (no path), set the same environment variables in the host’s secret settings, and start with `npm start`. No dependency installation or build step is necessary. This is not a static-only upload or a drop-in Vercel Function: the included backend streams the private 33 MB PDF. A dedicated Node-hosted subdomain can be linked from the existing Vercel site.

Docker is also supported:

```sh
docker build -t look-good-fitness .
docker run --env-file .env -p 3000:3000 look-good-fitness
```

Keep the repository/container image private because it includes the guide. Publish only the running website.

## Access flow

The server validates the email, saves the contact in Mailchimp, then attempts the source tag. Only a successful contact write returns a signed download-page URL. Tagging failure does not lose an already captured visitor’s access. The page verifies the signature and opens `/api/download` automatically. Browsers may ask the visitor to confirm a download or show the PDF; the prominent manual download button remains available.

Both the download page and the PDF endpoint require a valid signed token. Links expire after seven days; expired page links return to the form. Links are shareable bearer links, not DRM. The form checks email syntax but does not verify mailbox ownership. No emails are sent by this code.

## Before launch

- Add the API key, secret and final public URL; test saving your own email and downloading the PDF.
- Set host/edge rate limiting on `/api/subscribe`. Built-in limits are in-memory and use the socket address; behind a reverse proxy, users can share that address. Use trusted client-IP handling or edge limits before a campaign, and a shared limiter for multiple instances.
- Confirm the privacy text matches your actual processing and retention policy. Apply a retention/deletion process in Mailchimp; this app does not purge stored contacts automatically.
- Avoid logging download query strings because they contain temporary access tokens.

## Validation

```sh
npm run check
npm test
```

Tests use mock Mailchimp responses: capture-before-access, invalid email, honeypot rejection, missing configuration, provider failure, private-file protection, signature tampering, protected download page and no implicit subscription. A live API test remains pending until a key is connected.

## Files and assets

`public/` contains the page, styling, scripts and imagery. `server.mjs` provides capture and private downloads. `private/british-finals-plan.pdf` is the original guide. Artwork and logo come from the supplied PDF. Anton is bundled under the SIL Open Font License in `FONT-LICENSE.txt`; fonts are served locally.
