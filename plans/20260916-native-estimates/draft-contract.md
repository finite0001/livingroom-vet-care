# Estimate draft foundation contract (version 1)

Implementation increment of the full estimates plan. Publication, client approval, accepted-line execution and delivery remain required subsequent increments; saving a draft performs none of them.

All objects are closed. UUIDs are lowercase canonical UUIDs. Money is canonical nonnegative integer decimal strings ≤9223372036854775807. Quantity is a canonical positive decimal string, at most 11 integer digits and 3 fractional digits, no leading/trailing zeroes except the integer zero before a fraction. No binary floating point arithmetic. Strings are trimmed, disallow controls other than newline/tab, and use Unicode code-point lengths.

`Fields = {title:string(1..200),notes:string(0..4000),terms:string(1..8000),accept_by:string(YYYY-MM-DD),lines:Line[1..100]}`. The date limits future acceptance (through the end of that date in America/Denver), not the validity of performed or already accepted work. Drafts may contain a past date; publication must require a future/current valid deadline. ISO calendar validity is checked.

`Line = {id:uuid,product_id:uuid,product_version:positiveInt,description:string(1..300),kind:'service'|'medication'|'vaccine',unit:string(1..50),quantity:string,pricing:Pricing,pricing_reason:string(1..2000)|null}`. Line IDs are unique within a draft; the same product may appear on separately described/priced lines. Separate partial executions use the same accepted line later. A line preserves a chosen description but kind/unit/version must match the locked current active catalog row on save. Product names do not overwrite description. A catalog version change rejects stale save (40001).

`Pricing = {kind:'unit',unit_price_cents:Money} | {kind:'allocated',amount_cents:Money}`. Allocated pricing always requires pricing_reason. Unit pricing different from the selected catalog unit price requires pricing_reason. Zero amounts are permitted with reason (including a zero catalog price), without inventing a cash payment. Unit amount is exact positive half-up round(quantity*unit_price_cents). Allocated amount is already the whole line amount. Line and summed totals must fit signed bigint. Preserve original pricing inputs and compute totals independently; do not fake clinical quantity to fit an allocated amount.

`Draft = {id:uuid,client_id:uuid,pet_id:uuid,version:positiveInt,fields:Fields,total_cents:Money,created_by:uuid,created_at:Instant,updated_by:uuid,updated_at:Instant}`. Household/patient cannot change after creation. Draft records are operational; each successful save appends an immutable complete revision. Historical validation checks shape/total/identity/hash against stored evidence, not today's catalog. No clinical, inventory, invoice or payment mutation occurs.

`Request = {estimate_id:uuid,client_id:uuid,pet_id:uuid,expected_version:positiveInt|null,fields:Fields}`. Null means create, otherwise exact optimistic version. Actor always comes from active staff session. Save/recover bind exact request and creator.

`Receipt = {version:1,id:uuid,actor_id:uuid,request:Request,request_hash:Hash,result:Draft,created_at:Instant}`. Request hash is native_fulfillment_hash({version:1,actor_id,operation:'save_estimate_draft',request}). Result.updated_by equals actor, result.updated_at equals receipt.created_at, result.version is expected_version+1 (or1), and fields/IDs exactly bind request.

RPCs:

- `save_native_estimate_draft(p_id,p_request) -> Receipt`.
- `recover_native_estimate_draft(p_id) -> Receipt|null` (creator only).
- `close_native_estimate_draft(p_id,p_request) -> {version:1,status:'recorded',receipt} | {version:1,status:'closed_unrecorded',closure}`. Closure = {version:1,id,actor_id,request,request_hash,closed_at,record_hash}; same request hash as save, record_hash over closure except record_hash. Same-ID operation locks serialize save/close; a closed UUID can never save later. Lost/null/error responses do not authorize browser discard.
- `read_native_estimate_draft(p_id,p_client_id) -> {version:1,actor_id,draft:Draft|null}`.
- `list_native_estimate_drafts(p_client_id,p_before_at:null|Instant,p_before_id:null|uuid,p_limit:1..100) -> {version:1,actor_id,client_id,drafts:Draft[],has_more:boolean,next_cursor:null|{before_at, before_id}}`, descending created_at/ID, limit+1 pagination. No silent truncation.
- `read_native_estimate_draft_history(p_id,p_client_id,p_before_version:null|positiveInt,p_limit:1..100) -> {version:1,actor_id,estimate_id,client_id,revisions:Draft[],has_more:boolean,next_before_version:null|positiveInt}`, descending draft version.

Save lock order: operation advisory ID → estimate root advisory ID → household/patient rows → sorted product rows. Recheck active staff and exact version after waits. Future publish/decision/execute paths must reuse the same root namespace. Mutations scoped through session actor, never user-supplied actor. RLS, raw table grants revoked for anon/authenticated/service_role, private verifiers revoked, immutable revisions/operations/closures audited. Stale context40001, malformed/changed identity23514, unauthorized42501.

UI: household workspace lists/opens draft versions and history; selects a household patient and active products; explicit editable terms and deadline; unit or allocated pricing with reason and computed total. Label as draft, not approved or billable. Persist exact submitted intent per actor/household before writing. On reload retain the original request and recover/resolve before another save. Fresh draft values survive definitive conflicts; require loading/comparing the current version rather than silently overwriting it. Navigation guards cover unsaved/uncertain drafts. No fake publication/approval buttons.
