# Native prescribing, refills and dispensing

Status: implementation in progress; contract independently reviewed. Configuration, draft revisions, DVM signing, cancellation/replacement, current status and order-copy UI are implemented. Local SQL, Auth/API, browser and observed cancellation/replacement contention checks pass. Refill dispensing, record-release integration, populated restore and clinical approval remain outstanding.

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

## Next bounded slice: native refill intake and authorization links

The existing refill queue directly writes `APPROVED`, `READY` and `PICKED_UP` with browser timestamps and no authorization/dispense receipt. There is no `FILLED` status. Both the dropdown and direct authenticated/service-role table grants must be addressed; UI-only restrictions would leave the bypass open.

Preserve old requests as explicitly unverified legacy history. Add server-attributed versioned intake, assignment, exact patient/household/authorization links and operational close/deny transitions with recoverable immutable receipts. Replace direct writes in `use-refills.ts` and status-based clinical message defaults in `RefillsPage.tsx`. Keep durable message delivery through the existing reviewed send dialog. Queue reads need explicit errors, pagination and actor scoping. No legacy status becomes native prescribing or dispensing authority.

After intake, add separately reviewed fulfillment: exact authorization/head, initial/refill slot, partial remainder, current alerts, product/unit, lots, draft invoice and price. One transaction must consume allowance, record the dispense, debit stock, add invoice charges and update the linked request. Slot closure and pickup acknowledgment remain separate actions; neither recreates allowance. The current usage projection stays unknown until this accounting exists.

## Next native work, still in scope

Estimates/client acceptance, conversation attachments, send-later/follow-up sequences, the broader unassessed parity catalog, Antech commissioning, provider acceptance and clinical/operational launch checks remain tracked in the feature matrix. Stripe commissioning remains owner-deferred.

## Unresolved clinical/operational inputs

Dr. Susan Edler must review prescription fields, prescriber eligibility, partial-fill workflow, required label content, expiry/renewal policy and delegated dispensing permissions. These are configurable/manual decisions, not inferred drug rules. Controlled-medication and external-pharmacy electronic workflows require their own verified requirements and acceptance; this plan does not claim those are implemented or remove them from the parity audit. Synthetic implementation can proceed with explicit test configuration while live authorization remains uncommissioned.

## Verified lifecycle checkpoint

[Evidence](../../docs/evidence/native-prescribing-lifecycle-20260916.json): exact115 migrations,64 SQL assertions,30 real Auth/PostgREST checks through strict frontend API,646 unit tests and17 relevant browser tests. Owned containers/volumes/private runtime removed. These are local lifecycle results; observed contention, populated native restore and the remaining full-workflow phases are not claimed complete.

## Verified cancellation and replacement checkpoint

[Evidence](../../docs/evidence/native-prescribing-events-20260916.json): 116 migrations; upgrade preserved an existing synthetic signed authorization exactly; 111 SQL assertions, 52 real Auth/API checks, 24 observed two-DVM contention checks, 652 unit tests and 20 browser cases passed. Owned scratch database, runtime containers/volumes and private files removed. These results do not establish dispensing, native release integration, populated restore, provider acceptance or clinical approval.
