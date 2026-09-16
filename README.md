# Look Good Fitness — British Finals plan

Email-only form → contact saved in Mailchimp → protected download page → automatic PDF download, with a manual button as fallback. Optional marketing opt-in is included. No guide emails or paid transactional add-on.

## Mailchimp setup

Configured and checked in Leon’s account:

- Existing audience: **LGF**
- Audience ID: `b895da0481`
- Server prefix: `us5`
- New source tag: **British Finals Lead Magnet – Bio** (created)
- Only email is required; all six other audience fields are optional.
- Existing sender: `leon@lookgoodfitness.co.uk`; marketing domain is authenticated.

A key named British Finals Bio Page was created in Mailchimp, but the private connection was interrupted before it could be saved here. A usable key still needs to be added to the deployment’s server secrets. No credentials are included in this package. The existing ManyChat source tag is unchanged.

Visitors who tick the optional, initially unticked marketing box have their consent wording, version, UTC timestamp and source saved as a Mailchimp contact note before their status is changed to **subscribed**. The backend confirms the returned status before redirecting. Without that choice, new contacts remain non-subscribed and existing subscription status is preserved. Download access remains available without marketing consent. No historical contacts are bulk-resubscribed. Mailchimp may reject a resubscription for certain suppressed contacts; the form reports that accurately. Use Email Marketing = Subscribed when selecting recipients; the source tag alone is not proof of permission.

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

All six automated checks passed, and the checked opt-in → download-page flow was verified in the browser with a mock provider. Tests use mock Mailchimp responses: capture-before-access, invalid email, honeypot rejection, missing configuration, provider failure, private-file protection, signature tampering, protected download page and no implicit subscription. A live API test remains pending until a key is connected.

## Files and assets

`public/` contains the page, styling, scripts and imagery. `server.mjs` provides capture and private downloads. `private/british-finals-plan.pdf` is the original guide. Artwork and logo come from the supplied PDF. Anton is bundled under the SIL Open Font License in `FONT-LICENSE.txt`; fonts are served locally.

Consent implementation reference: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/
