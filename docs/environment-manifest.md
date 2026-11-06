# Living Room Vet environment manifest

Last reconciled: 2026-11-06 against repository configuration. Live state must be verified for the selected release; dated observations below retain their original scope.

This manifest records what each environment must own before commercial launch. It intentionally contains placeholders only; secrets belong in Vercel or Supabase secret stores, never in Git or chat.

## Environment targets

| Environment | Backend / deployment identity | Boundary |
| --- | --- | --- |
| Local disposable | Explicit local Supabase stack and synthetic browser settings | Tests only; disabled/mocked providers |
| Production | Supabase `mgadheotkdnrsatfivjy`; Vercel `livingroom-vet-care`; `thelivingroom.vet` | Approved production target; verify current deployed SHA, ledger, Edge source and gates |
| Staging | Supabase `kothoqicubowyhwfsrte` / `livingroom-vet-staging` | Separate candidate verification; not an alternate production source of truth |
| Legacy Lovable | `ugpyjacqganaqtsiekay` | Retained historical data; not a new deployment target |

The repo contains 209 migrations at the November 6 source baseline. The [October 30 receipt](controlled-drugs/narcotics-hosted-ledger-audit-columns-20261030.md) records a hosted prefix of 205 after 206 rolled back. The [November 6 hosted metadata](evidence/beta-hosted-metadata-2026-11-06.json) supersedes that prefix: production lists all 209 versions and 56 active function slugs; staging lists 204 versions and lacks the five controlled migrations plus `invite-staff` (55 slugs). Metadata presence does not verify deployed source equality. Use the [specialized narcotics release sequence](controlled-drugs/narcotics-release-sequence-20261028.md) from the actual target prefix. The [November 6 runtime metadata](evidence/beta-backend-runtime-metadata-2026-11-06.json) records missing staging scheduler Vault names, production cleanup 503s explicitly reporting that cleanup is disabled and inactive task/invoice reminder jobs on both targets; no provider or full-workflow success is inferred.

## Public browser variables

The guarded deployment build requires explicit environment-scoped values; see [deployment-environment.md](deployment-environment.md).

| Variable | Requirement | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Required | Exact selected project HTTPS origin |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Required | Matching public publishable/anon key |
| `VITE_SUPABASE_PROJECT_ID` | Required by deployment guard | Must agree with URL; production and preview targets are separated |
| `VITE_CONTACT_INTAKE_URL` | Optional | Selected backend's `/functions/v1/public-contact`; absent means intake disabled |
| `VITE_CONTACT_TURNSTILE_SITE_KEY` | Optional | Requires intake URL; absent site key with configured intake requires server `CONTACT_VERIFICATION=none` |
| `VITE_CLOUDTALK_ENABLED` | Optional | Exactly `true` or `false` when set; controls phone surfaces, not provider authorization |

No other public `VITE_` names are allowed by `scripts/deployment-environment.mjs`. Keep local `.env`/`.env.local` ignored; `.env.example` is the tracked template. Never expose provider/service credentials through public settings.

## Supabase Edge Function Secrets

### Private call drafting (2026-10-18 increment)

The dedicated `clinical-call-note-process` endpoint uses server-only `OPENAI_API_KEY` and requires **both** `CLINICAL_NOTE_PROCESSING_ENABLED=true` and `CLINICAL_CALL_NOTE_PROCESSING_ENABLED=true`. Missing or any other values keep processing disabled. Its JWT verification remains enabled. These are Supabase secrets, never `VITE_*` variables. Deploying this endpoint or saving an approved policy does not activate either gate.

Before any real call processing, the database must have the exact approved general note, call capture and independent call-generation policies and approved template. Susan's policy review and separate commissioning remain outstanding. Retained sources and generated drafts are private ADMIN records; only explicitly accepted clinical SOAP wording becomes ordinary chart text. See the [guarded workflow plan](../plans/20261018-call-generation-review/plan.md).

Capture remains separately controlled by its existing `CLINICAL_CALL_CAPTURE_ENABLED` gate. Generating from an already retained source does not fetch CloudTalk or re-transcribe audio. Do not enable capture, dictation audio or outbound delivery as a side effect of deploying this increment.

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
| `RESEND_REPLY_TO` | Legacy (optional) | Superseded by `AGENTMAIL_INBOX_ADDRESS`. If still set it must equal that address, or every email send fails closed. Test/disabled modes fall back to it only while `AGENTMAIL_INBOX_ADDRESS` is unset. |
| `RESEND_DELIVERY_WEBHOOK_SECRET` | `resend-delivery-webhook` | Svix signing secret of the single Resend webhook endpoint (delivery/bounce/complaint/failure). Not shared with any other slug. |
| `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_ADDRESSES` | Retired 2026-09-27 | Resend receiving is retired (`resend-webhook` is an inert 410 stub). Unset them after `RESEND_DELIVERY_WEBHOOK_SECRET` is in place. |
| `AGENTMAIL_API_KEY` | `process-inbound`, `capture-inbound-attachment` | Server-only AgentMail API key used to fetch received messages and attachments. Least privilege: read access to the one inbox. |
| `AGENTMAIL_WEBHOOK_SECRET` | `agentmail-inbound-webhook` | Svix signing secret (`whsec_…`) of the AgentMail webhook endpoint. |
| `AGENTMAIL_INBOX_ID` | `agentmail-inbound-webhook`, `process-inbound`, `capture-inbound-attachment` | Exact `inbox_id` of the app's receiving inbox as AgentMail reports it. Webhooks for any other inbox are refused. |
| `AGENTMAIL_INBOX_ADDRESS` | Every email-sending function (`dispatch-outbox`, `dispatch-outbound-deliveries`, `capture-conversation-email`, `prepare-invoice-email`, `prepare-release-email`, `prepare-payment-delivery`) and the webhooks | Bare address of that inbox. It is the **Reply-To on every app email**, so client replies reach the app. Required in live mode (sends fail closed without it). See [AgentMail inbound](agentmail-inbound.md). |
| `SMS_PROVIDER` | `dispatch-outbox`, `dispatch-outbound-deliveries`, `prepare-payment-delivery` | `cloudtalk` (default when unset) or `twilio`; any other value fails closed. Must match the database setting `communication_sms_provider_setting`. |
| `CLOUDTALK_API_KEY_ID` / `CLOUDTALK_API_KEY_SECRET` | CloudTalk SMS send, call media | Server-only HTTP Basic key pair. |
| `CLOUDTALK_ALLOWED_NUMBERS` | CloudTalk webhook and SMS sender | Exact E.164 practice numbers (`+17207646677`). |
| `CLOUDTALK_SMS_SENDER` | CloudTalk SMS sender (optional) | Needed only when more than one allowed number exists; must be one of them. |
| `TWILIO_ACCOUNT_SID` | SMS provider tests/live (retained, not selected) | Requires owned Twilio account and number. |
| `TWILIO_AUTH_TOKEN` | SMS provider tests/live | Server-only. |
| `TWILIO_FROM_NUMBER` | SMS provider tests/live | Must be E.164 and consent/opt-out compliant. |
| `TWILIO_STATUS_CALLBACK_URL` | Twilio delivery status webhook | Exact public URL configured in Twilio for message status callbacks. Required: without it `twilio-message-status-callback` answers 503 (it no longer falls back to the internal request URL, which never matches the signature). |
| `TWILIO_INBOUND_WEBHOOK_URL` | Twilio inbound SMS webhook | Exact public URL configured in Twilio for incoming messages. Required: without it `twilio-inbound-sms` answers 503 (it no longer falls back to the internal request URL, which never matches the signature). |
| `ESTIMATE_DECISION_ORIGIN` | `estimate-decision`, `prepare-estimate-decision-grant`, `recover-estimate-decision-grant` | App origin only, e.g. `https://thelivingroom.vet` (https, or http only for localhost). It is bound into every client estimate link's HMAC context and is the only browser origin the staff link functions accept, so it must equal `APP_URL` and the other origin settings (go-live runbook §6, origin agreement check). Changing it invalidates links already issued. |
| `ESTIMATE_DECISION_ACTIVE_KEY_VERSION` | same three functions | Key version used for new links: 1–40 characters of `A-Za-z0-9_-`. Must be a key in `ESTIMATE_DECISION_KEYS`. |
| `ESTIMATE_DECISION_KEYS` | same three functions | Server-only JSON object `{"<version>":"<base64 key>"}`, at most 16 entries, each key 32–64 random bytes in canonical base64. Keep retired versions here until every link issued under them has expired; a link names the version it was issued with. |
| `ESTIMATE_DECISION_PUBLIC_ENABLED` | `estimate-decision` (client page) | `true` or `false`; unset means off. Off makes every client estimate link unavailable without revoking it. |
| `ESTIMATE_DECISION_ISSUANCE_ENABLED` | `prepare-estimate-decision-grant`, `recover-estimate-decision-grant` | `true` or `false`; unset means off. Off refuses new client links (the staff workspace shows "issuance is switched off") and recovery returns grant metadata without the link. Any of these five values malformed makes all three functions answer 404. |
| `LOVABLE_API_KEY` | Retired 2026-09-30 | Only `suggest-replies` read it, and that function was deleted. Unset it. |
| `TWILIO_WEBHOOK_URL` | Retired 2026-09-30 | Only the legacy `twilio-webhook` slug read it; that slug is now an inert 410 stub. Twilio callbacks use `TWILIO_INBOUND_WEBHOOK_URL` and `TWILIO_STATUS_CALLBACK_URL`. Unset it. |

## Provider Ownership Gates

| Provider/service | Needed proof before live use |
| --- | --- |
| Domain/DNS | `thelivingroom.vet` DNS controlled by owner; Vercel domain verification passes; HTTPS smoke returns HTTP/2 200 for apex, `www`, and `/hub`; old preview image/URLs absent from production metadata. |
| Supabase Auth SMTP | Sender domain configured; invite and recovery tested on staging; signup disabled; redirect allowlist exact. |
| Resend/email | Sending domain verified; reply mailbox receives replies; bounce/callback plan documented. |
| CloudTalk/SMS | Selected practice number, consent and STOP/resubscribe behavior, inbound threading and provider status verified. Twilio remains retained but unselected code. |
| Stripe | Account, sandbox keys, webhook signing secret, refund/tax/manual payment policy and reconciliation flow. |
| Automatic lab/imaging/anesthesia integration | Vendor contract/access, authorized test samples and clinician/vendor acceptance for the selected integration. Native manual records do not prove vendor automation. Ongoing ezyVet integration is not a standalone launch gate. |
| Backups/restore | Restore rehearsal proves database rows, Auth mapping, RLS, audit history and private document bytes. |

## Release and activation rules

- Choose exactly one active browser backend before Vercel/domain cutover.
- Freeze old writers and delivery workers before migration or DNS switch.
- Never run old and new delivery workers against the same recipients.
- Keep previews pointed at staging or disposable data, never production.
- Verify the active outbox path (`enqueue-message` → `communication_outbox` → `dispatch-outbox`), its scheduler worker authentication, provider credentials, signed callbacks, inbound processing, replay/recovery and STOP/resubscribe behavior before activating live delivery. The older `dispatch-outbound-deliveries` path has a separate token and is not a substitute for proving the active queue. See [scheduler.md](scheduler.md) and [communications-outbox.md](communications-outbox.md).
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

- 2026-10-18 UTC: Specifically approved PR 274 completed staging-first, then primary database/Edge rollout at migration 203 before frontend merge `2a21c4591ff7ac753cbd0c944ea28444b98954c8`. JWT worker source, prior data/permissions/functions and secret digests were verified. Exact Vercel production deployment `dpl_GZZKzWcKY3A8gAQFDDtSgmQdKdFp` is READY on apex/www; public desktop/mobile-width login checks passed. Call capture/generation flags remain absent and policies draft. See [rollout evidence](launch-evidence/2026-10-18-clinical-call-generation-primary-rollout.md); this release does not commission clinical calls or alter unrelated delivery/processing gates.
