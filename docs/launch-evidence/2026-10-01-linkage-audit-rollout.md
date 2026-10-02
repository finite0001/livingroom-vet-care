# 2026-10-01 linkage-audit hosted rollout

- **Source:** `main` @ `f75187a` (#225 linkage-audit train, #226/#227 runbook corrections).
- **Operator:** David Edler, running `zsh ~/lrv-rollout-2026-10-01.sh` (prepared by Claude). Claude applied the staging migrations and ran the staging probes and validation query directly.
- **Deploy times (UTC, from `functions list`):** staging 2026-10-02 03:37, primary 2026-10-02 04:22.

## Migrations

| Project | Pending before | Applied | After |
| --- | --- | --- | --- |
| Staging `kothoqicubowyhwfsrte` | 3: `20260930100000`, `20260930120000`, `20260930130000` | all 3 | 167 |
| Primary `mgadheotkdnrsatfivjy` | 2: `20260930120000`, `20260930130000` (`20260930100000` was already applied) | both | 167 |

Post-push probes were identical on both projects: `migrations=167`, `sms_events=true`, `pet_household_fks=5`, `purge_job=1`, `timeout_30s=true`.

## Linkage constraint validation (runbook §3)

The read-only violation query returned **0 for all 9 checks on both projects**:
- the 5 pet/household tables
- `response_metrics.staff_id`
- `client_files.uploaded_by`
- `lab_results.status`
- `appointment_reminders.channel`

The 9 NOT VALID constraints were then validated. Both projects now report `not_valid=0`.

## Edge functions

Deployed set (17), from the verified post-#225 list plus #219's PT409/Resend changes:
- Workers: `dispatch-outbox`, `process-inbound`, `process-stripe-events`, `cleanup-abandoned-attachment`
- Twilio: `twilio-webhook`, `twilio-inbound-sms`, `twilio-message-status-callback`
- Resend: `resend-delivery-webhook`
- Prepare/recover/verify: `prepare-payment-delivery`, `prepare-external-record`, `prepare-lab-report`, `prepare-payment-collection`, `recover-payment-collection`, `verify-payment-reconciliation`
- Other: `ezyvet-import`, `agentmail-inbound-webhook`, `capture-inbound-attachment`

| Project | Redeployed | CLI "No change found" (already current) |
| --- | --- | --- |
| Staging | 13 | `resend-delivery-webhook`, `prepare-payment-delivery`, `agentmail-inbound-webhook`, `capture-inbound-attachment` |
| Primary | 16 | `resend-delivery-webhook` (#219 was already deployed on 2026-09-29) |

Retired functions:
- `send-provider-email` was deleted from staging.
- Neither `send-provider-email` nor `suggest-replies` is deployed on primary.
- `send-email` and `send-sms` are absent from both projects.

`process-stripe-events` is now deployed on primary (v21), which satisfies W2's "deploy before the Vault secrets".

## Not changed by this rollout

- The scheduler Vault secrets are still absent, so the jobs record `configuration_missing` (§9).
- `OUTBOUND_DELIVERY_MODE=disabled` and Stripe flags are still off on primary.
- `ESTIMATE_DECISION_*` secrets are not set, so the client estimate-link panel will report issuance unavailable.
