# Unpaid invoice reminders

Owner direction October 15: Affirm is installed; treat financing provider selection as resolved by the owner. Build unpaid-invoice reminders next, then invoke reverse-engineer-anything for VetRec and VetRocket. This does not commission unrelated clinical rules or automatically verify a live financing transaction.

## Contract

- Reuse canonical invoice obligation, confirmed payments/refunds, reconciliation blockers and communication outbox. No new payment ledger or lender installment tracking.
- Versioned ADMIN-approved practice policy: default terms, ordered overdue-day offsets, channel-specific exact wording/contact instructions and explicit enabled state. Preserve original decisions. No policy or legacy invoice enrollment is seeded by migration.
- Staff explicitly saves invoice due date, reminder enrollment, channel, hold/dispute/bereavement reason and conversation under a matched live staff session. New invoice defaults are proposals until saved; no legacy invoice silently becomes overdue.
- Reminder messages show the current clinic balance and approved contact/payment instructions. Existing reviewed payment-link delivery remains available through the invoice payment panel; do not invent or persist a new lender/payment capability.
- Select only the most recent reached cadence stage to avoid a catch-up burst. One attempted send per invoice/stage/terms revision; invoice-wide minimum 24 hours between attempted reminders. Retries and uncertain provider outcomes retain original identities; no automatic retry of an uncertain send.
- Fresh balance/contact/policy/terms/consent eligibility at queue and immediately before attempt. Lock order policy gate -> invoice -> outbox. Changes before attempt suppress old content; a later queue pass may rebuild an unattempted stale stage with current balance. Payment after attempt start remains a truthful race boundary, not a recalled email.
- A financial reminder does not follow routine deceased-patient care suppression; staff apply an explicit bereavement hold. No automated medical decision.
- Private append-only policy, terms and job history, RLS and revoked direct writes; trusted worker only queues; existing dispatcher alone sends. UI receives bounded authenticated RPC projections.
- Expose due date, balance, next stage, hold and delivery history inside invoice details; practice defaults require ADMIN. Staff actions recover exact immutable UUID receipts after ambiguity.

## Validation and rollout

Meaningful SQL eligibility/idempotency/permission/history tests; current ledger suppression after payment/credit/void/hold/contact/consent changes; actual lock-order races; worker auth/disabled/bounded-input tests; form schemas and built browser invoice workflow. Run application checks and canonical regression; update pinned migration/test inventories deliberately. Expand the isolated controlled engine compatibility harness deliberately to the 190-migration canonical baseline; preserve all ten original stock-writer definitions and keep its production activation separate. Stage migration and affected functions before UI release; hosted rollback probes and live queue gates checked before activation. No live customer message is a test.

Dave confirmed due-on-receipt and email at 7/14/30 overdue in this session. The migration still seeds no policy or legacy enrollment; the UI proposes those accepted defaults. Practice enablement, worker/cron and outbound test/live gates remain explicit commissioning steps.
