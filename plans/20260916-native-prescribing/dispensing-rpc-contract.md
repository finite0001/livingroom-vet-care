# Native dispensing RPC contract

Status: **proposed design only**. No migration reserved and no dispensing implementation/clinical acceptance claimed. Implements the remaining fill-slot, partial dispensing, stock/billing and pickup portion of [implementation-contract.md](implementation-contract.md), using [dispensing-ledger-audit.md](dispensing-ledger-audit.md). Refill117 is packaged; the118 inventory prerequisite is locally verified. The119 dispensing backend remains unimplemented. The practice must review slot-remainder forfeiture and physical dispensing/pickup terminology before live commissioning.

## Authority, precision and bounds

Active staff may record fulfillment; this does not grant prescriber authority. New fulfillment requires a currently active exact native authorization, practice-stock mode, current active patient and unchanged signed household, exact linked active medication product and signed stock unit. A decommissioned original signer does not automatically erase an otherwise active signed order; current cancellation/status controls it. Staff cannot change signed medication/dose/SIG/refill allowance. Explicit alert review is required at each dispense. Cancellation/replacement remain commissioned DVM actions.

All JSON objects are closed, listed keys required, nulls explicit; UUID/hash/Unicode text rules follow rpc-contract.md. Requests preserve strings and allocation ordering exactly for retry identity. Quantities use positive decimal strings with at most11 integer and3 fractional digits, maximum99999999999.999; projections fixed3 decimals. Zero quantities allowed only in balance/remaining projections. No exponent, sign, leading zero variants, NaN, infinity or precision rounding. Unit price is integer-cent string0..100000000. Event amount is PostgreSQL numeric round(quantity×unit_price_cents), once per event, never per lot. Bound rounded event amount AND draft invoice projected sum to0..9223372036854775807 before bigint conversion. Money fields remain strings end to end. No implicit conversion/substitution, tax/discount/payment work in this slice.

Server timestamps and Denver calendar date are authoritative. No backdated dispense input. Signed starts_on≤Denver commit date≤expires_on and every lot expires_on≥Denver commit date (inclusive expiry-day rule, subject to Dr. Edler review). Preview captures Denver date; save recomputes after waits, including midnight crossings. Lot metadata is frozen in receipt. Positive allocations, unique lot UUIDs,1..100 allocations, exact sum equals event quantity. Input must be UUID-sorted ascending; reject unsorted/duplicate lists rather than silently rewrite request identity. Lock lots in this same order. Product ID/unit must match signed context exactly.

## Slots, events and operational request linkage

One authorization allows initial slot index0 plus indices1..refills_authorized. Slot opens only with its first successful positive dispense, in that same transaction. No standalone slot-opening mutation and no allowance consumed by preview. The next slot index is exactly previous index+1, only when previous slot is closed. Slot maximum is frozen signed quantity_per_fill. Partials append to one open slot. Reaching maximum automatically closes it with closure_kind `filled`; explicit close forfeits remaining quantity with reason and closure_kind `forfeited`. For a forfeited slot, remaining_quantity is zero usable quantity; the closure records maximum_quantity minus dispensed_quantity separately as forfeited_quantity. A new slot starts version1; each dispense or explicit closure increments the existing slot version by exactly1. No reopening/carrying remainder. Returns, credits, refunds, pickup and corrections never restore allowance. Cancellation/replacement block new dispensing but may leave a partial slot historically open; staff may explicitly forfeit-close it without granting more authority.

A dispense may optionally bind one currently open native refill with the exact same patient/household/authorization link and expected version. It atomically increments that refill version and appends immutable operational `dispense` event; state stays `open`. It does not infer physical handoff. A pickup acknowledgement references one actual dispense, records staff, recipient and server time, and never debits/bills again. At most one acknowledgement per dispense; duplicate different UUID fails, exact retry recovers. Pickup can optionally close its originally linked refill with exact current version and an explicit close reason; otherwise it leaves refill state/version unchanged. No linking a different refill during pickup. Before closing, recheck that the current refill still links exactly the original dispense authorization ID/hash and patient/household, in addition to expected version and open state. A relinked request cannot be closed by pickup of an earlier order, even when its latest revision is supplied. Pickup may follow cancellation/expiry because it records historical handoff; UI shows current warning and requires explicit review. It cannot amend or hide signed history.

The refill117 event action constraint/types need additive `dispense` and `pickup` values. Preserve original actions/states and old receipts exactly. `dispense` transition's before/after/version semantics remain unchanged, link_context stays null because it is not a relink; add a new nullable `fulfillment_reference` only through **version2 event projections**, with version1 support for historic receipts. Only dispense/pickup events use version2, with the original required event keys plus required non-null fulfillment_reference; all other new and historical operational events retain exact version1. Version2 reference `{kind:"dispense"|"pickup",id:UUID,dispense_id:UUID,authorization_id:UUID}`. The refill event itself may receive an independently generated UUID once inside the transaction; it must match the fulfillment result’s refill_event_id. fulfillment_reference.id matches the dispense/pickup ID (the outer operation UUID); fulfillment_reference.dispense_id always identifies the actual dispense. Do not require the separate refill event UUID to equal the fulfillment UUID. Do not rewrite historic JSON or widen the old exact version1 parser silently. Refill closure via pickup emits action pickup with state closed; close reason is explicit in event. An already closed/denied refill cannot be auto-reopened or receive a dispense transition.

## Exact request schemas

```ts
interface AllocationRequest { lot_id: UUID; quantity: string; }
interface RefillTarget { id: UUID; expected_version: number; }
interface DispenseTarget {
 authorization_id: UUID; pet_id: UUID;
 slot_index: number; // integer0..1000, exact next/open index
 expected_slot_version: number|null; // null only for unopened exact next slot
 invoice_id: UUID;
 quantity: string;
 allocations: AllocationRequest[]; // ascending UUID,1..100
 refill: RefillTarget|null;
}
interface DispenseRequest extends DispenseTarget {
 expected_context_hash: Hash;
 reason: string; //1..2000, operational record reason
 attest_alert_review: true;
 attest_dispense_review: true;
}
interface CloseSlotRequest {
 authorization_id: UUID; pet_id: UUID; slot_index: number;
 expected_slot_version: number; expected_context_hash: Hash;
 reason: string; //1..2000, explicitly forfeits remainder
 attest_forfeit: true;
}
interface PickupRequest {
 authorization_id: UUID; pet_id: UUID; dispense_id: UUID;
 expected_context_hash: Hash;
 recipient_name: string; //1..200, manually recorded identity, not verified identity claim
 recipient_relationship: string; //1..200
 reason: string; //1..2000, actual handoff acknowledgement
 attest_handoff: true;
 refill_close: {id:UUID;expected_version:number;reason:string}|null;
}
```

RPCs:

- `preview_native_dispense(p_target jsonb) -> {version:1,actor_id:UUID,context:DispenseContext,context_hash:Hash,observed_at:Instant}`.
- `record_native_dispense(p_id uuid,p_request jsonb) -> FulfillmentReceipt`.
- `preview_native_slot_close(p_authorization_id uuid,p_pet_id uuid,p_slot_index integer) -> {version:1,actor_id:UUID,context:CloseSlotContext,context_hash:Hash,observed_at:Instant}`.
- `close_native_fill_slot(p_id uuid,p_request jsonb) -> FulfillmentReceipt`.
- `preview_native_pickup(p_dispense_id uuid,p_pet_id uuid,p_refill_close jsonb default null) -> {version:1,actor_id:UUID,context:PickupContext,context_hash:Hash,observed_at:Instant}`. p_refill_close is exact `{id,expected_version,reason}` ornull, preview validates bound original refill.
- `record_native_pickup(p_id uuid,p_request jsonb) -> FulfillmentReceipt`.
- `recover_native_fulfillment_operation(p_id uuid) -> FulfillmentReceipt|null`, only original currently active actor.

Every mutation uses a single outer operation UUID, separate ledger kind `dispense|close_slot|pickup`, and exact actor+full request matching. Same UUID with another kind/actor/request23514; stale evidence/version40001; invalid domain23514; unauthorized42501. Recovery reads are immutable despite later cancellation, pickup or price changes. Absence is not proof a concurrent call cannot commit. IDs of dispense/closure/pickup equal outer UUID; actual movement IDs and the single invoice item ID are generated once inside the atomic transaction and frozen in its receipt. No child public mutation RPC calls with independently recoverable UUIDs.

## Complete context and result shapes

```ts
interface Slot {
 id: UUID; authorization_id: UUID; index: number; version: number;
 maximum_quantity: string; dispensed_quantity: string; remaining_quantity: string;
 state: "open"|"closed"; closure_kind: "filled"|"forfeited"|null;
 opened_by: UUID; opened_at: Instant;
 closed_by: UUID|null; closed_at: Instant|null; close_reason: string|null;
}
interface AuthorizationHead {
 id: UUID; hash: Hash; head_id: UUID|null; head_version: number;
 state: "active"|"expired"|"cancelled"|"replaced";
}
interface DispenseContext {
 version: 1; target: DispenseTarget; denver_date: Day;
 authorization: AuthorizationHead;
 signed_artifact: NativePrescriptionArtifact;
 patient: {id:UUID;version:number;client_id:UUID;archived_at:Instant|null;deceased_at:Day|null};
 household: {id:UUID;version:number};
 alerts: SignContext["alerts"];
 slot: Slot|null;
 previous_slot: Slot|null; // exact predecessor for unopened next slot
 usage: UsageContextV2;
 invoice: {id:UUID;client_id:UUID;version:number;status:"draft";currency:"usd";existing_items_hash:Hash;existing_items_total_cents:string};
 product: {id:UUID;version:number;active:true;kind:"medication";name:string;unit:string;unit_price_cents:string};
 lots: {id:UUID;product_id:UUID;lot_number:string;expires_on:Day;location:string;balance:string;quantity:string}[];
 refill: {refill:Refill;head_id:UUID}|null;
 charge: {quantity:string;unit_price_cents:string;amount_cents:string;projected_invoice_total_cents:string};
}
interface Dispense {
 version:1;id:UUID;authorization_id:UUID;authorization_hash:Hash;pet_id:UUID;client_id:UUID;
 slot_id:UUID;slot_index:number;slot_version_before:number|null;slot_version_after:number;
 actor_id:UUID;quantity:string;unit:string;reason:string;dispensed_at:Instant;
 reviewed_context:DispenseContext;reviewed_context_hash:Hash;
 allocations:{lot_id:UUID;quantity:string;movement_id:UUID}[];
 invoice_id:UUID;invoice_item_id:UUID;invoice_version_before:number;invoice_version_after:number;
 amount_cents:string;refill_id:UUID|null;refill_event_id:UUID|null;
 artifact:NativeDispenseArtifact;artifact_hash:Hash;
}
interface CloseSlotContext {
 version:1;authorization:AuthorizationHead;slot:Slot;usage:UsageContextV2;
}
interface SlotClosure {
 version:1;id:UUID;authorization_id:UUID;pet_id:UUID;slot_id:UUID;
 actor_id:UUID;reason:string;forfeited_quantity:string;
 before:Slot;after:Slot;reviewed_context:CloseSlotContext;reviewed_context_hash:Hash;created_at:Instant;
}
interface PickupContext {
 version:1;authorization:AuthorizationHead;dispense:Dispense;
 existing_pickup_id:UUID|null;refill:{refill:Refill;head_id:UUID}|null;
}
interface Pickup {
 version:1;id:UUID;authorization_id:UUID;pet_id:UUID;dispense_id:UUID;
 actor_id:UUID;recipient_name:string;recipient_relationship:string;reason:string;
 reviewed_context:PickupContext;reviewed_context_hash:Hash;
 refill_id:UUID|null;refill_event_id:UUID|null;picked_up_at:Instant;
}
interface FulfillmentReceipt {
 version:1;id:UUID;actor_id:UUID;operation:"dispense"|"close_slot"|"pickup";
 request:DispenseRequest|CloseSlotRequest|PickupRequest;request_hash:Hash;
 result:{dispense:Dispense;slot:Slot;refill_event:RefillEventV2|null}|SlotClosure|Pickup;
 created_at:Instant;
}
```

All quantities in contexts/receipts canonical fixed3 decimals, including allocation quantities; target/request retains original exact input strings and array order. Context hash covers every listed field (including target), not observed_at. No live lookup when rendering historic artifact. `NativeDispenseArtifact` is the existing renderer's exact shape: `{id,authorization_id,authorization_hash,fill_index,quantity,unit,dispensed_at,recorded_by:{user_id,name},invoice_id,lots:[{id,number,expires_on,quantity}]}`. Frozen staff name is server-derived. Product name, lot number and location have 1..200 Unicode-codepoint bounds matching their existing nonblank ledger fields. Pickup receipts return the immutable Pickup plus its refill_event_id when present; the full corresponding refill event is retrieved through bounded history, not silently appended to the result shape. Artifact hash is SHA256 canonical JSONB text; adapter verifies artifact matches immutable authorization/allocation/event links before printing. Existing schema1 signed artifact unchanged. Current status warnings remain outside historical label; pickup is a separate current/history annotation, not relabeled dispensing time.

## Usage adapter and cancellation/replacement compatibility

```ts
interface UsageContextV2 {
 version:2;native_fill_accounting:"implemented";
 dispensed_quantity:string;used_fill_slots:number;remaining_quantity:string|null;
 forfeited_quantity:string;unopened_fill_slots:number|null;
 allowance_basis:"native_practice_stock"|"external_unknown";
 open_slot:{id:UUID;index:number;version:number;remaining_quantity:string}|null;
 fulfillment_head:{event_id:UUID|null;version:number};
 external_fulfillment:"unknown";
}
```

For practice-stock only, allowance_basis is native_practice_stock and `remaining_quantity` = open-slot remaining plus maximum_quantity×unopened slots, irrespective of whether current cancellation/expiry prevents exercising that mathematical allowance; UI must show status separately. Aggregate quantities may exceed numeric(14,3) because up to1001 slots exist; projection uses unbounded PostgreSQL numeric sums with exact3-decimal strings (up to15 integer digits) and strict matching frontend bound. Per-event/slot limits remain numeric(14,3). For external-pharmacy mode, allowance_basis is external_unknown, remaining_quantity and unopened_fill_slots are null, and open_slot is null. Dispensed_quantity, used_fill_slots and forfeited_quantity describe only verified native-ledger activity (normally zero for external mode), never outside pharmacy usage or usable external allowance. External remaining allowance cannot be inferred from the signed maximum minus local records. `used_fill_slots` counts slots opened including forfeited/fully filled; zero before first dispense. `fulfillment_head` increments for each dispense or explicit slot closure, not pickup, and is serialized by authorization gate. This separate head avoids treating fulfillment as a terminal authorization event.

Additively replace `native_rx_usage_context` to return V2 on current status/change previews. Previously committed ChangeContext/ReplacementContext with V1 unknown accounting must remain readable, hash-verifiable and exactly recoverable; **never rewrite old receipts**. Update strict API parsers for live V2 plus frozen V1 history in the same release. A replacement/cancel reviewed before dispense or slot closure fails changed context hash even though authorization terminal head is unchanged. Replacement review shows actual used/forfeited/unopened quantities and retains explicit DVM manual reconciliation. New authorization has its own explicit signed allowance; no transferring old allowance. External fulfillment remains unknown despite native usage accounting; existing external→local reconciled attestation requirement preserved.

Current `native_prescription_authorization_events` remain terminal-only cancel/replace; do not overload with fill or pickup entries or break its unique root/terminal rules. Fulfillment gets separate append-only event/slot history. Annotations/correction/return/credit linkage remain required follow-up under full contract; this slice must not imply those implemented. No reopening history or deleting dispense to fix a mistake.

## Atomic locking and failure contract

Lock order for fulfillment mutations:

1. Native fulfillment operation UUID gate; exact committed receipt may return after active actor check without acquiring mutable context locks.
2. Optional linked native refill gate (before authorization, matching117 link protocol).
3. Exact native authorization advisory gate (same string as116 cancellation/replacement), then slot row/gate if it exists. No prescriber gate is acquired by fulfillment. Cancellation/replacement use prescriber→authorization and do not acquire refill gates.
4. Patient FOR SHARE via current alert review, then invoice FOR UPDATE. Acquire product FOR SHARE before selected lot rows FOR UPDATE in UUID order, matching the additive118 treatment amendment and existing receiving order. Household/version read must be consistent with patient's locked relationship; use compatible client SHARE lock before invoice only after auditing all household writers.
5. Recompute balances after lot locks, recheck exact invoice version/status and full existing item set/total, product/version/price, dates, patient/household, alert source hash, slot/authorization head, refill version/link/state, active actor. Compare complete fresh context hash. Repeat role check at write finish. A private advisory gate is not a substitute for patient alert-writer row protection.

All preview/save paths must preserve this reviewed order; preview creates no slot or financial effects. The118 observed-contention test runs real receiving, catalog update and treatment calls while a deliberate lot lock is held. PostgreSQL permits treatment to join the compatible product SHARE even while the catalog UPDATE waits. The test therefore observes exact product-row SHARE ownership with `pgrowlocks`, plus a waiting lot tuple lock; it does not assume a direct catalog→treatment blocking edge. Reconstructing the prior treatment order in an owned scratch database fails that ownership assertion, while118 passes both arrival orders, stock/price/alert checks and post-wait role revocation. This is evidence for the tested protocol, not a reproduced old deadlock or proof of every possible schedule. Future dispensing must repeat observed contention with its actual implementation, including sorted multiple lots and invoice/authorization/refill writers.

Invoice issue/correction writers take invoice UPDATE and do not wait for authorization/refill gates. Existing add_invoice_service already updates invoice version (inventory_billing.sql line181). Preserve the item-set hash/total as additional complete review evidence, not as a workaround for an asserted missing version bump. New dispense itself adds exactly one item and bumps invoice version exactly once via existing inventory_guard semantics.

Append dispense, allocations, movements, one invoice line, invoice revision, slot/version/fulfillment head, optional linked refill event and outer receipt in one transaction. Failure at any step rolls all back. Initial slot+first partial shares that transaction. No treatment, vaccination/lab due-plan, outbox, email, Stripe or provider side effect. After uncertain transport recover exact UUID; never allocate a fresh UUID to retry the same intended action.

## Bounded read/history/print surface

- `read_native_fulfillment(p_authorization_id uuid,p_pet_id uuid) -> {version:1,authorization:AuthorizationHead,usage:UsageContextV2,open_slot:Slot|null}` ornull absent/wrong patient.
- `list_native_fill_slots(p_authorization_id uuid,p_pet_id uuid,p_after_index integer default null,p_limit integer default20) -> {version:1,authorization_id:UUID,pet_id:UUID,slots:Slot[],has_more:boolean,next_index:number|null}` ascending immutable index, max100; no silent omission.
- `list_native_dispenses(p_authorization_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default20) -> {version:1,authorization_id:UUID,pet_id:UUID,dispenses:Dispense[],has_more:boolean,next_cursor:{before_at:Instant,before_id:UUID}|null}`.
- `list_native_slot_closures(...)` and `list_native_pickups(...)` use identical authorization/patient/timestamp cursor arguments and envelopes with `closures:SlotClosure[]` / `pickups:Pickup[]`. Finite paired cursor, descending(created_at,id), except pickup uses immutable picked_up_at and dispense uses dispensed_at in cursor before_at. Read requires active staff, never raw service-role ledger access.
- Extend `read_native_prescription_print(p_authorization_id,p_dispense_id)` to permit exact matching saved dispense and return existing `{prescription,status,dispense}` renderer bundle; nonmatching authorization/hash/patient fails. Reprint records no fill/pickup/charge. Order-only print remains unchanged.

## Required gates before implementation acceptance

Contract/UI state tests preserve uncertain UUID, actor/patient isolation, exact full response shape and V1/V2 historical parsing. Real local SQL/Auth tests cover initial/last/over-limit slots, partial sum, explicit forfeiture, inclusive date boundaries, exact product/unit, sorted duplicate/excess lot allocations, stock shortage, price/invoice/itemset drift, decimal/bigint boundaries, row permissions, unchanged source artifacts, pickup once and no double charge, legacy/refill transitions, receipt recovery after terminal status.

Observed-lock races: sameUUID, differentUUID same slot, same lot across prescriptions, invoice issue vs dispense, cancel/replace vs dispense, slot-close vs partial, linked-refill transition vs dispense, role revocation and alert write during waits. Assert holder/waiter in pg_stat_activity/pg_locks, not sleep-only timing. Verify event/stock/charge/refill/slot all-or-nothing and exact counts. Test receives/service charges against the resolved order, including the observed three-way queued catalog UPDATE/receive/dispense and existing treatment variant; do not infer deadlock freedom from pairwise success. Populated restore must preserve all receipt/artifact hashes, FKs, lot movement and invoice references; record release integration remains a separate explicit phase. Dr. Edler acceptance remains outstanding regardless of automated passes.
