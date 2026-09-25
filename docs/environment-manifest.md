# Living Room Vet environment manifest

Last updated: 2026-09-24.

This manifest records what each environment must own before commercial launch. It intentionally contains placeholders only; secrets belong in Vercel or Supabase secret stores, never in Git or chat.

## Environment State

| Environment | Current status | Browser backend | Server secrets | Outbound delivery |
| --- | --- | --- | --- | --- |
| Local disposable | Available for tests only | Local Supabase stack, e.g. `http://127.0.0.1:56321` | Local-only synthetic values | Disabled or mocked |
| Original Lovable backend | Historical backend `ugpyjacqganaqtsiekay`; no longer the tracked local CLI target after the 2026-09-22 readiness wave | Historical browser target until frontend env cutover is deliberately performed | Unknown from repo | Do not enable during cutover work |
| Dedicated Supabase staging candidate | Project `mgadheotkdnrsatfivjy` is the tracked local CLI target in `supabase/config.toml`; hosted migrations are at parity with 148 matching versions, and launch-readiness schema/function inventories pass | Vercel Production envs point at this backend; Lovable/browser alternates still require deliberate cutover | `APP_ENV=staging`, `OUTBOUND_DELIVERY_MODE=disabled` unless testing | Disabled by default |
| Dedicated Supabase staging alternate | Project `kothoqicubowyhwfsrte` / `livingroom-vet-staging` is visible to the authenticated Supabase CLI and reports `ACTIVE_HEALTHY`; source of truth must be chosen before use | Must not be used accidentally beside `mgadheotkdnrsatfivjy` | Unknown from repo | Disabled unless deliberately commissioned |
| Vercel production | Production deployment `dpl_EnvwqCoXkakCik1Sd6A7yyq6kxAY` is `READY`; project alias is `https://livingroom-vet-care.vercel.app`; `thelivingroom.vet` and `www.thelivingroom.vet` are attached, Vercel reports `configured_correctly`, and HTTPS smoke returns HTTP/2 200 | Dedicated Supabase project `mgadheotkdnrsatfivjy` via Production `VITE_SUPABASE_*` env vars | No service-role/provider secrets in Vercel browser env | Must not send to real recipients |
| Public production cutover | Not complete | Chosen hosted backend after DNS/content/provider acceptance | Production Supabase secrets and provider credentials | Disabled until provider round trips and callbacks pass |

## Public Browser Variables

These are the only variables that belong in Vercel browser environments.

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Authoritative browser API origin. Must point at the intended backend for that deployment. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable/anon key for the same project as `VITE_SUPABASE_URL`. |
| `VITE_SUPABASE_PROJECT_ID` | Optional | Informational/tooling label only; do not use it to infer the active backend. |

The repository no longer tracks a real `.env` file. Keep local developer values in ignored `.env`/`.env.local` files and production/preview values in Vercel environment settings. `.env.example` is the only committed browser-environment template.

## Supabase Edge Function Secrets

Set these per Supabase project with the Supabase dashboard/CLI secret store.

| Secret | Required before | Notes |
| --- | --- | --- |
| `APP_URL` | Staff invitation/recovery | Origin only, e.g. `https://thelivingroom.vet`. |
| `APP_ENV` | Any outbound-capable function | One of `development`, `staging`, `production`. |
| `OUTBOUND_DELIVERY_MODE` | Any outbound-capable function | `disabled`, `test`, or `live`; missing means disabled. |
| `OUTBOUND_DISPATCHER_TOKEN` | `dispatch-outbound-deliveries` worker | Long random shared token for scheduler/operator calls. Store only in Supabase secrets and the scheduler secret store; never expose to browser environments. |
| `OUTBOUND_TEST_EMAILS` | Test email sends | Exact mailbox allowlist; no wildcards or rerouting. |
| `OUTBOUND_TEST_PHONES` | Test SMS sends | Exact E.164 allowlist. |
| `SUPABASE_URL` | Edge functions | Server-side project URL for the same backend. |
| `SUPABASE_ANON_KEY` | Edge functions | Server-side anon key when needed for verified user calls. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin/worker functions | Server-only. Never expose to browser, logs, chat, or Vercel public env. |
| `RESEND_API_KEY` | Email provider tests/live | Requires verified sending domain before real sends. |
| `RESEND_FROM` | Email provider tests/live | Must use a verified sender/domain. |
| `RESEND_REPLY_TO` | Email provider tests/live | Must route to an owned monitored mailbox. |
| `RESEND_WEBHOOK_SECRET` | Resend delivery webhook | Svix signing secret for the configured Resend webhook endpoint. |
| `TWILIO_ACCOUNT_SID` | SMS provider tests/live | Requires owned Twilio account and number. |
| `TWILIO_AUTH_TOKEN` | SMS provider tests/live | Server-only. |
| `TWILIO_FROM_NUMBER` | SMS provider tests/live | Must be E.164 and consent/opt-out compliant. |
| `TWILIO_STATUS_CALLBACK_URL` | Twilio delivery status webhook | Exact public URL configured in Twilio for message status callbacks; required for signature validation behind proxies/custom domains. |
| `TWILIO_INBOUND_WEBHOOK_URL` | Twilio inbound SMS webhook | Exact public URL configured in Twilio for incoming messages; required for signature validation behind proxies/custom domains. |
| `LOVABLE_API_KEY` | Smart replies only | Not required for launch-critical operating loop. |

## Provider Ownership Gates

| Provider/service | Needed proof before live use |
| --- | --- |
| Domain/DNS | `thelivingroom.vet` DNS controlled by owner; Vercel domain verification passes; HTTPS smoke returns HTTP/2 200 for apex, `www`, and `/hub`; old preview image/URLs absent from production metadata. |
| Supabase Auth SMTP | Sender domain configured; invite and recovery tested on staging; signup disabled; redirect allowlist exact. |
| Resend/email | Sending domain verified; reply mailbox receives replies; bounce/callback plan documented. |
| Twilio/SMS | Number provisioned; SMS consent and STOP/START policy accepted; inbound and status webhooks verified. |
| Stripe | Account, sandbox keys, webhook signing secret, refund/tax/manual payment policy and reconciliation flow. |
| ezyVet/lab/anesthesia | Authorized account/API access, source-of-truth decision, non-destructive samples and clinician/vendor acceptance. |
| Backups/restore | Restore rehearsal proves database rows, Auth mapping, RLS, audit history and private document bytes. |

## Launch Cutover Rules

- Choose exactly one active browser backend before Vercel/domain cutover.
- Freeze old writers and delivery workers before migration or DNS switch.
- Never run old and new delivery workers against the same recipients.
- Keep previews pointed at staging or disposable data, never production.
- Enable production outbound delivery only after `dispatch-outbound-deliveries` is deployed/scheduled with `OUTBOUND_DISPATCHER_TOKEN`, provider credentials and webhook secrets are installed, provider callback and inbound handlers are registered, replay/idempotency checks pass, STOP/START behavior is accepted, and settlement through `record_outbound_delivery_result(...)` / `record_outbound_delivery_callback(...)` plus inbound recording through `record_inbound_sms(...)` are accepted.
- Record the exact operator, timestamp, target project IDs, migration receipts and rollback path in `docs/launch-evidence/`.

## Read-Only Probe Evidence

Captured 2026-09-22:

- `supabase projects list` succeeded and showed `livingroom-vet-care` (`mgadheotkdnrsatfivjy`) and `livingroom-vet-staging` (`kothoqicubowyhwfsrte`) as `ACTIVE_HEALTHY`.
- `supabase/config.toml` now points at `mgadheotkdnrsatfivjy`; Vercel/Lovable browser environments still require deliberate cutover and are not inferred from this CLI setting.
- `npx --yes vercel whoami` returned `finite0001`.
- `npx --yes vercel project ls` showed project `livingroom-vet-care` with latest production URL `https://livingroom-vet-care-daves-projects-e0da43ba.vercel.app`; custom domain `thelivingroom.vet` is not evidenced here.
- `npx --yes vercel project inspect livingroom-vet-care` showed project build command `npm run build:deployment`, output directory `dist`, install command `npm ci --ignore-scripts`, and Node.js `24.x`.
- `npx --yes vercel env ls` showed only Preview environment variables for `VERCEL_ENV`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PROJECT_ID`; no Production variables were listed.
- `npx --yes vercel domains ls` did not list `thelivingroom.vet`; the domain is not evidenced as attached to this Vercel account/project.
- 2026-09-23: `npx supabase link --project-ref mgadheotkdnrsatfivjy` succeeded, historical remote-only migration receipts were restored locally, the first commercial-readiness migration set was pushed to the hosted project, and launch-readiness schema/function inventories passed for the current Hub workflows. Reviewed launch Edge Functions were active with expected JWT modes. Vercel Production browser envs were set for `mgadheotkdnrsatfivjy`, and a fresh Production deployment was ready. `thelivingroom.vet` and `www.thelivingroom.vet` were attached to the Vercel project. GoDaddy DNS was updated to apex `A` records `216.150.1.1` and `216.150.16.1`, plus `www` CNAME `1115926f442091d7.vercel-dns-016.com.`; `dig` and Vercel domain verification passed for both names. See [release-target evidence](launch-evidence/2026-09-23-supabase-link-and-migration-drift.md).
- 2026-09-24: After PR #204 merged, the remaining 25 hosted migrations were applied to `mgadheotkdnrsatfivjy`; that checkpoint recorded 148 matching migrations, 0 remote-only, and 0 local-only. Later same-day readiness work added two local hosted-readiness migrations, `20260924120000` and `20260924130000`, that still require explicit owner approval before hosted apply. The ordered readiness refresh now reports 3/6 gates passing; the generated blocker groups are Supabase migration parity, clinical/staff acceptance decisions and run metadata, and owner public-contact content. HTTPS smoke now returns HTTP/2 200 for `https://thelivingroom.vet`, `https://www.thelivingroom.vet`, and `https://thelivingroom.vet/hub`. The public `health` Edge Function is deployed and smokes with GET/HEAD HTTP/2 200 as a liveness-only probe. See [hosted rollout evidence](launch-evidence/2026-09-24-readiness-refresh.json), [public domain HTTPS smoke](launch-evidence/2026-09-24-public-domain-https-smoke.md), and [health Edge smoke](launch-evidence/2026-09-24-health-edge-smoke.md).
