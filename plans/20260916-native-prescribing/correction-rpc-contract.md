# Immutable native dispense annotations and pickup amendments

Status: exact design contract, parent confirmed role-only clinical annotation and versioned print disclosure; no SQL implemented. This is the first usable correction increment from `corrections-integration-map.md`. Physical returns, quarantine/restock, accounting credit attribution and cash-refund association remain explicit subsequent work. No operation below changes stock, invoice items, payments, prescription allowance, refill intake or the original dispense/pickup.

## Authority and terminology

`clinical_annotation` requires current active staff plus DVM role. This documents an attributed clinical correction; it does not sign an order, grant a refill or prescribe, so prescriber commissioning is not required. `operational_annotation` and `pickup_amendment` require current active staff. ADMIN alone never satisfies the clinical DVM gate. Use server-derived actor and frozen name/authority; reject missing display name rather than manufacture one. All actors are rechecked after waits and immediately before insertion/return. Exact historical recovery requires current active staff and the original actor; a historical clinical receipt remains recoverable after DVM role removal, but no new clinical append is permitted.

Annotations explain corrections without declaring the original transaction nonexistent. Pickup amendments require an existing original pickup and distinguish `recorded_in_error` (the recorded handoff is disputed; no replacement handoff asserted) from `corrected_handoff` (explicit revised handoff facts). Neither enables a second original pickup or reopens a closed refill.

All text follows native_rx_text semantics: Unicode-codepoint limits, trimmed nonblank, tab/newline permitted, CR/DEL/control characters rejected. CorrectionRequest JSON UUID identities/references require canonical lowercase strings (reject before append; do not silently normalize retained request strings). Typed UUID RPC arguments retain PostgreSQL UUID semantics. UUIDs, finite timestamps with at most6 fractional digits and lowercase64-hex hashes use existing native bounds. Timestamps compare at microsecond precision, including timezone offsets. Limits: reason2000, note4000, recipient name/relationship200, actor name200.

## Closed JSON interfaces

The following are structural interfaces; `UUID`, `Hash`, `Instant` mean the validated scalar strings above. Every listed nullable key is present. Unknown keys are rejected. Typed request strings remain exact in operation recovery; server normalization may affect only derived projections explicitly described below.

```typescript
interface CorrectionHead { event_id: UUID|null; version: number; record_hash: Hash|null }
interface CorrectionTarget { authorization_id: UUID; pet_id: UUID; dispense_id: UUID }
interface CorrectionActor { id: UUID; name: string; authority: 'active_staff'|'active_dvm' }
interface OriginalPickupRef {
  id: UUID; document_hash: Hash; picked_up_at: Instant;
  recipient_name: string; recipient_relationship: string; actor_id: UUID;
}
interface HandoffAssertion {
  picked_up_at: Instant; recipient_name: string; recipient_relationship: string;
}
interface PickupAmendment {
  original_pickup_id: UUID;
  disposition: 'recorded_in_error'|'corrected_handoff';
  handoff: HandoffAssertion|null;
}
interface CorrectionContext {
  version: 1;
  target: CorrectionTarget;
  authorization_hash: Hash;
  dispense_document_hash: Hash;
  dispense_artifact_hash: Hash;
  dispensed_at: Instant;
  original_pickup: OriginalPickupRef|null;
  head: CorrectionHead;
  latest_pickup_amendment: {event_id:UUID,version:number,value:PickupAmendment}|null;
}
interface CorrectionPreview {
  version: 1; actor_id: UUID; context: CorrectionContext;
  context_hash: Hash; observed_at: Instant;
}
interface CorrectionRequest extends CorrectionTarget {
  kind: 'clinical_annotation'|'operational_annotation'|'pickup_amendment';
  expected_context_hash: Hash;
  expected_head: CorrectionHead;
  reason: string;
  note: string;
  amends_event_id: UUID|null;
  pickup_amendment: PickupAmendment|null;
  attest_review: true;
}
interface CorrectionEvent {
  version: 1; id: UUID; target: CorrectionTarget;
  authorization_hash: Hash; dispense_document_hash: Hash;
  sequence: number; prior_event_id: UUID|null; prior_record_hash: Hash|null;
  actor: CorrectionActor;
  kind: CorrectionRequest['kind'];
  reason: string; note: string; amends_event_id: UUID|null;
  pickup_amendment: PickupAmendment|null;
  reviewed_context_hash: Hash;
  created_at: Instant; record_hash: Hash;
}
interface CorrectionReceipt {
  version: 1; id: UUID; actor_id: UUID;
  request: CorrectionRequest; request_hash: Hash;
  result: CorrectionEvent; created_at: Instant;
}
interface CorrectionRead {
  version: 1; context: CorrectionContext; context_hash: Hash;
}
interface CorrectionPage {
  version: 1; target: CorrectionTarget; head: CorrectionHead;
  events: CorrectionEvent[];
  next_before_version: number|null;
}
```

For annotation kinds, `pickup_amendment` is null. For pickup kind it is required, original pickup ID must exactly match, and `amends_event_id` must equal latest pickup-amendment event ID, or null for its first amendment. `recorded_in_error` requires null handoff. `corrected_handoff` requires all three handoff fields; claimed time cannot precede dispense or exceed commit observation time. This is staff-attributed corrected evidence, not provider verification.

For annotations, `amends_event_id` may be null or an earlier event on this exact dispense of the same annotation kind. It expresses an explicit narrative follow-up; no prior row is hidden or mutated. Cross-patient, cross-dispense, future and cross-kind amendment references fail. A staff annotation cannot amend a clinical entry. All notes/reasons and superseded assertions remain available. `attest_review` also attests that note/reason and corrected handoff facts are suitable for inclusion in an explicitly selected client clinical-record release; the UI must state this before saving. Do not encourage internal financial/personnel commentary in these fields.

Sequence/head versions are integers0..2147483647 (event sequence1..2147483647); refuse append at maximum. Summary counts are nonnegative safe integers (at most9007199254740991). Sequence starts1, increases exactly1; root predecessor fields are null and subsequent predecessor ID/hash exact. Zero head has null ID/hash; positive head has both. Event ID equals operation ID. `CorrectionReceipt.created_at` equals event created_at; it is not a second clock reading.

## Exact RPCs and recovery

- `preview_native_dispense_correction(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) -> CorrectionPreview`. Active staff, verified exact immutable target, authorization gate, consistent latest chain/pickup view. Preview itself grants no DVM authority. It changes nothing.
- `append_native_dispense_correction(p_id uuid,p_request jsonb) -> CorrectionReceipt`. Closed request above; exact role and context check. Known stale context/head returns40001; invalid shape/reference/attestation returns23514; actor/role denial42501.
- `recover_native_dispense_correction(p_id uuid) -> CorrectionReceipt|null`. Active same actor only. Wrong actor never receives another actor's request/event; choose42501 if found for another actor, null only for absent ID.
- `read_native_dispense_corrections(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) -> CorrectionRead|null`. Active staff; returns null for absent/mismatched exact target. No advisory write gate: one stable SQL snapshot derives verified target, original pickup and exact head/latest amendment.
- `list_native_dispense_corrections(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid,p_before_version integer default null,p_limit integer default25) -> CorrectionPage|null`. Same target rule; p_limit1..100, cursor null or positive. Descending sequence, exclusive `< before`, limit+1 sentinel; next cursor equals last returned sequence only when another exists. Head describes current snapshot, even on older pages. Do not imply one page is complete history.

Append locks operation UUID, then the existing authorization advisory gate, then rechecks current actor/required DVM authority. Original target and pickup are immutable; no patient UPDATE, lot, invoice or refill lock is needed. Root races serialize at authorization gate. Current context includes original pickup presence/hash and chain head; pickup creation between preview/save therefore invalidates a previously pickup-free review. Current prescribing terminal status/usage are intentionally absent: a cancellation, unrelated fill, expiry or catalog edit cannot prevent annotating an immutable historical dispense. Archived/deceased patients and decommissioned prescribers remain annotatable by appropriately authorized current staff.

After operation UUID wait, existing receipt may return only for exact same actor/request, before checking mutable target/head; recheck active staff before return. Different content on used UUID23514. On a first append, recompute context and check expected_context_hash and expected_head exactly while holding authorization gate; then create event+receipt atomically. Final actor/role check must occur after all waits. Never invoke a public child RPC under a second independently recoverable UUID.

Hash definitions use PostgreSQL canonical jsonb text UTF8 SHA256, consistent with existing native ledgers:

- `dispense_document_hash = hash(full immutable native_dispenses.document)`; verify original document with native_fulfillment_verified_dispense first.
- original pickup document_hash = hash(full immutable native_pickups.document); expose only bounded clinical fields above.
- context_hash = hash(CorrectionContext), excluding preview actor/observed_at.
- request_hash = hash({version:1,actor_id,operation:'append_native_dispense_correction',request}).
- record_hash = hash(CorrectionEvent minus record_hash). Include frozen authority, predecessor and target hashes; never recompute historical actor name from profiles.

New event/operation tables: RLS enabled; deny direct writes/reads to anon/authenticated/service_role; private validators revoked; authenticated public RPC grants only. Immutable INSERT audit and UPDATE/DELETE/TRUNCATE guards; FK references cannot silently mutate history. Per-dispense unique sequence and predecessor plus ID uniqueness backstop RPC gates. Verify exact parent/head hashes in read/release adapters, not merely copied hash formatting.

## Trusted disclosure and schema compatibility

Add stable private projection of complete per-dispense correction history with bounded materialization. For selected print/release content, at most100 events per selected dispense; if more exist, fail explicitly and direct staff to full paginated history. Never silently drop clinical annotations or only show latest pickup amendment. Existing aggregate snapshot1MiB bound remains. This limit affects packaging only, not creation/history retention.

```typescript
interface AuthorizationCorrectionSummary {
  version: 1; event_count: number; affected_dispense_count: number;
  heads_hash: Hash; // hash of sorted [{dispense_id,head:CorrectionHead}]; hash([]) when empty
}
interface DispenseCorrectionDisclosure {
  version: 1; head: CorrectionHead; events: CorrectionEvent[];
  latest_pickup_amendment: {event_id:UUID,version:number,value:PickupAmendment}|null;
}
interface NativePrescriptionReleaseV11 extends NativePrescriptionRelease {
  corrections: AuthorizationCorrectionSummary;
}
interface NativePrescriptionPrintV2 {
  version: 2;
  prescription: NativePrescriptionArtifact;
  status: NativePrescriptionPrintStatus;
  dispense: NativeDispenseArtifact|null;
  correction_summary: AuthorizationCorrectionSummary;
  dispense_corrections: DispenseCorrectionDisclosure|null;
  original_pickup: OriginalPickupRef|null;
}
interface NativeDispenseReleaseV11 {
  id: UUID; artifact_hash: Hash; artifact: NativeReleaseDispenseArtifact;
  prescription: NativePrescriptionReleaseV11;
  pickup: NativeReleasePickup|null; // ORIGINAL stays unchanged and visibly labeled original
  corrections: DispenseCorrectionDisclosure;
}
```

Schema11 keeps explicit selection families `native_prescription_ids`/`native_dispense_ids` and all existing inherited sources. New native prescription rows/embedded contexts add summary; selected dispense rows add complete bounded correction disclosure. Authorization-only selection discloses “corrections exist on N dispensing records; details not selected” and exact aggregate fingerprint/count; it does not implicitly include fill history. Full event disclosure contains clinical/operational reason/note and actor attribution but never reviewed_context, invoice/payment/stock adjustment internals. Clearly label staff assertion versus clinical DVM annotation and disputed/revised pickup.

Append invalidates saved schema10 and11 releases selecting either the corrected dispense or its authorization (including the embedded parent dependency). Saved schema10 cannot truthfully disclose new corrections: `release_preview_v10_internal` must reject a selection whose relevant authorization has correction events, and saved10 current-read/delivery becomes ineligible. Schema10 originals remain frozen, recoverable and renderer-readable as historical artifacts; do not mutate them or silently pretend no correction exists. New native selections use11 and explicit policy11 acceptance. Unaffected10 and all1–9 retain their existing semantics. Original-byte verification and inherited provenance guards extend11 explicitly; no generic future-version acceptance.

Print: introduce `read_native_prescription_print_v2(p_authorization_id uuid,p_dispense_id uuid default null)` returning `{version:2,prescription,status,dispense,correction_summary,dispense_corrections}`. Existing prescription/status/dispense are unchanged print contracts; summary is AuthorizationCorrectionSummary, dispense_corrections is null for order-only or full disclosure for selected dispense. Original pickup must be supplied for amended pickup rendering: add `original_pickup: OriginalPickupRef|null` as a required top-level key. It is null in order-only mode. This endpoint derives all fields after sorted/exact authorization locking and reports current status time separately from frozen correction hashes. Existing old print endpoint rejects corrected authorizations (or routes caller to versioned endpoint), preventing unqualified newly generated old-format output; old saved print artifacts stay immutable.

New current read/history returns the exact chain independently of print or policy acceptance. UI may show an effective pickup interpretation, but always beside original pickup and full amendment chain; `recorded_in_error` does not assert “never handed over.” No change to original stock, invoice, used slots or allowance is allowed.

## Implementation and acceptance gates

Before SQL: freeze these interfaces with parent/UI. Parent confirmed DVM role-only annotation authority; label this “recorded by clinician,” never prescription signing. Additive migration and actual Auth/SQL/browser tests follow; current task is design only. Parent owns shared print/release adapters and provider-free runtime.

Required tests: both authority classes, ADMIN-without-DVM denial, decommissioned signer historical annotation, exact replay/changed request/wrong actor, profile/role revoked after observed waits, competing root and competing same predecessor, original pickup added during review, pickup amendment chain and corrected time bounds, amendment target mismatch, archived patient, pagination and100/101 package boundary, deterministic hashes, schema10 invalidation and11 explicit acceptance, worker email/link stale rechecks, legacy byte binding/recovery, and zero stock/allowance/invoice/refill/outbox delta for every append. Newly materialized release/print disclosure must reject substituted/omitted chain entries, mismatched actor/target/hash/head and misleading effective-pickup state. No external provider calls are required.

### Canonical request identifiers
Correction request JSON identity and reference UUID strings must use canonical lowercase spelling. Reject noncanonical strings before the first append; preserve the exact accepted request in receipts. Typed RPC operation UUID parameters continue to use PostgreSQL UUID parsing. This prevents request references from comparing differently across database, browser and release evidence.
