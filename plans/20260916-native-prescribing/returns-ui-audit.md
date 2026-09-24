# Physical return intake and disposition — native workspace audit

Status: read-only UI proposal on `codex/native-dispense-returns`. No return RPC, quantities or lifecycle are implemented by this document. The forthcoming exact server contract controls field names, allowed transitions, authority, projections and limits. Physical return intake is distinct from the now-implemented immutable annotation/pickup amendment flow.

## Existing integration points

`src/hub/features/prescriptions/PrescriptionFulfillment.tsx` owns saved dispense cards, original immutable lot allocations, independent history pagination, label printing and the shared authorization evidence revision. Its `correctionTarget` mounts `PrescriptionFulfillmentCorrections.tsx`; `correctionDirty` already joins the parent's single patient draft guard. Add a separate `PrescriptionFulfillmentReturns.tsx` and strict `fulfillment-returns-api.ts`, rather than assigning physical custody meaning to an annotation.

Add “Record physical return” / “View return history” to the exact saved dispense card. Preserve original dispense ID/hash and original per-lot allocations throughout review. Patient, medication, original dispensing time and unit precede technical IDs. A return must remain reachable on historical cancelled/expired orders and archived patients if the server permits: present order status as context, not authority to manufacture another dispense. A disputed pickup acknowledgment alone is neither proof that nothing left the practice nor proof that medication physically returned.

`usePrescriptionOperation.ts` and `prescription-state.ts` already freeze a UUID and complete JSON request at review, recover first after uncertain writes, retain identity after later stale/role rejection, isolate actor/patient generations, and clear only after strict receipt matching. Reuse them through the new strict adapter. Original authorization, dispense, pickup and correction records remain immutable.

## Intake: explicit quantities and custody

The editor should show one row per original dispense allocation, sourced from the immutable receipt rather than live catalog search:

| Display | Meaning |
|---|---|
| Original lot number, expiry, original quantity and unit | Frozen evidence of what was dispensed; not proof of returned-item identity |
| Previously recorded returned quantity | Aggregate of immutable accepted physical intake records for this original allocation |
| Remaining quantity eligible to record as returned | Original allocated amount minus all recorded returns; not prescription allowance |
| Held quantity | Recorded returned material still in practice custody, unavailable for dispensing |
| Disposed quantity | Recorded material with an explicit completed disposal event |
| Quantity received now | Explicit staff input; blank initially, no default full quantity |

These are separate balances. A disposition moves quantity out of a specific held-return balance, not out of remaining-to-return again. Use decimal strings with server-agreed precision, exact decimal arithmetic for local feedback, and server validation after fresh review; never use floating-point summation for authoritative quantities. Restrict choices to the original lot IDs, but require staff to attest how returned material was identified. Do not infer a known lot from same product/name or silently allocate an unidentified quantity across lots. If uncertain identity is unsupported in the exact contract, show why the intake cannot be assigned and direct staff to the separately defined unresolved-custody workflow; do not claim this first slice supports it.

Require an actual receipt/custody narrative, condition assessment using explicit contract fields, return reason, staff identity, actual received time if supported, and where held material is physically located. Distinguish server recorded time from asserted occurrence time. Do not prefill a claim that packaging is sealed, storage was suitable, or material is fit for reuse. If original pickup is missing/disputed, allow a truthful staff attestation only according to the server contract; no automatic fake pickup or pickup amendment.

## Held and disposed lifecycle

Proposed first slice: every accepted physical intake enters **Held — unavailable for dispensing**. A separate “Record completed disposal” action targets a particular intake record and original allocation, reviews its remaining held quantity and records actual disposition quantity, reason, staff and occurrence evidence. This is a proposal pending the server contract; if initial disposed intake is supported, it must require equally explicit completed-disposal evidence and disclose both physical receipt and disposition.

Partial disposal is useful: the screen must retain the remaining held balance and show each immutable disposal event. Never label a plan to dispose as already disposed. Do not use “quarantine” as a claim of a supported physical-location or regulatory workflow unless the implemented fields support it. “Held — unavailable for dispensing” describes the limited software behavior accurately.

Parent scope clarification: this increment includes held intake, disposal **and guarded return to available stock**. “Refund”, “Reverse dispense”, “Restore refill” and “Undo return” are not part of it. Intake/disposal copy must distinguish the later stock action: “Recording receipt or disposal does not change available stock, charges, payments or prescription allowance. A separately reviewed restock can increase available stock only.” Accounting credit and cash refund remain independent future actions with their own reviewed evidence.

Restock is disabled by default. Expose “Review return to available stock” on exact held records with all server-reported ineligibility reasons visible: policy disabled or unconfigured, active DVM authority missing, custody not `clinic_retained`, packaging not sealed, storage not controlled, an original pickup exists, current product/lot ineligible, or held amount unavailable. The exact contract controls the reason enumeration. Do not stop at the first reason or hide the action with no explanation. Unknown evidence fails the corresponding gate; it is not equivalent to an affirmative attestation. A later disputed-pickup amendment does not erase the existence of original pickup for this guard.

Eligible restock requires fresh policy version, role and current product/lot review, explicit quantity, frozen custody/condition evidence and final acknowledgment. Its linked stock movement must be atomic with the immutable disposition receipt, bounded by held quantity. Never call general `adjust_inventory` as a substitute. The guard applies to native return restocking; standalone stock adjustment remains a distinct audited workflow, not proof that all practice inventory changes use this eligibility policy. No reuse or production clinical approval is implied merely because a button becomes available.

## Review and recoverable operations

1. Opening a target reads exact immutable dispense and allocations plus authoritative cumulative returned/held/disposed amounts, latest return/disposition heads, relevant pickup/correction context and current staff eligibility. Do not derive remaining amounts from a paginated history page.
2. Staff enters quantities and custody facts. Opening an editor must disable competing correction/fulfillment editors or preserve explicit drafts without unmounting them. Add return dirtiness to the existing combined patient guard and before-unload protection; do not add a competing router blocker.
3. Review refreshes current context while retaining entered quantities/notes. If another staff member records a return or disposition, show the changed remaining amount and require corrected inputs plus a new review. Do not cap/truncate quantities automatically or silently change lots.
4. Freeze one canonical UUID and exact closed request after validated preview. The review shows actual quantities, destination state, custody/disposition assertions and non-effects together. Explicit attestation covers those facts and any client-shareable text the contract permits in clinical releases.
5. A strict adapter checks receipt operation/actor/target, exact frozen request, original hashes, prior and resulting heads, allocation identity, exact conservation and chronology at supported timestamp precision. Canonical UUID casing and text/codepoint limits should follow the established native contract. No success toast from an unmatched/malformed receipt.
6. Reuse recover-first uncertainty: no alternate UUID, target changes or discard while outcome is uncertain. Recovery-absent does not prove failure; later rejection must not destroy the original identity. Late actor/patient responses remain ignored.
7. After confirmed/recovered save, clear only that editor, refresh clean sibling evidence and authoritative balances, invalidate relevant release caches, clear obsolete print HTML and preserve dirty/uncertain sibling requests. If refresh fails after commit, say the record is saved and evidence needs reload.

## History, current prints and releases

Show immutable return intake and disposition histories separately from original dispensing and clinical annotation, linked by stable IDs and familiar lot/quantity/time labels. Provide bounded pagination and explicit errors. Changing heads between context and history pages requires refresh rather than merging a misleading partial view. Do not imply a loaded page is the full balance ledger.

Current print/release content needs a parent-approved versioned projection: original dispense stays original; return quantities and completed disposal are subsequent events. Authorization-only selection may disclose an aggregate return summary without silently selecting all dispensing history. Selected dispense disclosure must preserve the exact bounded relevant chain or fail explicitly at its package limit. Do not expose internal financial/custody commentary inadvertently; decide shared text scope in the contract and state it before save. Cache invalidation is not server-side release invalidation. The server must make affected older packages ineligible when their disclosure no longer represents current return evidence, while retaining historical artifacts and their original policy acceptance.

## Reachable practice policy configuration

`src/hub/pages/SettingsPage.tsx` is reachable at `/hub/settings`. Prefer a dedicated `NativeReturnPolicySettings.tsx` section there, linked from the return panel's policy-disabled explanation. Read-only current policy and review metadata should be visible to authorized staff; changing policy requires the exact active DVM+ADMIN gate defined by the server. A DVM without ADMIN and an ADMIN without DVM must receive separate clear explanations. Do not redirect every intake/disposal through configuration or make patient selection a requirement for practice policy.

Reuse the explicit commissioning pattern of `PrescriptionSettings.tsx`: inactive/disabled initial state, named review reference or evidence, no prefilled production approval, reviewed revision, explicit attestation, optimistic context and frozen UUID recovery. The existing hook currently requires `patientId`; do not invent a fake patient UUID for a global policy. Either a small actor-scoped policy operation wrapper reuses the generic state functions with an explicit practice-scope identity, or a clearly typed identity extension is agreed before implementation. Policy editing needs its own single settings-page dirty guard; no patient guard should be co-opted for the global route.

After confirmed policy change, invalidate clean return previews across the practice. Dirty/uncertain patient operations retain their UUID and display stale policy evidence until recovered or newly reviewed. The policy screen states that enabling this native software pathway is a recorded practice decision with restrictive evidence checks, not a claim that all returned medication is clinically approved for reuse.

## Decisions needed from the exact contract

- Roles for intake and disposal; whether DVM review is required for any condition or clinical assertion.
- Mandatory original pickup versus explicitly attested custody despite missing/disputed pickup; handling unknown lot identity.
- Intake-only-held versus explicit initial disposal; partial disposition targeting and any correction path for erroneous custody records.
- Exact amount precision/bounds; duplicate lot treatment; totals across multiple intakes and partial dispositions.
- Actual occurrence-time requirements, timezone display, clock bounds, canonical UUID requirements and text limits.
- Context dependencies, serializable head ownership, stable history cursors and immutable receipt materialization.
- Held location/condition fields and which narrative fields are shareable with clients.
- Versioned print/release summary and detailed disclosure; history/package bounds; explicit current form acceptance.

## Meaningful acceptance evidence

Test two-lot partial return; cumulative same-lot maximum; duplicate concurrent intake; partial disposal followed by complete disposal; over-disposal and wrong-intake rejection; missing/disputed pickup handling; unknown identity rejection without invented allocation; role revocation and archived-patient history; original artifacts unchanged; exact retry/recovery after lost success; changed balances preserve draft and require renewed review; route/actor/patient isolation; history head changes during pagination; current print/release disclosure and prior package invalidation. Actual database assertions must show no available-stock movement from intake/disposal, exactly one correctly linked stock increase from eligible restock, and no invoice item/credit/payment/refund, prescription allowance restoration, refill reopening or automatic client message. Add disabled-default policy, DVM+ADMIN configuration, every simultaneous restock denial reason, original pickup disputed but still ineligible, and policy/role/expiry changes during reviewed restock contention.
