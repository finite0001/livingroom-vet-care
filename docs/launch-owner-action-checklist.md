# Owner action checklist for public launch

Last updated: 2026-09-24.

This checklist records the remaining actions that require owner, registrar, or practice-policy authority. Hub workflow readiness, Vercel Production deployment, custom-domain HTTPS, and release-control evidence are otherwise prepared for final verification. Current aggregate readiness is 3/5 gates passing. The generated blocker groups are the two local-only readiness migrations, `20260924120000` and `20260924130000`, and owner public-contact content. The Stage 2 pre-apply refresh is recorded in [2026-09-24 Stage 2 readiness refresh before hosted Phase 2 apply](launch-evidence/2026-09-24-stage-2-readiness-refresh-pre-apply.md), local disabled/test-mode delivery coverage is recorded in [2026-09-24 no-live-send local workflow drill](launch-evidence/2026-09-24-no-live-send-local-drill.md), the local integrated preventive/inventory/billing/payment/certificate workflow proof is recorded in [2026-09-24 integrated synthetic local workflow proof](launch-evidence/2026-09-24-integrated-synthetic-local-workflow.md), and the reviewer package readiness receipt is recorded in [2026-09-24 clinical and staff acceptance package readiness](launch-evidence/2026-09-24-clinical-staff-acceptance-package.md).

## 1. DNS and HTTPS at GoDaddy/Vercel — completed 2026-09-24

Current DNS now points at Vercel:

| Host/name | Type | Current value |
| --- | --- | --- |
| `@` | `A` | `216.150.1.1` |
| `@` | `A` | `216.150.16.1` |
| `www` | `CNAME` | `1115926f442091d7.vercel-dns-016.com.` |

Do not add browser secrets or service-role/provider credentials to DNS or Vercel public environment variables.

Verification completed:

- `dig +short A thelivingroom.vet` returned `216.150.1.1` and `216.150.16.1`.
- `dig +short CNAME www.thelivingroom.vet` returned `1115926f442091d7.vercel-dns-016.com.`.
- Vercel domain verification returned `configured_correctly` for both `thelivingroom.vet` and `www.thelivingroom.vet`.
- HTTPS smoke checks now return HTTP/2 200 from Vercel for `https://thelivingroom.vet`, `https://www.thelivingroom.vet`, and `https://thelivingroom.vet/hub`. See [2026-09-24 public domain HTTPS smoke](launch-evidence/2026-09-24-public-domain-https-smoke.md).

## 2. Hosted application/backend readiness — local Phase 2 proof complete, hosted apply pending

Current generated evidence records:

- Supabase migration parity: 148 matching hosted versions, 0 remote-only, 2 local-only (`20260924120000`, `20260924130000`).
- Supabase/database operating-loop gate: blocked until both local readiness migrations are applied to hosted and readiness is refreshed.
- Hub workflow readiness gate: pass.
- External services/deployment readiness gate: pass.
- Verification/release-control gate: pass.
- Public website gate: blocked only by owner public-contact values.

Local database proof exists for the pending Phase 2 migration: [2026-09-24 current-stack DB replay and pgTAP](launch-evidence/2026-09-24-current-stack-db-replay-pgtap.md).

Local integrated workflow proof exists for the pre-phone/CloudTalk synthetic clinical, inventory, billing, payment, delivery, and reconciliation loop: [2026-09-24 integrated synthetic local workflow proof](launch-evidence/2026-09-24-integrated-synthetic-local-workflow.md). This is not hosted staff acceptance or clinical approval.

Clinical/staff acceptance package readiness is documented in [2026-09-24 clinical and staff acceptance package readiness](launch-evidence/2026-09-24-clinical-staff-acceptance-package.md). Reviewer decisions are still pending.

The latest local release-control check passed at the current readiness package checkpoint: [2026-09-24 local release-control check](launch-evidence/2026-09-24-local-release-control-check.md).

Hosted dry-run proof exists for the pending apply set: `npx supabase db push --linked --dry-run --skip-vault` would apply exactly `20260924120000_canonical_housecall_appointment_contract.sql` and `20260924130000_inbound_sms_service_rpc_security.sql`, with no seeds or roles. After explicit owner approval, the exact hosted apply command is:

```bash
npx supabase db push --linked --skip-vault
```

Then regenerate evidence with:

```bash
npm run readiness:refresh --silent
npm run readiness:summary -- --fail-on-blockers
```

Scheduler jobs exist after the hosted migration rollout, but database Vault values `project_url` and `scheduler_worker_key` are intentionally absent. That means database-initiated scheduler calls remain contained until explicit scheduler/provider commissioning.

## 3. Confirm public contact content

Do not publish guessed phone, email, or emergency instructions. The public site intentionally blocks launch while these values are `null` in `src/config/practice.ts`.

Owner-approved values needed:

| Field | Required decision |
| --- | --- |
| Practice phone | Public phone number to display and link with `tel:`. |
| Practice email | Public monitored mailbox to display and link with `mailto:`. |
| Emergency instructions | Public urgent/emergency phone/contact wording. Avoid implying this practice monitors emergencies unless that is operationally true. |

Already configured:

- Opening hours: `Monday–Saturday, 9 am–5 pm Mountain Time`.

After owner approval, update `src/config/practice.ts`, then run:

```bash
npm run public:readiness
npm run readiness:refresh
```

Expected result: public website gate has zero blockers.

## 4. Provider/dashboard follow-up before live messaging

The launch-critical Supabase functions are deployed. Before live provider use, configure dashboards only to the current launch slugs:

- Resend delivery webhook: `https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/resend-delivery-webhook`.
- Twilio status callback: `https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/twilio-message-status-callback`.
- Twilio inbound SMS webhook: `https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/twilio-inbound-sms`.
- Legacy callback endpoints `enqueue-message`, `public-contact`, `resend-webhook`, and `twilio-webhook` should not be configured in provider dashboards for the launch path.
- Scheduler-capable worker slugs such as `dispatch-outbox`, `process-inbound`, and `queue-reminders` must remain unable to run from database cron until scheduler Vault values and provider gates are intentionally commissioned.

Keep `OUTBOUND_DELIVERY_MODE=disabled` until explicit provider round-trip tests are approved.
