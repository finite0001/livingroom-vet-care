# Unpaid invoice reminders - local engineering acceptance

Dave confirms Affirm is already installed. The requested business defaults are due on receipt and email reminders at 7, 14 and 30 days overdue. This package adds versioned practice wording/cadence, explicit per-invoice due date/enrollment, pause/dispute/bereavement holds, a durable worker and Daily communications history. It does not enroll existing invoices or collect Affirm installments.

[Machine receipt](2026-10-15-invoice-reminders-local.json), [plan](../../plans/2026-10-15-invoice-reminders/plan.md), [rollout checklist](../../plans/2026-10-15-invoice-reminders/acceptance.md).

## What passed

- Application: 1,480 unit tests, type checks and build; zero lint errors and the four existing refresh warnings.
- Canonical database: all 156 SQL suites / 6,597 assertions passed against the 191-migration release. The focused reminder suite has 57 assertions, including real canonical payment evidence after enqueue, credit/void/hold/policy changes, exact UUID recovery, role/session/household restrictions, immutable private history and lock/ACL contracts.
- Final fresh owned runtime: the 57 reminder assertions and a separately scoped 53-check hosted-style rollback probe passed. The latter leases only four new fixture invoices and cannot claim pre-existing outbox work.
- The real Auth/PostgREST/browser harness includes 11 browser checks and two observed waits: worker/invoice contention and worker/care-gate contention. Combined assertions include SQL-only migration/isolation and populated-restore checks; they are not all independent genuine HTTP checks. Actual Auth covers ADMIN/staff writes, private-table denial, matched actors, repeat UUIDs, queue receipts, final-attempt suppression and offboarding. Competitor credit/hold mutations run in owned SQL transactions, not as second genuine Auth writes. The care-gate holder can lock the same outbox and commit a bereavement hold while the worker waits, proving the corrected order avoids the prior inversion.
- Browser: invoice enrollment/hold editing, retained edits across household tabs, confirmation on leaving the household, save/reload, invalid cadence, 390px and 1280px layouts, and zero page errors. No RPC result was mocked and browser traffic was restricted to the owned UI and localhost backend.
- Populated public/auth/storage/extensions dump and restore preserved all **396 relation fingerprints**. All five reminder families and their shared source histories survived; restored authenticated SQL could read the saved paused state. This is not a new physical Storage-object backup claim.
- Repeatable-read and serializable mutation attempts reject the exact READ COMMITTED requirement. This is SQL-only evidence.
- Function-only frozen Deno type checking and bundling passed without root Node dependencies. The full transitive SDK bundle is pinned in the function-local lock.
- Every owned runtime, clone, container, volume and private working directory was removed. Synthetic Auth sessions were retired. No provider HTTP request or hosted data mutation occurred in this local proof.

## Implementation boundaries

The current canonical payment ledger is the only balance source. A pending checkout/refund or unresolved reconciliation blocks financial reminders. A current invoice/policy/terms/contact snapshot is checked again under care-eligibility, reminder, invoice and outbox locks, in that order, before attempt start. Migration 191 adds the existing care gate before the new reminder gate; the already-staged migration 190 is preserved. Changes committed afterward cannot recall an email; attempt-start ordering is the stated boundary.

Discovery selects only the newest reached cadence stage, avoiding catch-up bursts; attempted stages and invoice-wide 24-hour spacing prevent repeated reminders. An unattempted stale snapshot remains historical while a current replacement may queue. Uncertain transport results require reconciliation. Messages use reviewed balance/contact instructions; existing reviewed payment-link delivery remains available in the invoice payment workflow.

Policy, terms, actions, jobs and queue-run receipts have private RLS and revoked raw access. Mutations require a matched current staff session; practice defaults require ADMIN. Reminder wording and placeholder values are plain text. An automation approval is not a new medical attestation.

Migration 190 creates no practice policy, no legacy enrollment and an inactive hourly cron. Migration 191 corrects only the shared lock helper and retains owner-only access. Worker enablement, actual practice policy, frontend release and final exact-head CI remain release steps. [Primary backend installation](2026-10-15-invoice-reminders-primary.md) is recorded separately. [Staged acceptance](2026-10-15-invoice-reminders-staging.md) is recorded separately. Clinical policies/Susan's controlled-drug SOPs stay inactive. PR #259 is a separate unmerged controlled-engine hardening branch; it is not included here.
