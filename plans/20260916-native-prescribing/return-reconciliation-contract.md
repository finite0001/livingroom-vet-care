# Native return reconciliation — implementation contract

Status: arithmetic foundation implemented and locally verified. No correction RPC, staff action, stock compensation or current release version is enabled by this checkpoint. Continue through backend, workspace and acceptance before claiming the return-correction workflow complete. This extends [physical returns](returns-rpc-contract.md), without restoring prescription allowance or changing billing.

## Decision

Use new sequence-bound compensation entries in the existing per-dispense return chain. Editing old events would erase their review context; a separate unversioned correction overlay would corrupt `native_return_verified` as-of replay. Every old event, request, receipt, source hash and stock movement remains unchanged. The reducer processes each correction only at its own sequence. SQL and TypeScript must agree on the same chronological arithmetic.

## Quantity mechanics

| Action | Target | Effect and bounds |
|---|---|---|
| `retract_intake` | Exact earlier ordinary intake event/hash | Reduce effective received and held; increase returnable quantity. Quantity <= still-held amount for that intake and <= target allocation quantity less prior retractions. Downstream disposition claims must be corrected first. |
| `retract_disposal` | Exact earlier ordinary disposal event/hash | Reduce effective disposal; increase held. The reviewer must attest the selected quantity was not actually destroyed and remains physically held. Actual disposal cannot be undone. |
| `retract_restock` | Exact earlier ordinary restock event/hash and original positive movements | Reduce effective restocked; increase held; atomically insert equal negative stock movements with exact target/allocation/lot links. Resulting available balance cannot be negative; explicitly attest the selected quantity is physically held after removal from available stock. Consumed or uncertain custody requires the discrepancy path. |

Every correction names the originating intake and the exact source event. Only original ordinary events may be targeted, never a correction of a correction. Partial repeated corrections are bounded per target event/allocation. An erroneous correction is remedied by a fresh ordinary intake, disposal or restock under current guards, preserving both claims. Understated quantities also use fresh ordinary actions. Fixed three-decimal quantities use integer thousandths; no floating-point arithmetic or inferred unit conversion. Net intake stays within original dispensed quantity even when gross recorded intake includes later-corrected claims. Net held, disposed and restocked quantities stay nonnegative. After every prefix, each intake must satisfy effective received = held + disposed + restocked; one intake cannot borrow another intake’s held quantity even when they share an original allocation. Gross recorded quantities and retracted quantities remain inspectable.

Correction does not edit custody/package/storage facts. To replace a mistaken intake claim, reconcile its downstream effects, retract the remaining effective intake, then record a fresh intake with explicitly reviewed facts. A fresh restock must satisfy current policy, product, lot, custody and DVM guards. Original pickup prohibition remains once any return history exists, including a fully corrected history.

## Unresolved physical discrepancies — required workflow

Insufficient available stock must not result in a successful restock correction, an invented receipt or negative inventory. Provide an attributed unresolved discrepancy identifying the exact source event, allocations, disputed quantities and observation. It must remain visible until reviewed reconciliation links the actual compensation or another explicit outcome. Wrong or newly unsafe custody claims affecting already-used/restocked quantities need this path, not an error message alone. Specify treatment of affected available lots and downstream dispensing before enabling this workflow; do not silently classify stock as safe. No generic stock adjustment or free-text note alone establishes completed reconciliation.

## Mutation and authorization contract

New correction decisions require active DVM authority and explicit physical-fact review. Current active staff may read or recover their own previously committed operation according to existing receipt boundaries. Use stable operation UUID, exact same-actor request replay, target event ID/hash, expected return head/context and server-observed chronology. Wrong patient/authorization/dispense/intake/allocation must fail. Recheck authority after waits. Restock retraction is a negative compensation, not new restock approval: disabling the positive restock policy must not prevent removal of an erroneous positive stock entry.

Lock order remains operation -> authorization -> product SHARE -> sorted original lots UPDATE for stock compensation. No invoice locks are needed. Preserve existing original positive movement invariant; introduce a distinct negative compensation kind and bidirectional immutable target/movement links with deferred validation. Do not call independently replayable public `adjust_inventory` and then save a separate parent decision. Concurrent normal return, correction, pickup, release, catalog and stock writers must share the relevant gates.

## Versioning and callers

Keep old return event/receipt/print/schema12 definitions verifiable. Introduce a new event version for compensation and explicitly version current read, intake, preview, page, print and release contracts; mixed historical/new event replay is required. Old current APIs must reject corrected targets rather than return misleading old totals; exact historical recovery/rendering stays available. Saved parent/fill releases become stale when correction or unresolved discrepancy evidence changes. Current selected output includes original claims, compensations, effective balances and unresolved status, while excluding financial internals.

The initial shared quantity reducer is an arithmetic dependency, not an authorization or stock-write boundary. Callers still verify target/source identity, hashes, actor, chronology, custody/policy and movement evidence. Its chronological fold can serve existing v1 validation now; correction input remains unavailable to existing v1 parsers until all backend/artifact versions are implemented.

## Implementation sequence and files

Repository root: `/Users/davidedler/livingroom-vet-native-prescribing`.

1. Create `supabase/functions/_shared/native-return-quantity-replay.ts` and `tests/prescriptions/return-quantity-replay.test.ts`; integrate existing v1 arithmetic in `supabase/functions/_shared/native-dispense-returns.ts`. Preserve v1 strict evidence validation and output. Compare original print fixtures and adversarial histories.
2. Add a new migration (never edit122) for sequence-bound correction events, SQL as-of replay, RPC preview/commit/recovery, negative stock links and unresolved discrepancy lifecycle. Exact JSON/version contract must precede frontend adapters. Extend SQL/concurrency fixtures and restore inventory.
3. Add strict adapters and reachable patient correction/reconciliation review with event selection, remaining quantity, explicit physical attestation, uncertain-write recovery and unresolved state. Preserve user drafts across refreshes.
4. Add current print/release versions and shared validation, migrate current UI selectors, retain historical output/recovery and source-byte gates. Include a synthetic Dr. Edler review example.
5. Run actual Auth/browser tests, observed contention, populated restore and complete CI. Stack implementation PRs on147. Hosted deployment and clinical/provider commissioning stay separate.

## Acceptance gates

- Exact partial/multiple-lot correction, all three action types, repeated partial compensation, per-event and per-intake caps, and zero-effective intake followed by valid new intake.
- Wrong target/allocation/intake/hash, cross-patient requests, correction-of-correction, zero/negative/exponent/excess precision, malformed UUIDs and overflow fail.
- Two intakes sharing one allocation cannot fund each other. Repeated retract -> fresh ordinary action -> retract cycles preserve per-source caps and per-intake conservation at every prefix.
- Historical before/after projections remain consistent and original artifacts unchanged. Fractional quantities and full numeric bounds use exact arithmetic.
- Competing corrections cannot exceed a source event; stock is compensated once on retry; role revocation after waits prevents new writes.
- Insufficient stock produces no compensation; unresolved discrepancy remains visible and cannot be silently closed. Later reconciliation preserves original and discrepancy evidence.
- Corrected unsafe custody cannot enable restock through a metadata edit. Current safeguards apply to every fresh stock addition.
- Saved releases invalidate under the same authorization gate, historical bytes stay verifiable, pagination and disclosure bounds remain explicit.
- No prescription allowance, invoice, credit, refund or provider effect. Financial association remains the following native phase.

## PostgreSQL replay checkpoint and performance constraint

Migration123 adds private immutable JSON replay and allocation validation only. All browser/service roles are denied direct execution. The current ordinary-event balance readers from122 remain unchanged. SQL/TypeScript differential vectors cover matching outputs and matching rejection, including long histories and gross quantities above a single allocation’s numeric limit.

An attempted adapter replacement exposed repeated full replay inside each historical verification prefix; the 100/101-event operational regression exceeded its120-second harness budget. That implementation was removed before commit. New correction-aware verification must compute required historical states in one pass (or an equivalently measured approach), not call full replay once per prior event. Retain the existing long-history regression and measure actual staff read/write paths before accepting the new verifier. This is a demonstrated implementation constraint, not a request to reduce the supported history.
