# Native prescribing RPC contract — lifecycle slice

Status: agreed implementation target for coordination, **not implemented or accepted**. This slice fixes authority configuration, draft/save/read/list, initial signing, and exact operation recovery. Cancellation, replacement, refill intake, fill slots, dispensing and print projections remain required later slices under [the full contract](implementation-contract.md); they are not represented as completed here. No hosted changes or provider calls.

All objects below are closed: every listed key is required, nullable values use explicit JSON `null`, unknown keys fail. UUIDs are UUID strings; Hash is lowercase SHA-256 hex64; Instant is finite ISO timestamp with timezone and at most six fractional digits; Day is a real `YYYY-MM-DD` date. Positive integer revisions are bounded PostgreSQL integers. Quantities are decimal **strings** with 1–11 integer digits, no leading zeros except `0`, and zero to three decimals; positive, maximum `99999999999.999`. Keep request strings exactly as submitted for retry identity; output numeric quantities use fixed three decimals. All written text must equal its trimmed value, contain no control characters other than tab/newline, and meet stated bounds.

## Shared objects

```ts
interface Medication {
  name: string; // 1..200
  strength: string; // 1..200; manually authored, no conversion
  form: string; // 1..100
  directions: string; // 1..4000
  route: string; // 1..100
}
interface DraftFields {
  encounter_id: UUID | null;
  medication: Medication;
  quantity_per_fill: string;
  unit: string; // 1..50
  refills_authorized: number; // integer 0..1000
  fulfillment_mode: "practice_stock" | "external_pharmacy";
  product_id: UUID | null; // required for practice_stock; null for external_pharmacy
  starts_on: Day;
  expires_on: Day; // >= starts_on
}
interface Draft {
  id: UUID;
  pet_id: UUID;
  client_id: UUID;
  version: number;
  fields: DraftFields;
  status: "draft" | "signed";
  authorization_id: UUID | null; // null iff draft
  created_by: UUID;
  updated_by: UUID;
  created_at: Instant;
  updated_at: Instant;
}
interface PrescriberFields {
  active: boolean;
  license_number: string; // 1..100
  license_state: string; // 1..100, explicit practice-reviewed value
  license_expires_on: Day;
  practice_name: string; // 1..200
  practice_address: string; // 1..1000
  practice_phone: string | null; // 1..100 if present
  clinical_review_note: string; // 1..2000; explicit commissioning evidence
}
interface PrescriberConfiguration {
  user_id: UUID;
  version: number;
  fields: PrescriberFields;
  configured_by: UUID;
  configured_at: Instant;
}
interface PrescriberEntry {
  user_id: UUID;
  name: string; // server profile display name, never request identity
  active_staff: boolean;
  has_dvm_role: boolean;
  configuration: PrescriberConfiguration | null;
  eligible: boolean; // all active/DVM/config/credential checks, current Denver date
}
interface Authorization {
  id: UUID; // initial sign operation UUID
  pet_id: UUID;
  client_id: UUID;
  draft_id: UUID;
  draft_version: number;
  signed_by: UUID;
  signed_at: Instant;
  context_hash: Hash;
  context: SignContext;
  authorization_hash: Hash;
  artifact: NativePrescriptionArtifact; // exact schema1 in native-prescription-renderer.ts
}
interface Cursor { before_at: Instant; before_id: UUID }
```

The signed artifact uses frozen patient, household and prescriber display/credential details from the reviewed context, fixed-three-decimal quantity, exact manually authored medication fields, and explicit fulfillment mode. `authorization_hash` is computed from an explicit version1 basis containing authorization ID, draft ID/version, actor, sign context hash, signature name and signed timestamp; it excludes itself and the artifact's redundant hash. No live catalog/name lookup may alter the stored artifact.

## Immutable mutation receipt

Every mutation below returns this envelope. Operation identity is independent of draft ID and caller-generated once before submission.

```ts
interface OperationReceipt {
  version: 1;
  id: UUID; // p_id
  actor_id: UUID; // auth.uid()
  operation: "configure_prescriber" | "save_draft" | "sign";
  pet_id: UUID | null; // null only for configure_prescriber
  request: ConfigureRequest | SaveDraftRequest | SignRequest;
  request_hash: Hash;
  result: PrescriberConfiguration | Draft | Authorization; // discriminated by operation
  created_at: Instant;
}
```

Request digest basis is exactly JSONB `{version:1,actor_id,operation,request}` with SHA-256 UTF8 canonical JSONB text. Request UUID advisory lock precedes lookup. Matching actor, operation and exact JSONB request returns the immutable original receipt before current draft/config/alert validation; changed UUID reuse fails `23514`. Current active read authority is still required. Sign retry does not repeat clinical effects or require its old preview to remain current. New signing requires current configured DVM authority, including after waits. Return snapshots must never be reconstructed from current mutable draft/config rows.

`recover_native_prescription_operation(p_id uuid) -> OperationReceipt | null`: active staff only, only original actor's receipt, other actor/unknown UUID returns null. It does not itself retry or establish that an in-flight request cannot commit later. Configuration receipts additionally require current ADMIN role. The client must compare UUID, actor, operation, complete request, patient and result identity against its frozen operation before trusting recovery.

## Prescriber configuration

`configure_native_prescriber(p_id uuid, p_request jsonb) -> OperationReceipt<configure_prescriber>`

```ts
interface ConfigureRequest {
  user_id: UUID;
  expected_version: number | null; // null only for first config
  fields: PrescriberFields;
  attest_review: true;
}
```

Active ADMIN required, checked again after serialization waits. Target must exist and have DVM role for activation. No automatic production commissioning. Every successful edit appends the full configuration revision and attributes reviewer/time. A disabled profile, lost DVM role, inactive config or expired credentials independently prevents new signing. A nonempty clinical note alone does not establish credentials without explicit ADMIN attestation.

`list_native_prescribers(p_after_id uuid default null, p_limit integer default 20)` returns `{version:1, entries:PrescriberEntry[], has_more:boolean, next_after_id:UUID|null}`. Active staff may list; UUID ascending keyset over DVM-role users or previously configured users (including inactive/revoked targets), default20/max100, sentinel. `next_after_id` is last returned user ID iff more. No user creation or role mutation occurs.

## Draft save and patient workspace reads

`save_native_prescription_draft(p_id uuid, p_request jsonb) -> OperationReceipt<save_draft>`

```ts
interface SaveDraftRequest {
  draft_id: UUID;
  pet_id: UUID;
  client_id: UUID;
  expected_version: number | null; // null creates version1
  fields: DraftFields;
}
```

Active staff can prepare/update an unsigned practice draft, with attributed revision history. Existing draft patient and household cannot change. Require patient belongs to given client and is active/not deceased, optional encounter belongs to same patient, and stocked catalog product is active medication with exact unit. Never infer a product by name. Signed drafts cannot be edited. Version mismatch is `40001`; separate concurrent create on an existing draft is conflict, not silent replay. Save has no clinical authority, stock, billing or delivery effects.

`read_native_prescription_draft(p_id uuid, p_pet_id uuid) -> Draft | null`: active staff; exact patient match, absent/mismatched returns null.

`list_native_prescription_drafts(p_pet_id uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 20)` returns `{version:1,pet_id:UUID,drafts:Draft[],has_more:boolean,next_cursor:Cursor|null}`. Includes signed draft projections, ordered immutable `(created_at,id)` descending (not update time). Exact paired cursor, default20/max100 and sentinel; require existing patient and active staff. Never silently truncate without `has_more`.

`read_native_prescription_authorization(p_id uuid,p_pet_id uuid) -> Authorization | null`: active staff, exact patient, immutable historical authorization; cancellation/expiry must not erase access. A later separate current-status endpoint will accompany lifecycle events; this immutable read alone never grants dispensing permission.

## Signing preview and commit

`preview_native_prescription_sign(p_draft_id uuid,p_expected_version integer)` returns `{version:1,actor_id:UUID,draft_id:UUID,pet_id:UUID,context:SignContext,context_hash:Hash,observed_at:Instant}`.

```ts
interface SignContext {
  version: 1;
  draft: Draft; // unsigned exact revision
  patient: { id:UUID; version:number; name:string; species:string };
  household: { id:UUID; version:number; name:string; address:string };
  prescriber: {
    user_id:UUID; name:string; configuration:PrescriberConfiguration;
  };
  product: { id:UUID; version:number; name:string; unit:string } | null;
  alerts: { snapshot:PatientTreatmentAlertSnapshot; source_hash:Hash };
}
interface SignRequest {
  draft_id: UUID;
  pet_id: UUID;
  expected_version: number;
  expected_context_hash: Hash;
  signature_name: string; // 1..200; must equal current reviewed prescriber name
  attest_review: true;
}
```

`PatientTreatmentAlertSnapshot` is the existing schema returned by `read_patient_treatment_alerts`: `{schema_version:1,pet_id,patient_version,important_problems:[{id,version,title,notes,status,importance,onset_date,updated_at}],legacy_allergies:{text,provenance}}`; preserve nullability from existing clinical records. `context_hash` hashes the explicit whole `SignContext`, excludes `observed_at`, and binds every reviewed identity/version/value. Preview requires configured current active DVM, nonblank prescriber name, unsigned exact draft, current patient/household/product, valid dates and credentials. Patient alert SHARE lock and relevant configuration/draft locks must be retained/rechecked in commit; do not claim preview locks survive the HTTP request.

`sign_native_prescription(p_id uuid,p_request jsonb) -> OperationReceipt<sign>`: serialize operation then draft, acquire compatible current evidence locks, recompute preview for server-derived actor, check exact context/version/attestation/name, append one immutable authorization and mark draft signed in the same transaction. Authorization ID is p_id. Require order not already expired in Denver; future start dates remain explicit. Recheck active staff/DVM/commissioning after waits and before return. New sign fails stale `40001`, invalid `23514`, authority `42501`. Stock, invoice, treatment, due-plan and outbox effects remain zero.

## Compatibility and remaining slices

All public functions revoke PUBLIC/anon/service_role execution and grant authenticated execution only with server-side authority checks. Private helpers and direct ledger mutations stay revoked; tables use RLS and append-only history guards. No hosted call is needed to build this contract. Before generating actual additive migrations, compare available canonical versions and coordinate the reservation; remote metadata unavailability does not block local design.

This file deliberately does not invent cancellation/replacement/fill RPC payloads before their shared allowance/locking contract is reviewed. Those phases remain required. The frontend may implement this exact lifecycle slice now and add later discriminated operations only by coordinated contract changes. Native print endpoint remains root's normalized artifact/status adapter contract, to be implemented once current lifecycle events exist.
