# Owner action checklist for public launch

Last updated: 2026-09-24.

This checklist records the remaining actions that require owner, registrar, or practice-policy authority. The hosted Supabase operating loop, Hub workflow readiness, Vercel Production deployment, custom-domain HTTPS, and release-control evidence are otherwise prepared for final verification. Current aggregate readiness is 4/5 gates passing; the only generated blocker group is owner public-contact content.

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

## 2. Hosted application/backend readiness — completed except deferred live providers

Current generated evidence records:

- Supabase migration parity: 148 matching versions, 0 remote-only, 0 local-only.
- Supabase/database operating-loop gate: pass.
- Hub workflow readiness gate: pass.
- External services/deployment readiness gate: pass.
- Verification/release-control gate: pass.
- Public website gate: blocked only by owner public-contact values.

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

The launch-critical Supabase functions are deployed and the former conflict slugs now return disabled HTTP 410 responses. Before live provider use:

- Resend delivery webhook should point to `resend-delivery-webhook`.
- Twilio status callback should point to `twilio-message-status-callback`.
- Twilio inbound SMS webhook should point to `twilio-inbound-sms`.
- Legacy callback endpoints `enqueue-message`, `public-contact`, `resend-webhook`, and `twilio-webhook` should not be configured in provider dashboards.
- Scheduler-capable worker slugs such as `dispatch-outbox`, `process-inbound`, and `queue-reminders` must remain unable to run from database cron until scheduler Vault values and provider gates are intentionally commissioned.

Keep `OUTBOUND_DELIVERY_MODE=disabled` until explicit provider round-trip tests are approved.
