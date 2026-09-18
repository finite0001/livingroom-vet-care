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
