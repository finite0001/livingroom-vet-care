# Native refill operational intake RPC contract

Status: implementation target, not acceptance. This is staff operational tracking only; it creates no clinical approval, fill allowance, dispense, inventory, charge, treatment or outbound message. All objects closed, all keys required, explicit nulls; UUID/hash/text rules follow rpc-contract.md. Text limits are Unicode code points.

## Shared immutable projections

```ts
interface Refill {
 id: UUID; pet_id: UUID; client_id: UUID; version: number;
 state: "open" | "closed" | "denied";
 medication_requested: string; // 1..500, client/staff request, not an order
 requester_note: string | null; // 1..4000 when supplied
 channel: "phone" | "email" | "text" | "in_person" | "other";
 assigned_to: UUID | null;
 authorization_id: UUID | null;
 authorization_hash: Hash | null;
 created_by: UUID; created_at: Instant; updated_by: UUID; updated_at: Instant;
}
interface RefillEvent {
 version: 1; id: UUID; refill_id: UUID; revision: number;
 action: "create" | "assign" | "link" | "close" | "deny";
 actor_id: UUID; reason: string; // 1..2000; explicit attribution on every transition
 prior_event_id: UUID | null;
 before: Refill | null; after: Refill;
 link_context: LinkContext | null; // exact reviewed context only on link
 created_at: Instant;
}
interface RefillReceipt {
 version: 1; id: UUID; actor_id: UUID; request: CreateRequest | TransitionRequest;
 request_hash: Hash; result: RefillEvent; created_at: Instant;
}
interface RefillRead {
 version: 1; refill: Refill; head_id: UUID;
 current_household_id: UUID; household_matches: boolean;
 authorization_status: NativePrescriptionPrintStatus | null;
 // Current disclosure only. Never substitute replacement authorization automatically.
 authorization_usage: UsageContext | null;
 operational_only: true;
}
interface LinkContext {
 version: 1; refill_id: UUID; refill_version: number; pet_id: UUID; client_id: UUID;
 patient_version: number;
 authorization_id: UUID; authorization_hash: Hash;
 authorization_head_id: UUID | null; authorization_head_version: number;
 authorization_state: "active" | "expired" | "cancelled" | "replaced";
}
```

## Writes and exact recovery

```ts
interface CreateRequest {
 refill_id: UUID; pet_id: UUID; client_id: UUID;
 medication_requested: string; requester_note: string | null;
 channel: Refill["channel"]; reason: string;
}
interface TransitionRequest {
 refill_id: UUID; pet_id: UUID; expected_version: number;
 action: "assign" | "link" | "close" | "deny"; reason: string;
 assigned_to: UUID | null; // assign permits unassign; null on other actions
 authorization_id: UUID | null; // nonnull only on link
 expected_link_context_hash: Hash | null; // nonnull only on link
}
```

- `create_native_refill(p_id uuid,p_request jsonb) -> RefillReceipt`
- `transition_native_refill(p_id uuid,p_request jsonb) -> RefillReceipt`
- `recover_native_refill_operation(p_id uuid) -> RefillReceipt | null` (only original active actor).
- `preview_native_refill_link(p_refill_id uuid,p_pet_id uuid,p_authorization_id uuid) -> {version:1,actor_id:UUID,context:LinkContext,context_hash:Hash,observed_at:Instant}`.

Create starts open, unassigned and unlinked; validates current patient household and active patient. Transitions require exact current version and open state. Assign/link require current matching household and active patient; close/deny may stop historical/archived/deceased/moved-household requests. Assignee must be active staff. Linking requires exact native authorization patient AND saved/current household, active authorization, and fresh context hash. Re-linking is allowed explicitly with a new reviewed context and immutable event; never follow a replacement automatically. An existing link can later become terminal; reads disclose current status and original exact identity. No APPROVED/READY/PICKED_UP states. Closed/denied terminal; no reopen in this slice. Operational denial is not a veterinarian's clinical refusal.

Strict UUID retries compare operation kind, actor and entire original JSON request; exact repeats return immutable receipt despite later transitions. Mismatch23514, stale revision/context40001, unauthorized42501. New writes recheck active actor after waits. No authenticated/service_role raw table writes.

## Bounded reads

- `read_native_refill(p_refill_id uuid,p_pet_id uuid) -> RefillRead | null` (wrong patient/absent null).
- `list_native_refills(p_pet_id uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default20) -> {version:1,refills:RefillRead[],has_more:boolean,next_cursor:{before_at:Instant,before_id:UUID}|null}`. Staff queue or exact patient, descending immutable(created_at,id), max100; paired finite cursor.
- `list_native_refill_events(p_refill_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default20) -> {version:1,refill_id:UUID,pet_id:UUID,events:RefillEvent[],has_more:boolean,next_cursor:{before_at:Instant,before_id:UUID}|null}`. Exact patient required, descending(created_at,id), max100.

Legacy `refill_requests` retained byte-for-byte, explicitly unverified/read-only in UI. Revoke INSERT/UPDATE/DELETE/TRUNCATE from authenticated AND service_role and remove permissive write policies; add a mutation guard against existing definer writers. Existing staff SELECT retained. No native conversion or inferred authorization.

## Locking and tests

New write: operation UUID gate → refill UUID gate → selected authorization gate (link only) → patient SHARE. Assignee/profile active checks repeated after waits. This does not acquire prescriber/draft gates and cannot invert prescription cancellation/replacement lock order. Link context checked under authorization serialization; later terminal changes are valid and immediately visible in reads. Each linked status disclosure uses a private stable snapshot of the verified authorization, latest terminal event and usage, with its own observation timestamp and no write-side advisory gate. Queue reads must not accumulate authorization locks in request order. The refill head is the immutable event at the returned exact refill revision. Household identity and status remain read observations, never fulfillment authority; link previews and mutations still serialize on the authorization gate.

Required local gates: exact retries/recovery/actor substitution; stale versions and changed household; assignment eligibility; explicit link patient/household/terminal checks; authorization terminal after link without following replacement; historical close/deny; legacy staff+service_role write denial; immutable event history and pagination; zero stock/charge/treatment/message side effects. Observed contention should prove competing transitions and link versus terminal authorization change using actual lock observation. No hosted mutation.

## Legacy bounded read

`list_legacy_refills(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default20) -> {version:1,records:LegacyRefillRead[],has_more:boolean,next_cursor:{before_at:Instant,before_id:UUID}|null}`. Active staff only; descending original immutable(created_at,id), paired finite cursor, max100 and sentinel. No normalization or conversion of original statuses.

```ts
interface LegacyRefillRead {
 record: {
  id: UUID; client_id: UUID; pet_id: UUID|null; conversation_id: UUID|null;
  medication_name: string|null; original_message: string|null;
  status: "REQUESTED"|"APPROVED"|"DENIED"|"READY"|"PICKED_UP";
  assigned_to_id: UUID|null; notes: string|null;
  requested_at: Instant; approved_at: Instant|null; ready_at: Instant|null;
  picked_up_at: Instant|null; created_at: Instant; updated_at: Instant;
 };
 client_name: string; pet_name: string|null; assigned_to_name: string|null;
 read_only: true; clinical_authority: "unverified";
}
```
