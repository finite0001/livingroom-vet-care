# Hosted no-live-send drill preflight

Date: 2026-09-24  
Scope: read-only preflight for the hosted no-live-send workflow drill  
Target project: `mgadheotkdnrsatfivjy`

## Summary

The hosted no-live-send drill is not ready to run yet. The preflight is intentionally blocked by hosted migration drift: the hosted database is still missing the two expected readiness migrations required before exercising hosted synthetic workflow records.

No hosted data was written by this preflight. No provider dashboard callback URL was activated. No CloudTalk, public phone, live SMS, live voice, voicemail, or live message delivery path was configured or exercised.

Machine-readable evidence: [2026-09-24 hosted no-live-send drill preflight JSON](2026-09-24-hosted-no-live-send-drill-preflight.json)

## Command

```bash
npm run readiness:no-live-send-preflight -- \
  --output docs/launch-evidence/2026-09-24-hosted-no-live-send-drill-preflight.json
```

Expected current result:

```text
preflight_exit_status=1
```

The nonzero status is expected until the hosted readiness migrations are applied.

## Check results

| Check | Status | Evidence |
| --- | --- | --- |
| Hosted migration drift | Blocked | 148 matching migrations, 0 remote-only, 2 local-only: `20260924120000`, `20260924130000` |
| Hub workflows | Pass | `local-hub-ready`; hosted dependencies ready |
| Required hosted schema objects | Pass | outbound delivery table, staff queue/control RPCs, callback/inbound RPCs, appointment/reminder objects present |
| Required Edge Functions | Pass | `public-contact`, `send-email`, `send-sms`, `dispatch-outbound-deliveries`, `resend-delivery-webhook`, `twilio-message-status-callback`, `twilio-inbound-sms`, `process-inbound`, and `queue-reminders` active with expected JWT settings |
| Scheduler containment | Pass | `project_url` and `scheduler_worker_key` Vault secrets absent; expected cron jobs present |
| Local no-live-send contract evidence | Pass | [2026-09-24 no-live-send local workflow drill](2026-09-24-no-live-send-local-drill.md) |

## Hosted drill coverage once unblocked

The preflight defines the hosted drill scope as:

- anonymous contact submit to Hub triage/audit;
- staff email queueing through the outbox path;
- staff SMS queueing in disabled/test evidence mode;
- appointment reminder enqueue and dispatcher containment;
- Resend synthetic signed delivery callback;
- Twilio synthetic signed status callback and inbound SMS STOP/START;
- delivery operations visibility for queued, failed, retryable, canceled, and unknown states.

## Remaining gates before running the hosted drill

1. Explicit approval before applying hosted migrations.
2. Hosted apply of only:
   - `20260924120000_canonical_housecall_appointment_contract.sql`
   - `20260924130000_inbound_sms_service_rpc_security.sql`
3. Fresh readiness refresh showing the Supabase/database gate no longer blocked by local-only migrations.
4. Explicit approval before creating hosted synthetic workflow records for the no-live-send drill.

## Out of scope

- Public phone publication.
- CloudTalk setup.
- Live SMS number/A2P activation.
- Live voice or voicemail.
- Provider dashboard activation for live traffic.
- Production client message delivery.
