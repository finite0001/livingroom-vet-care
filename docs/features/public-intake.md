# Verified public contact intake

The website contact form now calls the dedicated `public-contact` Supabase Edge endpoint. It has no anonymous or authenticated direct INSERT path to `contact_submissions`; the trusted service RPC inserts the immutable original and its triage row atomically. No email/SMS, opt-in, household match or confirmed appointment is created.

## Verification mode

`CONTACT_VERIFICATION` selects how submissions are proven human. Configuration only; no code change is needed to switch.

| Value | Required Edge secrets | Browser config | Submit |
| --- | --- | --- | --- |
| unset or `turnstile` (default) | `CONTACT_TURNSTILE_SECRET`, `CONTACT_ALLOWED_HOSTNAMES`, `CONTACT_EMAIL_HASH_SECRET` (≥32), `CONTACT_ALLOWED_ORIGINS` | `VITE_CONTACT_INTAKE_URL` + `VITE_CONTACT_TURNSTILE_SITE_KEY` | token required and verified with Siteverify |
| `none` | `CONTACT_EMAIL_HASH_SECRET` (≥32), `CONTACT_ALLOWED_ORIGINS` | `VITE_CONTACT_INTAKE_URL` only | no token needed; Siteverify never called |
| anything else (incl. empty, `NONE`, `off`) | — | — | `503 Intake is not configured` |

Unset deliberately means `turnstile`, so a missing setting never silently weakens intake. In `none` mode a `token` field is optional; if a page built with a site key still sends one it is accepted when it is a string of at most 2,048 characters and then ignored (never verified, logged or stored); any other token type or length is rejected as a malformed request. Everything else is identical in both modes: origin allowlist, POST/JSON only, 16-KiB body and field bounds, the strict payload including boolean `sms_consent` that requires a phone, global and claimed-email budgets, opaque receipts and idempotent exact-payload accept.

The page chooses its mode from build-time config: with a site key it renders the widget and requires a token (unchanged); with only an intake URL it renders the form with no widget and omits the token; with neither it keeps "The online request form is not available yet."

**Tradeoff (owner decision, 2026-09-27).** The practice is pre-launch and chose to run without Turnstile, relying only on the budgets below. Automated clients can therefore submit the form, including ticking SMS consent for phone numbers they do not own. Staff must treat website SMS consent as **unconfirmed** until the client confirms it themselves (for example, the first text asks them to reply to confirm, and nothing else is sent until they do). The global budget (120/minute, 1,000/hour) and the five/hour claimed-email budget are the only abuse controls; a flood can exhaust the global budget and temporarily block real visitors. Watch intake volume and re-enable Turnstile if junk appears.

**Re-enable Turnstile.**
1. Create a Cloudflare Turnstile widget restricted to the site hostnames (e.g. `thelivingroom.vet`, `www.thelivingroom.vet`).
2. `supabase secrets set --project-ref mgadheotkdnrsatfivjy CONTACT_TURNSTILE_SECRET=<secret> CONTACT_ALLOWED_HOSTNAMES=thelivingroom.vet,www.thelivingroom.vet CONTACT_VERIFICATION=turnstile` (or `supabase secrets unset CONTACT_VERIFICATION`). Secret changes apply to new function invocations; redeploy `public-contact` if in doubt.
3. Set Vercel production `VITE_CONTACT_TURNSTILE_SITE_KEY=<public site key>` and redeploy the site.
4. Order matters: while the edge requires a token but the old page sends none, submissions fail with 400. Set the site key and redeploy the site first (a token is harmlessly ignored in `none` mode), then switch the edge to `turnstile`.

## Request verification and budgets

The Edge endpoint rejects missing configuration, unexpected origins/method/content type, over-16-KiB bodies, malformed fields and (in `turnstile` mode) missing proof. Request/body reads and verification have time bounds. Turnstile Siteverify must report success, an exact configured hostname, action `contact_intake`, cData equal to the request UUID, and a fresh challenge timestamp. Tokens are single use and valid for five minutes. Verification retries use a deterministic UUID derived from the token, so refreshing a token is a separate verification attempt. Fetches reject redirects and no challenge/token/payload is logged.

The implementation intentionally ignores `X-Forwarded-For` and other IP headers and does not send Siteverify's optional `remoteip`. No documented Supabase origin guarantee was established for trusting those headers. There is **no IP or per-person rate-limit claim**.

A transactional global budget allows 120 requests/minute and 1,000/hour before verification (in both modes); receipt checks also consume this budget. After successful verification (or directly, in `none` mode), new submissions share a five/hour budget by HMAC of normalized claimed email. Exact saved retries do not create another submission or consume this email budget. Budget entries older than two days are pruned. The database serializes request UUIDs and keeps immutable exact payload/capability hashes.

Tradeoff: global budgets deliberately limit backend/provider exposure but an attacker can exhaust them and temporarily deny legitimate intake. Claimed-email budgets can also be exhausted for another person's address; they are abuse heuristics, **not identity proof**. Turnstile + these budgets are layered controls, not guaranteed bot prevention or a DDoS SLA. Monitor legitimate traffic and revise these explicit limits before launch; do not quietly replace them with spoofable IP buckets. GoDaddy DNS does not need to move.

## Stable request and lost-response behavior

A browser generates one request UUID and a separate random 256-bit receipt capability. Session storage contains only those opaque values; contact details, message and Turnstile token stay in memory. Fields lock after an attempted submission. Retries keep the same UUID and exact current draft. The service rejects reuse with different content/capability; a unique submission relationship prevents duplicates.

After a lost response, the form says receipt is unconfirmed, retains the reference, and offers a receipt check. Reload checks the receipt without resending. A received receipt acknowledges the earlier request; unknown/unavailable preserves the reference and asks for the original details if re-entry is necessary. It never asserts a failed HTTP response means the write did not commit. The opaque receipt endpoint returns only `received`, never original content or a household identity. If the visitor clears session storage or uses another browser, automatic recovery cannot identify the earlier request; staff should review possible duplicates manually.

## Browser storage failures

The form catches browsers that deny access to session storage. It refuses to send a new request unless its opaque recovery reference can be saved, preserves the draft, and states that nothing was sent. If storage fails on a retry, it preserves uncertainty about the earlier attempt and still offers receipt lookup. Failure to remove a confirmed reference does not turn an accepted request into an uncertain one; reload can safely recover the same receipt. Browser regression coverage simulates denied storage, failed cleanup, and a quota failure during retry.

## Operator setup / rollout gate (partially complete)

The owner has chosen to launch the form in `CONTACT_VERIFICATION=none` mode (see [Verification mode](#verification-mode)); steps 1, 2's Turnstile secret/hostnames and 3's site key below apply only when Turnstile is enabled.

The primary database migrations and `public-contact` endpoint are deployed to `mgadheotkdnrsatfivjy`. Public hostnames and HTTPS are verified. Turnstile credentials, public widget configuration and controlled hosted intake acceptance are still pending; the production form remains unavailable.

1. Create a production Turnstile widget restricted to the actual website hostnames. Record the public site key and secret privately. Test keys are for synthetic/non-production environments only. No provider account or DNS change was made here.
2. Set Edge secrets: `CONTACT_TURNSTILE_SECRET`, a stable random `CONTACT_EMAIL_HASH_SECRET` of at least 32 characters, comma-separated exact `CONTACT_ALLOWED_ORIGINS` (e.g. `https://thelivingroom.vet`) and `CONTACT_ALLOWED_HOSTNAMES` (e.g. `thelivingroom.vet`). Add `www` or preview origins only when intentionally supported. Standard Supabase service URL/key remain server-side.
3. Configure `VITE_CONTACT_INTAKE_URL` with the dedicated Supabase function URL and `VITE_CONTACT_TURNSTILE_SITE_KEY` with the public widget key. Public configuration never contains the secret or service key.
4. Coordinate endpoint deployment, the 210000 privilege-revocation migration, and website build. The endpoint can be deployed and synthetic setup verified first; the database migration then closes the old insert bypass. Do not leave the original anonymous insert grants active after calling intake protected. A missing endpoint leaves the form unavailable. A missing site key alone renders the no-widget form, but the Edge function still demands a token unless `CONTACT_VERIFICATION=none` is set explicitly, so verification is never bypassed silently.
5. Validate in a controlled deployment: real hostname/action/cData, expired challenge, wrong hostname, direct Data API denial, receipt recovery and staff inquiry visibility. This implementation's tests mock all provider verification; no live challenge or production provider request has been made.

Official references checked during implementation:
- [Turnstile server validation: mandatory validation, 300-second/single-use tokens, optional remoteip and idempotency key](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Turnstile widget configuration, action and cData](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Supabase rate-limiting example](https://supabase.com/docs/guides/functions/examples/rate-limiting/): does not establish an origin-trust guarantee for arbitrary forwarded-IP headers.

This supersedes the direct-insert/rate-limit follow-up in `website-inquiries.md`; configuring and deploying the verified path remains an explicit launch gate.
