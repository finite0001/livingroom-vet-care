# Native selected record releases — database contract

Status: implemented in migration120 with local SQL, Auth/API, browser, contention and restore verification. Hosted, provider and clinical acceptance remain pending. Builds on `release-integration-map.md`; preserves frozen schemas1–9. No provider commissioning, dispensing mutation, or policy acceptance is authorized by this document.

## Selection and public RPCs

Add `native_prescription_ids` and `native_dispense_ids` to the existing closed selection object. Both are arrays of distinct UUID strings, at most20 each; omitted means `[]`. They select immutable authorization IDs and immutable actual dispense IDs respectively. Retain every inherited family bound, original-file limit24 and final snapshot limit1MiB. Reject unknown keys, malformed IDs, duplicates, wrong patient/household, unavailable or unverifiable records with23514/42501 consistently with inherited preview.

- `preview_record_release_v10(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) -> {snapshot,source_hash}`.
- Private `release_preview_v10_internal` has identical arguments/envelope; revoked from PUBLIC, anon, authenticated and service_role. Worker invocation occurs only through existing authorized service entry points. Match the inherited conditional staff pattern: private composers skip auth.uid-based staff checks only for service_role; email/link entry points recheck their stored actor after waits. Public wrappers always require active staff before and after composition.
- Existing `confirm_record_release` signature and exact actor/UUID request recovery stay unchanged; dispatch reviewed schema10 to the new composer.
- `list_record_release_sources_v10(p_pet_id uuid,p_offset integer default0)` extends v9 with two candidate arrays, corresponding `has_more` booleans and `policy_v10_accepted`.
- `select_all_record_release_sources_v10(p_pet_id uuid)` extends inherited result/selection. Probe21 native rows per family and reject overflow rather than silently truncate.

Native-only selections are valid. Do not invoke v9's inherited nonempty path when all old arrays are empty: compose the existing patient/recipient/base snapshot using its established empty-base helper, initialize all inherited arrays including `api_attachments`, and then add native content. An entirely empty selection remains invalid. Dispense-only selection embeds necessary signed authorization context without silently adding that authorization ID to explicit selection. Selecting an authorization does **not** include all its dispenses; aggregate usage discloses that selected evidence may be incomplete.

Discovery uses immutable `(signed_at,id)` / `(dispensed_at,id)` descending ordering, offset100+sentinel101, matching current family UI convention. Candidate exact common fields: `{id,version:1,recorded_at,label,source_label}`; no new free-form internal context. `label` is signed medication name with identifying date; `source_label` is `Living Room Vet · Signed prescription` or `Living Room Vet · Recorded dispense`. Signed canceled/replaced/expired records remain discoverable as historical evidence. Drafts never appear. Discovery takes no authorization advisory locks; preview is authoritative.

## Exact added snapshot JSON

Schema10 retains every schema9 field and adds `native_prescriptions: NativePrescriptionRelease[]` and `native_dispenses: NativeDispenseRelease[]`, sorted by UUID. `selection` contains both explicit native arrays. All following objects are closed; keys including nullable values are present. Numeric quantities remain canonical fixed-three strings. UUID/hash/date bounds follow existing verified native artifacts.

```typescript
interface NativeReleaseStatus {
  state: 'active' | 'expired' | 'cancelled' | 'replaced';
  head_id: string | null;
  head_version: number; // 0 with null head, otherwise positive terminal event version
  event_at: string | null;
  reason: string | null;
  replacement_id: string | null;
}
interface NativeReleaseUsage {
  version: 2;
  native_fill_accounting: 'implemented';
  dispensed_quantity: string;
  used_fill_slots: number;
  remaining_quantity: string | null;
  forfeited_quantity: string;
  unopened_fill_slots: number | null;
  allowance_basis: 'native_practice_stock' | 'external_unknown';
  open_slot: {id:string,index:number,version:number,remaining_quantity:string} | null;
  fulfillment_head: {event_id:string|null,version:number};
  external_fulfillment: 'unknown';
}
interface NativePrescriptionRelease {
  id: string;
  authorization_hash: string;
  artifact: NativePrescriptionArtifact; // exact immutable signed artifact from native renderer contract
  status: NativeReleaseStatus;
  usage: NativeReleaseUsage;
}
interface NativeReleasePickup {
  id: string;
  picked_up_at: string;
  recipient_name: string;
  actor_id: string;
}
interface NativeReleaseDispenseArtifact {
  id: string; authorization_id: string; authorization_hash: string;
  fill_index: number; quantity: string; unit: string; dispensed_at: string;
  recorded_by: {user_id:string,name:string};
  lots: Array<{id:string,number:string,expires_on:string,quantity:string}>;
}
interface NativeDispenseRelease {
  id: string;
  artifact_hash: string;
  artifact: NativeReleaseDispenseArtifact; // public projection of verified saved artifact
  prescription: NativePrescriptionRelease;
  pickup: NativeReleasePickup | null;
}
```

Required public dispense artifact projection: use existing immutable `NativeDispenseArtifact` fields **except `invoice_id`**; name this `NativeReleaseDispenseArtifact` in shared code rather than falsely passing it to the print-artifact validator. Its exact other keys are inherited unchanged from the frozen renderer interface. `artifact_hash` remains the original full saved artifact hash (verified server-side); it must not be represented as the hash of this redacted projection. Snapshot/source_hash binds the projection. No raw dispense.document, reviewed_context, refill request, allocation movement ID, charge amount or operation receipt is released. Parent renderer owner must align this exact projection before SQL work.

`status` is derived from latest terminal authorization event plus signed expiry using America/Denver current date. Null event fields accompany no event; replaced includes exact successor ID but never automatically includes successor artifact. Usage is exact verified current native V2 aggregate, not a claim that outside fulfillment is known. Both active and terminal orders preserve actual recorded dispense evidence. No `checked_at`, render time or current date literal enters the snapshot: unchanged sources regenerate identical hashes; an expiry state transition still makes current comparison differ.

Pickup is a separate recorded handoff, not dispensing or approval. Release only immutable recipient identity/time/actor; omit internal notes, linked refill context and financial references. Map these four fields directly from verified saved pickup.document; all four exist in the119 pickup writer. Recipient relationship and internal reason are intentionally excluded.

## Locking, source comparison and invalidation

Before calling any inherited preview which locks patient/source rows, resolve the union of selected authorization IDs and parents of selected dispenses using immutable relationships. Acquire `native-prescription-authorization:<uuid>` advisory gates in UUID order, then inherited patient advisory4700 and patient/client/source locks. Recheck selected IDs and same patient/household after waits. Do not use public print/status helpers: they add volatile observation timestamps and can acquire locks in caller-specific order. Materialize verified artifact, latest event, usage and selected pickup consistently after gates.

Native writers already serialize cancel/replace, dispense/forfeit and pickup under the same authorization gate. Release composition does not take refill, invoice, product or lot write locks. Verification helpers read immutable dispense/allocation/movement/item links. Existing release read holds release SHARE; invalidation inserts reference it with compatible FK KEY SHARE. Preserve that compatibility: no added release UPDATE lock in native invalidation. Document-link source currently takes client SHARE before release composition; native writer client SHARE is compatible. Test actual composed protocols, rather than claiming arbitrary multi-RPC transactions are deadlock-free.

Register explicit selections as source_kind `native_prescription` or `native_dispense`. A selected dispense also depends on its exact parent authorization; trigger lookup joins native_dispenses for this dependency without fabricating a selection row. Add append-only source_changed events for:

- terminal authorization event insert (cancel/replace), for direct or dispense-parent dependencies;
- fulfillment event insert (dispense/slot forfeiture), because frozen aggregate usage/head changed;
- pickup insert for that selected dispense (not unrelated dispenses).

Do not invalidate old schemas lacking native selections. Retain existing patient/client and inherited provenance invalidation. Expiry has no write trigger: exact current preview comparison catches date-bound state change at confirmation and delivery. Policy acceptance alone never makes stale releases eligible. Trigger invalidation complements current hash comparison, never replaces it.

A concurrent source change before confirmation must produce40001 and no release row. A change after confirmation commits invalidates later delivery while retaining the exact saved snapshot and recovery receipt. Preserve existing transport authorization linearization: a source change after a payload was authorized cannot recall bytes already delivered; do not claim atomicity across database and external provider.

## Compatibility and dispatch inventory

Extend policy accepted-schema constraint to10 and source-kind constraint with the two names. Do not enable policy or convert acceptance9 to10. Explicit reviewed acceptance10 required for new10 delivery; saved1–9 retain dynamic acceptance checks against their own version.

Extend confirmation dispatch, release_read_internal, source registration, inherited provenance/weight schema guards, `verify_release_source_original_v5`'s actual latest schema9 branch, and all shared/browser guards enumerated in release-integration-map. Preserve originals' capture grants and SHA/byte binding for mixed10 packages. Existing email and document-link context must continue postwait active-actor checks and expiry checks. Do not grant private native validators to service_role directly merely because an authorized worker composer calls them.

Keep old preview/discovery RPCs and immutable saved snapshots working; never rewrite historical hashes or recovery request bodies. Native policy/version migration must fail loudly if expected effective dispatch definitions drift.

## Required verification before completion

SQL + real Auth: native-only authorization, native-only dispense, mixed10 with inherited originals; exact frozen selection/count/order; terminal/expired and partial fill disclosure; separate pickup; wrong actor/patient/household; drafts denied;20/21 boundary;1MiB bound; exact UUID replay and changed request rejection. Preserve all old schemas and original-byte verification suites.

Observed waits: confirmation vs cancel, replace, dispense, forfeiture and pickup; staff revoked during wait; multi-authorization sorted acquisition; email/link authorization vs native change; no leaked stock/invoice/clinical mutations. Discovery must hold no multi-authorization write gates.

Delivery: policy9 rejects10; explicit10 permits eligible10; existing9 remains usable; changed native head/usage/pickup blocks new send; mixed attachment tampering fails in both email and SMS-link artifact paths. Frozen historical recovery remains byte-equivalent. Test expired-state changes without putting a volatile timestamp into the hash.

The public dispense projection is aligned across SQL, renderer and browser. See the native release evidence checkpoint for the exact verification scope; the requirements above must not be read as proof of hosted/provider/clinical acceptance.

Implementation checkpoint: migration `20260916080105_native_record_releases.sql` (canonical120) and `supabase/tests/native_record_releases.test.sql` are drafted. Public artifact projection confirmed. Static SQL parsing and independent source review passed; no runtime or hosted acceptance claimed at this checkpoint. Root owns actual database/worker/browser acceptance and inherited regression runs.
