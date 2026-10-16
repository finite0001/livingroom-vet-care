# Unpaid invoice reminders - local engineering acceptance

Dave confirms Affirm is already installed. The requested business defaults are due on receipt and email reminders at 7, 14 and 30 days overdue. This package adds versioned practice wording/cadence, explicit per-invoice due date/enrollment, pause/dispute/bereavement holds, a durable worker and Daily communications history. It does not enroll existing invoices or collect Affirm installments.

[Machine receipt](2026-10-15-invoice-reminders-local.json), [plan](../../plans/2026-10-15-invoice-reminders/plan.md), [rollout checklist](../../plans/2026-10-15-invoice-reminders/acceptance.md).

## What passed

- Application: 1,480 unit tests, type checks and build; zero lint errors and the four existing refresh warnings.
- Canonical database: all 156 SQL suites / 6,593 assertions passed against the 190-migration release. The focused reminder suite has 53 assertions, including real canonical payment evidence after enqueue, credit/void/hold/policy changes, exact UUID recovery, role/session/household restrictions and immutable private history.
- Final fresh owned runtime: the 53 reminder assertions and a separately scoped 53-check hosted-style rollback probe passed. The latter leases only four new fixture invoices and cannot claim pre-existing outbox work.
- The real Auth/PostgREST/browser harness recorded **44 combined assertions**, 11 browser checks and one observed worker/invoice lock queue. These 44 include SQL-only migration/isolation and populated-restore assertions; they are not 44 independent genuine HTTP checks. Actual Auth covers ADMIN/staff writes, private-table denial, matched actors, repeat UUIDs, queue receipts, final-attempt suppression and offboarding. The contender's credit is a canonical SQL mutation in the owned held transaction; it is not represented as a second genuine Auth write.
- Browser: invoice enrollment/hold editing, retained edits across household tabs, confirmation on leaving the household, save/reload, invalid cadence, 390px and 1280px layouts, and zero page errors. No RPC result was mocked and browser traffic was restricted to the owned UI and localhost backend.
- Populated public/auth/storage/extensions dump and restore preserved all **396 relation fingerprints**. All five reminder families and their shared source histories survived; restored authenticated SQL could read the saved paused state. This is not a new physical Storage-object backup claim.
- Repeatable-read and serializable mutation attempts reject the exact READ COMMITTED requirement. This is SQL-only evidence.
- Function-only frozen Deno type checking and bundling passed without root Node dependencies. The full transitive SDK bundle is pinned in the function-local lock.
- Every owned runtime, clone, container, volume and private working directory was removed. Synthetic Auth sessions were retired. No provider HTTP request or hosted data mutation occurred in this local proof.

## Implementation boundaries

The current canonical payment ledger is the only balance source. A pending checkout/refund or unresolved reconciliation blocks financial reminders. A current invoice/policy/terms/contact snapshot is checked again under invoice-before-outbox locks before attempt start. Changes committed afterward cannot recall an email; attempt-start ordering is the stated boundary.

Discovery selects only the newest reached cadence stage, avoiding catch-up bursts; attempted stages and invoice-wide 24-hour spacing prevent repeated reminders. An unattempted stale snapshot remains historical while a current replacement may queue. Uncertain transport results require reconciliation. Messages use reviewed balance/contact instructions; existing reviewed payment-link delivery remains available in the invoice payment workflow.

Policy, terms, actions, jobs and queue-run receipts have private RLS and revoked raw access. Mutations require a matched current staff session; practice defaults require ADMIN. Reminder wording and placeholder values are plain text. An automation approval is not a new medical attestation.

Migration 190 creates no practice policy, no legacy enrollment and an inactive hourly cron. Worker enablement, actual practice policy, staging/primary rollout and final exact-head CI remain release steps. Clinical policies/Susan's controlled-drug SOPs stay inactive. PR #259 is a separate unmerged controlled-engine hardening branch; it is not included here.
