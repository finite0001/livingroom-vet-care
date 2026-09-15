# Verified public contact intake

The website contact form now calls the dedicated `public-contact` Supabase Edge endpoint. It has no anonymous or authenticated direct INSERT path to `contact_submissions`; the trusted service RPC inserts the immutable original and its triage row atomically. No email/SMS, opt-in, household match or confirmed appointment is created.

## Request verification and budgets

The Edge endpoint rejects missing configuration, unexpected origins/method/content type, over-16-KiB bodies, malformed fields and missing proof. Request/body reads and verification have time bounds. Turnstile Siteverify must report success, an exact configured hostname, action `contact_intake`, cData equal to the request UUID, and a fresh challenge timestamp. Tokens are single use and valid for five minutes. Verification retries use a deterministic UUID derived from the token, so refreshing a token is a separate verification attempt. Fetches reject redirects and no challenge/token/payload is logged.

The implementation intentionally ignores `X-Forwarded-For` and other IP headers and does not send Siteverify's optional `remoteip`. No documented Supabase origin guarantee was established for trusting those headers. There is **no IP or per-person rate-limit claim**.

A transactional global budget allows 120 requests/minute and 1,000/hour before verification; receipt checks also consume this budget. After successful verification, new submissions share a five/hour budget by HMAC of normalized claimed email. Exact saved retries do not create another submission or consume this email budget. Budget entries older than two days are pruned. The database serializes request UUIDs and keeps immutable exact payload/capability hashes.

Tradeoff: global budgets deliberately limit backend/provider exposure but an attacker can exhaust them and temporarily deny legitimate intake. Claimed-email budgets can also be exhausted for another person's address; they are abuse heuristics, **not identity proof**. Turnstile + these budgets are layered controls, not guaranteed bot prevention or a DDoS SLA. Monitor legitimate traffic and revise these explicit limits before launch; do not quietly replace them with spoofable IP buckets. GoDaddy DNS does not need to move.

## Stable request and lost-response behavior

A browser generates one request UUID and a separate random 256-bit receipt capability. Session storage contains only those opaque values; contact details, message and Turnstile token stay in memory. Fields lock after an attempted submission. Retries keep the same UUID and exact current draft. The service rejects reuse with different content/capability; a unique submission relationship prevents duplicates.

After a lost response, the form says receipt is unconfirmed, retains the reference, and offers a receipt check. Reload checks the receipt without resending. A received receipt acknowledges the earlier request; unknown/unavailable preserves the reference and asks for the original details if re-entry is necessary. It never asserts a failed HTTP response means the write did not commit. The opaque receipt endpoint returns only `received`, never original content or a household identity. If the visitor clears session storage or uses another browser, automatic recovery cannot identify the earlier request; staff should review possible duplicates manually.

## Browser storage failures

The form catches browsers that deny access to session storage. It refuses to send a new request unless its opaque recovery reference can be saved, preserves the draft, and states that nothing was sent. If storage fails on a retry, it preserves uncertainty about the earlier attempt and still offers receipt lookup. Failure to remove a confirmed reference does not turn an accepted request into an uncertain one; reload can safely recover the same receipt. Browser regression coverage simulates denied storage, failed cleanup, and a quota failure during retry.

## Operator setup / rollout gate (partially complete)

The primary database migrations and `public-contact` endpoint are deployed to `mgadheotkdnrsatfivjy`. Public hostnames and HTTPS are verified. Turnstile credentials, public widget configuration and controlled hosted intake acceptance are still pending; the production form remains unavailable.

1. Create a production Turnstile widget restricted to the actual website hostnames. Record the public site key and secret privately. Test keys are for synthetic/non-production environments only. No provider account or DNS change was made here.
2. Set Edge secrets: `CONTACT_TURNSTILE_SECRET`, a stable random `CONTACT_EMAIL_HASH_SECRET` of at least 32 characters, comma-separated exact `CONTACT_ALLOWED_ORIGINS` (e.g. `https://thelivingroom.vet`) and `CONTACT_ALLOWED_HOSTNAMES` (e.g. `thelivingroom.vet`). Add `www` or preview origins only when intentionally supported. Standard Supabase service URL/key remain server-side.
3. Configure `VITE_CONTACT_INTAKE_URL` with the dedicated Supabase function URL and `VITE_CONTACT_TURNSTILE_SITE_KEY` with the public widget key. Public configuration never contains the secret or service key.
4. Coordinate endpoint deployment, the 210000 privilege-revocation migration, and website build. The endpoint can be deployed and synthetic setup verified first; the database migration then closes the old insert bypass. Do not leave the original anonymous insert grants active after calling intake protected. Missing endpoint/widget configuration intentionally leaves the form unavailable rather than silently bypassing verification.
5. Validate in a controlled deployment: real hostname/action/cData, expired challenge, wrong hostname, direct Data API denial, receipt recovery and staff inquiry visibility. This implementation's tests mock all provider verification; no live challenge or production provider request has been made.

Official references checked during implementation:
- [Turnstile server validation: mandatory validation, 300-second/single-use tokens, optional remoteip and idempotency key](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Turnstile widget configuration, action and cData](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Supabase rate-limiting example](https://supabase.com/docs/guides/functions/examples/rate-limiting/): does not establish an origin-trust guarantee for arbitrary forwarded-IP headers.

This supersedes the direct-insert/rate-limit follow-up in `website-inquiries.md`; configuring and deploying the verified path remains an explicit launch gate.
