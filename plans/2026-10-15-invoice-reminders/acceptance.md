# Acceptance and release checklist

## Owner decisions recorded

- Affirm is installed per Dave; no new financing enrollment is requested.
- Due on receipt; email reminder stages 7/14/30 overdue.
- Existing invoices require explicit due date and enrollment; never backfill invented terms.

## Required engineering evidence

- Current-role/live-session matched actor; ADMIN practice policy; private RLS/history; immutable UUID recovery; stale version and wrong household denial.
- No implicit enrollment; paid/credited, void, pending checkout/refund, reconciliation, disabled policy, contact/consent and hold handling.
- Final-attempt balance/context check; actual observed invoice contention; changed unattempted snapshot preserved; uncertain delivery never automatically requeued.
- Genuine Auth/RPC writes and invoice browser save, navigation guard, reload, invalid cadence and mobile layout.
- Populated private policy/terms/jobs/actions/run and shared source restore. Clearly separate SQL fixture/probe claims from genuine Auth/HTTP and actual provider delivery.
- Application lint/typecheck/unit/build; canonical SQL regression; function-local frozen Deno check; exact-head CI.

## Hosted release order

1. Verify primary mgadheotkdnrsatfivjy and staging kothoqicubowyhwfsrte canonical baseline 189, pin function definitions/ACLs and backup metadata. Never use legacy ugpyjacqganaqtsiekay.
2. Apply only generated migration 20261015235157 to staging. Run a rollback-only synthetic SQL probe and real staged Auth/UI acceptance without provider requests.
3. Deploy queue-invoice-reminders with its function-local import map and unchanged JWT=false plus explicit server-side worker authentication. Initially leave INVOICE_REMINDERS_ENABLED absent/false and cron inactive; verify closure.
4. Apply/verify primary schema and function before its frontend merge/deployment. Compare unaffected histories and function/ACL scopes; run advisors and exact deployment/domain checks.
5. Commission the owner-approved practice policy and due-on-receipt/7/14/30 exact wording, worker environment and hourly cron explicitly. The scheduler only discovers work during Denver 09:00-16:59; transport remains in the existing outbox. Check current OUTBOUND_DELIVERY_MODE and existing test/live constraints; do not switch unrelated channels/clinical automation.
6. Do not enroll any existing invoice automatically. Rehearse on owned synthetic/test recipients only. A clinical approval email response is not required for the confirmed business cadence; clinical/SOP gates remain separate.
7. Verify policy/worker/cron status and first run receipt. A failed or ambiguous queue ACK recovers read-only; transport uncertainty needs reconciliation. Observe Daily communications and invoice reminder history.

Rollback: disable worker/cron and/or publish a disabled practice policy. Keep all issued invoices, money evidence, immutable reminder snapshots and attempted-send history. Never drop the ledger as a rollback.

## Subsequent requested work

After unpaid-reminder implementation/verification, apply reverse-engineer-anything to authorized VetRec and VetRocket targets. Inspect session state first, keep a question/evidence ledger and distinguish observed UI/runtime behavior, published claims and design choices. Recreate native workflows; do not treat UI inspection as proof of a PACS integration or clinical approval.
