# Native prescribing, refills and dispensing

Status: implementation in progress; contract independently reviewed. Recoverable frontend operation state/editor and versioned print components exist; database/API/workflow integration and clinical approval remain outstanding.

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
| [1. Authority and data lifecycle](implementation-contract.md#authority-and-records) | Planned | Draft/sign/cancel/replacement, strict requests and recoverable receipts; close legacy direct status bypass |
| [2. Fill and stock/billing transaction](implementation-contract.md#fill-allowances-and-atomic-dispensing) | Planned | Partial-fill allocation, exact retry, deterministic locking, stock/charge links |
| [3. Patient and refill workspace](implementation-contract.md#staff-workflows) | In progress | Reachable guarded editors, DVM signing, staff fulfillment, current history |
| [4. Labels and record release](implementation-contract.md#labels-and-record-release) | In progress | Frozen print artifacts and explicit selection in record packages |
| [5. Acceptance and rollout](implementation-contract.md#verification-and-rollout) | Planned | SQL/concurrency/runtime/browser/restore evidence, clinical review pack, stacked implementation PR |

Implement phases 1–4 as a coherent local workflow before claiming feature completion. Intermediate backend commits may be stacked, but must not expose an unguarded or misleading workflow. Keep hosted changes separately coordinated with compatible UI/SQL and current ledger checks.

## Parallel responsibilities

Database owner: new native migration, SQL/concurrency fixtures and runtime contract. Frontend owner: strict API/state and patient/refill UI once RPC contract is fixed. Artifact owner: label renderer and release version integration after signed/fill snapshots are fixed. Root: contract reconciliation, full-path acceptance and PR integration. Use isolated worktrees; no shared migration-version allocation without coordination.

## Next native work, still in scope

Estimates/client acceptance, conversation attachments, send-later/follow-up sequences, the broader unassessed parity catalog, Antech commissioning, provider acceptance and clinical/operational launch checks remain tracked in the feature matrix. Stripe commissioning remains owner-deferred.

## Unresolved clinical/operational inputs

Dr. Susan Edler must review prescription fields, prescriber eligibility, partial-fill workflow, required label content, expiry/renewal policy and delegated dispensing permissions. These are configurable/manual decisions, not inferred drug rules. Controlled-medication and external-pharmacy electronic workflows require their own verified requirements and acceptance; this plan does not claim those are implemented or remove them from the parity audit. Synthetic implementation can proceed with explicit test configuration while live authorization remains uncommissioned.
