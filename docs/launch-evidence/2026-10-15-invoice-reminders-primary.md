# Unpaid invoice reminders — primary backend installation

The primary application backend `mgadheotkdnrsatfivjy` has canonical migrations 190 and 191 installed: `20261015235157_unpaid_invoice_reminders.sql` and additive `20261016004714_invoice_reminder_care_gate_order.sql`. The generated CLI dry run selected exactly those two migrations, no seeds and no roles. Legacy `ugpyjacqganaqtsiekay` was not used.

[Machine receipt](2026-10-15-invoice-reminders-primary.json) · [Staging](2026-10-15-invoice-reminders-staging.md) · [Local proof](2026-10-15-invoice-reminders-local.md)

## Verified

All 16 protected business-table fingerprints matched the refreshed preflight after both DDL and the rollback-only probe. The probe passed 53 assertions, leased only four new fixture invoices, used a temporary sandbox profile entirely inside the rolled-back transaction, and made zero provider requests. No payment provider profile, invoice, policy, terms, job, run or action fixture persisted in primary. The three pre-existing outbox records and their attempt histories remained unchanged.

The preserved predecessor function hashes match the pinned preflight definitions after normalizing only their renamed headers. Five reminder families have RLS and owner-only raw privileges. Old helpers remain owner-only; the public attempt wrapper retains service-only execute. The correction retains invoker rights and owner-only access for the lock helper, acquiring care eligibility before the reminder gate, then invoice/outbox locks in the caller. Actual care-gate and invoice contention were independently proved in the owned 191-migration local runtime.

Security advisors reported five notice keys, with the same four WARN keys and no ERROR. The INFO family gained five intentionally private RLS/no-direct-policy tables; that is distinct from a new warning or newly exposed table.

`queue-invoice-reminders` is ACTIVE version 1, with its function-local import map and `verify_jwt=false`; the handler checks the configured server key explicitly. Its bundle SHA-256 matches staging: `e792d5fd2823371bd08d8ef7370dfa0ba9dff44b4fb48a34fe7e2dfe28a402f8`. Real deployed HTTP checks passed: anonymous POST 401, invalid explicit key 401, authorized disabled POST 200 and GET 405. The authorized response was `disabled=true`, `queued=0`, `dispatched=false`.

## Current release boundary

**Backend installation is complete; frontend merge and practice commissioning are pending.** The hourly cron is inactive, the worker gate is closed and no primary practice policy or invoice enrollment exists. No customer reminder was sent. Do not describe this receipt as live reminder activation.

The owner-approved defaults remain due on receipt and email at 7, 14 and 30 days overdue. After frontend release, an actual current ADMIN session must approve the practice wording/cadence; the worker and hourly cron must then be commissioned with the existing outbound test/live mode verified. Existing invoices require explicit enrollment. Do not change unrelated clinical, controlled-drug, financing or channel gates. Affirm remains installed per the owner's confirmation.
