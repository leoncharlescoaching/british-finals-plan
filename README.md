# Look Good Fitness — British Finals lead magnet

A complete mobile-first page and Node.js server. Includes the original 10-page PDF, Leon’s artwork and logo extracted from the PDF, local typography, email capture, and a protected download endpoint. No third-party JavaScript, analytics or package dependencies.

## Start locally

Install Node.js 22 or newer. In this folder:

```sh
cp .env.example .env
npm start
```

Open http://localhost:3000. The design works immediately. Without Mailchimp credentials and a download secret, submissions show a truthful service-unavailable message. There is no fake production success mode.

## Connect Mailchimp

Set the following in `.env` locally or your host’s secret/environment settings:

| Variable | Value |
| --- | --- |
| `PUBLIC_BASE_URL` | Exact public origin, e.g. `https://plan.your-domain.co.uk`; no path or trailing slash |
| `DOWNLOAD_SECRET` | Random secret, at least 32 characters; use the generation command below |
| `MAILCHIMP_API_KEY` | Mailchimp Marketing API key |
| `MAILCHIMP_SERVER_PREFIX` | Server prefix from the key, such as `us1` |
| `MAILCHIMP_AUDIENCE_ID` | Audience ID with email as its only required signup field |
| `MAILCHIMP_TRANSACTIONAL_KEY` | Optional Mailchimp Transactional/Mandrill key for automatic delivery |
| `FROM_EMAIL` | Authenticated sender; defaults in the example to `leon@lookgoodfitness.co.uk` |

Generate a download secret:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep keys on the server. Never put them in `public/` or share `.env`.

### What happens on submission

1. Validate the request, email and honeypot on the server.
2. Add/update the Mailchimp contact using `status_if_new: transactional` (Mailchimp’s **non-subscribed** status). Existing subscription status is preserved; this request never grants new marketing consent.
3. Attempt to attach the attribution tag `British Finals Lead Magnet – Bio`. Tagging failure does not prevent delivery after the contact has been saved.
4. Create a signed download link valid for seven days.
5. If Mailchimp Transactional is configured, send the requested guide link automatically. A sent/queued status shows “your email copy is on its way”. Rejection, missing configuration or failure shows an honest download-only message.
6. Show the instant download button only after Mailchimp confirms the contact write.

**Marketing API credentials alone do not send the email.** Mailchimp Transactional is a separate service requiring an enabled account and verified sending domain. Complete sender authentication in Mailchimp, then test with your own address. For another delivery provider, replace the Mandrill send block in `server.mjs`, keeping the same `emailQueued` result.

Do not trigger promotional journeys from the source tag without independently recorded marketing permission. This version intentionally keeps the form email-only and requests permission for delivery of this guide, not a newsletter. If you later want ongoing coaching emails, add a separate optional, unchecked consent choice and record its wording and timestamp.

### Sources used for implementation

- [Mailchimp add/update member API](https://mailchimp.com/developer/marketing/api/list-members/add-or-update-list-member/)
- [Mailchimp Transactional send API](https://mailchimp.com/developer/transactional/api/messages/send-new-message/)
- [Mailchimp Transactional setup](https://mailchimp.com/developer/transactional/guides/send-first-email/)
- [ICO guidance on email marketing and consent](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/)

## Deploy

This package runs as a long-lived Node.js service or Docker container. It is **not** a static-only upload: the server performs capture and protects the PDF.

For a Node host: upload this folder, select Node 22+, set the environment variables, and use `npm start` as the start command. No dependency installation or build step is needed. Use HTTPS and set `PUBLIC_BASE_URL` to the final origin before testing.

For a Docker host:

```sh
docker build -t look-good-fitness .
docker run --env-file .env -p 3000:3000 look-good-fitness
```

The Docker image includes the PDF. Do not publish the container image or this source bundle as a public download if you want the guide gated. Publish only the running website. The bundled PDF is approximately 33 MB; allow adequate download bandwidth.

For the existing Vercel site, the frontend can be integrated there, but the included server is not a drop-in Vercel Function: serving this large private PDF requires a suitable backend or signed object storage. The simplest unchanged deployment is a Node/container host on a dedicated subdomain, linked from the existing bio page.

### Before accepting real visitors

- Set your real credentials and domain; verify an actual contact appears in Mailchimp as non-subscribed and the requested email reaches your test inbox.
- Confirm the privacy text in `public/index.html` matches your actual processing, retention policy and Mailchimp safeguards. The contact email came from the supplied PDF. Establish and apply a retention/deletion process; this package does not purge Mailchimp contacts automatically.
- Keep Mailchimp audience required fields limited to email. Existing archived/cleaned contacts may be rejected by Mailchimp; the page reports failure rather than bypassing capture.
- Enable host/edge rate limiting for `/api/subscribe`. The built-in limits are in-memory and use the actual socket address, deliberately ignoring untrusted forwarded headers. Behind a reverse proxy, visitors may share that address; configure trusted client-IP handling or move IP limits to your host’s edge before a campaign. Use a shared limit for multiple server instances.
- Signed links are shareable bearer links, not DRM or proof of email ownership. The form verifies email syntax; it does not double-opt-in or verify control of the address.
- Avoid logging query strings for `/api/download`; they contain temporary download access tokens.

## Files

- `public/index.html` — landing page and privacy details
- `public/styles.css` — responsive design
- `public/app.js` — validation, loading, failure and success states
- `public/assets/` — real PDF artwork, logo, guide cover and local fallback font
- `server.mjs` — Mailchimp capture/delivery and signed downloads
- `private/british-finals-plan.pdf` — original PDF, deliberately outside public assets
- `.env.example` — deployment settings
- `Dockerfile` — container deployment
- `tests/flow.test.mjs` — isolated flow tests; no real emails sent

## Validation

```sh
npm run check
npm test
```

Automated tests cover capture-before-access, missing credentials, invalid input, honeypot rejection, private-file protection, token tampering, preservation of existing consent and email-delivery failure. Provider requests are mocked; live Mailchimp delivery still needs an account test. Browser review covers mobile and desktop presentation and unconfigured-service behaviour.

## Asset rights

Leon’s logo, collage and cover are taken from the supplied PDF for this requested page. Anton is bundled under the SIL Open Font License; see `FONT-LICENSE.txt`. The page uses the installed Impact face where available, with local Anton as the condensed fallback. No external font service is contacted by visitors.
