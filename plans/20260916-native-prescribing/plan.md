# Native prescribing, refills and dispensing

Status: implementation in progress; contract independently reviewed. Configuration, draft revisions, DVM signing, cancellation/replacement, current status and order-copy UI are implemented. Local SQL, Auth/API, browser and observed cancellation/replacement contention checks pass. Native refill intake and exact authorization linking are now locally verified. Dispensing, record-release integration, populated restore and clinical approval remain outstanding.

Base: `50a27d7`, stacked after PR143. Working root: `/Users/davidedler/livingroom-vet-native-prescribing`. Scope follows [standalone direction](../../docs/standalone-platform-direction-20260916.md) and the [feature matrix](../../docs/standalone-feature-matrix-20260916.md). This is one component of full practice parity, not a replacement for the remaining roadmap.

## Outcome

A veterinarian can authorize a prescription for a native patient. Staff can process a linked refill request, review the current authorization and alerts, record a full or partial fill against a specific allowance, and receive an immutable receipt tying the dispensed quantity to stock and billing. Labels and selected medical-record packages reproduce the signed instructions and actual fills. None of this depends on ezyVet, creates an administration record, or sends a message automatically.

## Evidence and design

- Current `src/hub/pages/RefillsPage.tsx` and `src/hub/hooks/use-refills.ts` change operational status directly, including APPROVED. They do not establish a prescription or dispensing authority.
- Native treatment RPC atomically records stock and charges but represents administration. It must not be called to disguise take-home dispensing.
- General clinical signing permits active staff. Prescribing requires a new explicit DVM authority contract, with separately reviewed credentials/clinical commissioning.
- Signed authorization, fill allowance and physical dispensing are separate records. Cancellation cannot erase a fill or automatically refund/return stock.
- Use dedicated native records. Imported prescription history remains historical evidence and cannot become an authorization implicitly.

## Phases

| Phase | State | Deliverable |
|---|---|---|
| [1. Authority and data lifecycle](implementation-contract.md#authority-and-records) | In progress | Draft/sign/cancel/replacement, strict requests and recoverable receipts; close legacy direct status bypass |
| [2. Fill and stock/billing transaction](implementation-contract.md#fill-allowances-and-atomic-dispensing) | Planned | Partial-fill allocation, exact retry, deterministic locking, stock/charge links |
| [3. Patient and refill workspace](implementation-contract.md#staff-workflows) | In progress | Reachable guarded editors, DVM signing, staff fulfillment, current history |
| [4. Labels and record release](implementation-contract.md#labels-and-record-release) | In progress | Frozen print artifacts and explicit selection in record packages |
| [5. Acceptance and rollout](implementation-contract.md#verification-and-rollout) | Planned | SQL/concurrency/runtime/browser/restore evidence, clinical review pack, stacked implementation PR |

Implement phases 1–4 as a coherent local workflow before claiming feature completion. Intermediate backend commits may be stacked, but must not expose an unguarded or misleading workflow. Keep hosted changes separately coordinated with compatible UI/SQL and current ledger checks.

## Parallel responsibilities

Database owner: new native migration, SQL/concurrency fixtures and runtime contract. Frontend owner: strict API/state and patient/refill UI once RPC contract is fixed. Artifact owner: label renderer and release version integration after signed/fill snapshots are fixed. Root: contract reconciliation, full-path acceptance and PR integration. Use isolated worktrees; no shared migration-version allocation without coordination.

## Native refill intake and authorization links — implemented

The prior refill queue directly wrote `APPROVED`, `READY` and `PICKED_UP` with browser timestamps and no authorization/dispense receipt. There is no `FILLED` status. The new workflow removes that dropdown and closes direct authenticated/service-role writes plus indirect legacy mutation paths.

Old requests remain explicitly unverified, read-only history. Server-attributed intake, assignment, exact patient/household/authorization links and operational close/deny transitions now have recoverable immutable receipts. Validated RPCs replace direct writes in `use-refills.ts`; neutral drafts replace status-based clinical message defaults in `RefillsPage.tsx`. Keep durable message delivery through the existing reviewed send dialog. Queue reads need explicit errors, pagination and actor scoping. No legacy status becomes native prescribing or dispensing authority.

After intake, add separately reviewed fulfillment: exact authorization/head, initial/refill slot, partial remainder, current alerts, product/unit, lots, draft invoice and price. One transaction must consume allowance, record the dispense, debit stock, add invoice charges and update the linked request. Slot closure and pickup acknowledgment remain separate actions; neither recreates allowance. The current usage projection stays unknown until this accounting exists.

## Next native work, still in scope

Estimates/client acceptance, conversation attachments, send-later/follow-up sequences, the broader unassessed parity catalog, Antech commissioning, provider acceptance and clinical/operational launch checks remain tracked in the feature matrix. Stripe commissioning remains owner-deferred.

## Unresolved clinical/operational inputs

Dr. Susan Edler must review prescription fields, prescriber eligibility, partial-fill workflow, required label content, expiry/renewal policy and delegated dispensing permissions. These are configurable/manual decisions, not inferred drug rules. Controlled-medication and external-pharmacy electronic workflows require their own verified requirements and acceptance; this plan does not claim those are implemented or remove them from the parity audit. Synthetic implementation can proceed with explicit test configuration while live authorization remains uncommissioned.

## Verified lifecycle checkpoint

[Evidence](../../docs/evidence/native-prescribing-lifecycle-20260916.json): exact115 migrations,64 SQL assertions,30 real Auth/PostgREST checks through strict frontend API,646 unit tests and17 relevant browser tests. Owned containers/volumes/private runtime removed. These are local lifecycle results; observed contention, populated native restore and the remaining full-workflow phases are not claimed complete.

## Verified cancellation and replacement checkpoint

[Evidence](../../docs/evidence/native-prescribing-events-20260916.json): 116 migrations; upgrade preserved an existing synthetic signed authorization exactly; 111 SQL assertions, 52 real Auth/API checks, 24 observed two-DVM contention checks, 652 unit tests and 20 browser cases passed. Owned scratch database, runtime containers/volumes and private files removed. These results do not establish dispensing, native release integration, populated restore, provider acceptance or clinical approval.

## Verified refill intake checkpoint

[Evidence](../../docs/evidence/native-refill-intake-20260916.json): 117 migrations, unchanged legacy READY record after upgrade, 162 SQL assertions, 79 real Auth/API checks, 26 observed concurrency checks, 662 unit tests and 18 browser cases. Queue reads use verified snapshots without accumulating authorization write locks. Owned runtime cleanup verified. Next: implement dispensing from the [proposed contract](dispensing-rpc-contract.md), resolving its queued-price-update/product/lot locking gate before claiming acceptance.

## Inventory prerequisite118 and fulfillment adapter checkpoint

The additive inventory patch preserves clinical alerts and invoice locking while acquiring product SHARE before lot UPDATE; receive/adjust/treatment also recheck active staff after request waits. Real three-writer tests verify exact product ownership and both arrival schedules. PostgreSQL allows compatible SHARE acquisition while a catalog UPDATE queues, so the original direct-blocker assumption was removed; no old deadlock is claimed. A prior-order negative control fails the exact ownership check.

The strict fulfillment adapter and V2 usage/refill parsers are preparation for119, with historical V1 compatibility retained. They do not enable dispensing in the UI or establish backend fulfillment. See [checkpoint evidence](../../docs/evidence/native-inventory-locking-20260916.json) for final counts, source hashes and limitations. Next: implement the atomic dispensing backend against the reviewed contract, then staff workflow, selected releases and populated restore.

## Native fulfillment119 checkpoint

Migration119 and the staff workspace implement initial/refill slots, partial and multiple-lot dispensing, one atomic invoice charge, explicit remainder forfeiture, separate pickup, V2 native allowance and linked operational request events. Staff can recover the exact operation after an uncertain response, inspect bounded histories and print the exact saved fill with fresh authorization status. Sibling authorization/fulfillment panels invalidate their evidence after confirmed operations without discarding drafts or uncertain requests. Historical V1 receipts remain unchanged.

See [native fulfillment evidence](../../docs/evidence/native-fulfillment-20260916.json) for exact tested source, runtime counts and limits. The next implementation work is native record-release schema10 integration, then explicit correction/return/credit linkage and the remaining full practice/communications roadmap. Clinical approval, provider commissioning and full hosted disaster recovery remain open.

## Native selected record-release120 checkpoint

Schema10 now explicitly selects immutable signed orders and actual dispenses, preserving signed context, frozen status/usage and separate pickup. Invoice references and operational context are excluded from the clinical projection. Historical schemas1–9, original-byte verification and dynamic policy acceptance remain intact. Source changes invalidate later delivery; uncertain confirmations retain their exact request.

See [native release evidence](../../docs/evidence/native-record-releases-20260916.json) for local verification. Next: explicit correction/return/credit linkage, followed by remaining native practice/communications features and hosted/clinical/provider acceptance. No live policy or provider gate was enabled.

## Native correction121 and physical return122 checkpoints

Immutable correction annotations and pickup amendments are implemented with printV2/schema11 evidence; PR146 and its preceding PR145 have green frontend, database and Edge CI. Physical returns now support exact-lot intake, held quantities, partial disposal and DVM-reviewed eligible restocking, with immutable receipts, printV3 and schema12 selected record releases. Return stock links commit atomically and never recreate prescription allowance or automatically credit an invoice. Restocking defaults to disabled.

See [return evidence](../../docs/evidence/native-dispense-returns-20260916.json) and [clinical review](returns-review.md). Local verification passed: 793 unit tests; 404 fresh Auth/browser workflow checks; 73 populated restore checks; 72 observed contention checks; 896 assertions across 23 SQL suites followed by an expanded return suite (907 distinct assertions). These are synthetic local results, not hosted or clinical acceptance.

Next: explicit return claim/quantity correction and reconciliation, then dispense-linked credit/refund association using the existing financial ledgers. Estimates/client acceptance, communications attachments and follow-ups, remaining native parity assessment, hosted rollout, Dr. Edler review and provider commissioning remain open. The platform remains independent of ezyVet; source integration gates remain disabled.

## Return reconciliation foundation

[Implementation contract](return-reconciliation-contract.md) defines sequence-bound intake/disposal/restock retractions, as-of balance replay and the required unresolved-discrepancy path when stock compensation is unavailable. The shared arithmetic reducer is integrated into existing v1 disclosure validation; it does not expose correction requests or establish stock/clinical authorization. Next implement the additive database contract and current read/artifact versions, followed by the staff review and full acceptance paths. Keep this feature incomplete until those workflows are reachable and verified.

Foundation verification: 821 unit tests, lint, app TypeScript, production build and Edge type checks passed. Focused native fulfillment/release browser coverage passed. Historical full/order-only example bytes match the pre-refactor renderer. See [evidence](../../docs/evidence/native-return-replay-20260916.json). This is an implemented arithmetic dependency, not a completed correction workflow.

## PostgreSQL quantity replay123 checkpoint

Two private immutable helpers now reproduce the TypeScript correction arithmetic. Current ordinary return readers and writes remain unchanged; the attempted full-replay adapter was removed after the long-history regression exposed repeated-prefix cost. Correction mutation and discrepancy workflows remain required, with single-pass historical verification as a measured design constraint.

[Evidence](../../docs/evidence/native-return-database-replay-20260916.json): 78 matching cross-language cases (48 valid,30 rejected); 965 assertions across24 SQL suites; exact preservation of101 existing return events;404 fresh actual Auth/browser checks and73 populated restore checks;821 unit tests, lint, TypeScript and build. All provider requests were zero. The separate Settings selector CI fix is propagated to147/148; PR147, PR148 and PR149 now have passing CI at1faf791,fb2e2f4 andbee4444 respectively.


## Current reconciliation workflow124/125 — in verification

The local working branch adds actual correction commands, discrepancy decisions and lot holds; the staff review/recovery interface; current print4/schema13 composition; and provider-free acceptance fixtures. Preserve the immutable originals and older saved artifact formats. See [clinical review](reconciliation-review.md).

Do not treat this phase as complete until SQL, actual Auth/browser, contention, populated restore and inherited artifact checks pass. Initial renderer and strict transport tests pass; database runtime and broader browser verification are ongoing. Hosted deployment, clinical acceptance and external payment acceptance remain separate.
