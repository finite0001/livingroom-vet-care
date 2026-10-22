# C2a — event coverage and independently versioned review policy

Status: independent review cleared the bounded design direction for a new Gate A
and detailed specification. This is not full protocol, source, descriptor or
runtime acceptance; those reviews and proofs remain required before release.
This document was prepared while the canonical-206 proof inputs were frozen;
only this plan was written.

## Scope and preserved contracts

This is the first bounded part of [phase 2](phase-02-operational-workflows.md),
not completion of C2 or permission to activate the register. Preserve the
[45-item matrix](../2026-10-08-vet-feedback/requirements.md), especially N19 and
H11, and the [controlled-register C2/C3 requirements](../2026-10-14-inventory-register/phase-03-controlled-register.md).
The approved [practice recommendations](../../docs/controlled-drug-rules-susan-review.md)
supply the ordinary administration/dispensing review deadline and independent
reviewer requirement. This plan introduces no new legal requirement. Actual site,
registrant, roster, operating dates, opening counts and SOP facts remain absent
during construction. Synthetic fixtures must be conspicuously synthetic and local.

Keep migrations 1–205, their released bodies and expectation pins unchanged.
Preserve the canonical-206 private release, its exact CLI statement array and full
205 ledger expectation unchanged once accepted. Preserve Gate A, foundation v1,
private v2 and synthetic-Auth v2 artifacts as distinct historical artifacts.
Never regenerate an old descriptor from a live catalog to admit new behavior.

The existing physical protocol remains exactly
`prepare_controlled_stock_action(actor, operation, writer, arguments, context)` →
`execute_controlled_stock_action(actor, operation)`, with its owned read/cancel
operations. It stores the original canonical arguments and controlled context,
calls one unchanged canonical writer, and commits its exact source/event/receipt
together. No new writer parameters, duplicate stock debit or replacement retry UUID.

## Source inventory and exact event kinds

Read the effective migration chain, not only the first definition of an RPC.
The full native/treatment definitions in
`20260928190000_no_retryable_sqlstate_for_permanent_conditions.sql` are later than
the original native migrations; the stock-boundary hooks and canonical-205 engine
then compose with them. The admitted writer manifests, `candidate/protocol.sql`
dispatcher and `candidate/review.sql` event-kind function are the final inventory.
`engine/source-reader.sql` and `source-effects.sql` are source oracles assembled
into the engine, not permission to create an event.

There are **10 writers and 22 exact event-kind strings**. Colon suffixes below are
literal suffixes, not arbitrary client-selected classifications. Return and
discrepancy suffixes come from `request.intent.action`; correction suffixes come
from `request.kind` and must pass the respective canonical validator.

| Writer | Exact event kinds | Original source and stock/custody meaning |
|---|---|---|
| `receive_inventory` | `receive_inventory` | `inventory_movements` root; positive available quantity, exact `stock_movement_sources` association and lot. Receiving creates identified stock containers. |
| `adjust_inventory` | `adjust_inventory` | `inventory_movements` root; signed available quantity. No structured count, waste, loss or correction-target subtype exists in this writer. Reason text and sign do not establish one. |
| `record_patient_treatment` | `record_patient_treatment` | Nonhistorical `patient_treatments`, exact movement/source, patient and invoice linkage. Treatment, movement and invoice item share the operation ID. Stock quantity is distinct from descriptive dose/route. |
| `record_anesthesia_drug_administration` | `record_anesthesia_drug_administration` | `anesthesia_drug_administrations` joins the same-ID treatment and actor; the outer receipt is the treatment row. Its nested treatment produces the sole stock debit and invoice item. Include the anesthesia record link. |
| `record_native_dispense` | `record_native_dispense` | `native_dispenses`, `native_fulfillment_operations`, `native_dispense_allocations`, each exact movement/source. Negative available and positive prepared custody; preparation is distinct from handoff. |
| `record_native_pickup` | `record_native_pickup` | `native_pickups`, `stock_pickup_sources`, fulfillment operation and original dispense allocations. No new available-stock debit; releases the complete prepared package. |
| `record_native_dispense_return` | `record_native_dispense_return:intake`, `record_native_dispense_return:dispose`, `record_native_dispense_return:restock` | `native_return_events` document v1, `native_return_operations`, `stock_custody_sources`, original intake/dispense/allocations. Intake moves prepared to held; disposal removes held; restock adds available and removes held. |
| `record_native_dispense_return_v2` | `record_native_dispense_return_v2:intake`, `record_native_dispense_return_v2:dispose`, `record_native_dispense_return_v2:restock`, `record_native_dispense_return_v2:retract_intake`, `record_native_dispense_return_v2:retract_disposal`, `record_native_dispense_return_v2:retract_restock` | Same return families with document v2. Retractions bind an exact original return ID/hash and original physical cells. Retract-intake restores prepared/removes held; retract-disposal restores held; retract-restock removes available/restores held, with exact compensation links. |
| `record_native_return_discrepancy` | `record_native_return_discrepancy:report`, `record_native_return_discrepancy:note`, `record_native_return_discrepancy:resolve_corrected`, `record_native_return_discrepancy:resolve_confirmed_original` | `native_return_discrepancy_events`, operations, `stock_discrepancy_sources`, exact source return ID/hash, case and correction links. Assertion/hold history; zero available and custody allocation effects. Resolution is not a quantity adjustment. |
| `append_native_dispense_correction` | `append_native_dispense_correction:clinical_annotation`, `append_native_dispense_correction:operational_annotation`, `append_native_dispense_correction:pickup_amendment` | `native_dispense_correction_events`, operations and `stock_correction_sources`; exact dispense/authorization/patient, prior amendment and original pickup where applicable. Zero stock/custody effect; a pickup amendment cannot prove physical return. |

The scalar and ordinary native events use `physical_record`; retractions use
`correction_assertion`; discrepancy events use `discrepancy_assertion`; the three
dispense corrections use `annotation`. Only physical records have `observed_at`.
Treatment/anesthesia observed time must equal original `request.administered_at`.
Keep actual time separate from server `recorded_at` and from native source times;
do not turn an assertion's creation time into a personal observation.

Coverage is not authorization. Frozen return guards still require clinic-retained
intake and reject any original pickup, unknown/client-returned custody and unlinked
pre-opening retractions. Pickup rejects prior return history and requires every
original prepared allocation. Native holds and controlled state restrictions
continue to apply. C2a must not widen any of those checks.

Not in this 22-kind inventory: external prescription signing, historical treatment
transcription, a generic treatment addendum, dedicated transfer/count/loss/waste
events, supplier/reverse-distributor handoff or actual witness attestations. No
adapter may silently map those into an existing kind to claim complete coverage.

## Immutable target and historical site derivation

Every adapter first validates the exact parent event with the unchanged
`controlled_stock_validate_event`. The base target remains the eight fields
`event_id`, `product_id`, `sequence`, `record_hash`, `original_actor_id`,
`policy_version_id`, `opening_id`, `engine_revision`. Add an independently versioned
adapter discriminator and explicit source references around that target; never
replace its hash with a caller hash or a current source-head hash.

The packet contains the full immutable event, original result and clinical
snapshot, exact controlled preparation arguments/context, source links, event
lines, referenced immutable cells, ordered transitions and identified containers.
Native adapters add exact original allocation and target/amendment/case documents.
Each referenced document is validated against the event's retained source bundle;
no latest-patient/owner/catalog value silently rewrites a signed packet. Current
display information, if later needed, must be separately labeled and excluded
from the historical signature meaning. Bound packet bytes, source count and join
depth; refuse oversize evidence rather than truncate it.

Use these finite site rules:

1. **Physical records and return retractions with effects:** select only this event's
   `controlled_stock_container_transitions` and their immutable
   `controlled_stock_containers.controlling_site_id`. Require nonempty exact
   membership, matching product, one distinct nonnull controlling site and matching
   event-line/cell/source provenance. This generalizes the separately proven v2
   rule to the additional physical and return-retraction kinds. Multiple sites
   are a visible unsupported scope, not the first UUID or current policy site.
2. **Zero-effect native dispense annotations:** always dispatch to this rule,
   even if the event contains empty-line transitions. Resolve
   `source_bundle.native.dispense_id` to that exact controlled dispense event,
   matching writer/product, source root, original allocation IDs and document
   hashes. Derive the site from its immutable transitions; retain the predecessor
   target/hash as site evidence. For pickup amendments also verify the exact
   original pickup and amendment chain, and require any available controlled
   pickup-site evidence to agree. For a pickup amendment whose original dispense
   predates opening, an exact managed original pickup is itself a sufficient
   source-site anchor after validating its complete original allocation membership.
   Annotation-created empty transitions cannot
   override the actual referenced source site.
3. **Zero-effect native discrepancy events:** use the exact ordinary return
   `document.source` event ID/hash and case provenance, then its controlled event
   transitions. Require product, dispense, intake and allocation membership to
   agree. Resolve notes/resolutions through their explicit original case/source,
   not a search for the newest return or an arbitrary prior product event. Include
   referenced correction targets as distinct evidence, never inherited approval.
4. **Pre-opening source with no controlled event:** support only the fully
   retained prepared-package adapter specified below. Its site basis is explicitly
   `opening_custody_site`, not original dispensing site. All other missing-site
   cases return `historical_site_unproven` and refuse signing; no guessed fallback.

For rules 2–3, reject missing/ambiguous predecessors, forward/self references,
cross-product references and conflicting sites. Use a finite declared chain
shape and bound it, rather than unbounded recursive ancestry. An original source
may validly predate opening; rejecting an unproven site is not a corruption claim.
Do not use current container heads/positions, mutable location, lot location text,
current policy membership or the caller's selected site as historical evidence.

### Resolved legacy/opening contract

`opening.sql` establishes what can actually be proved. The stored boundary has
exact dispense document/operation hashes, return/correction/discrepancy prefix
heads, pickup evidence and per-allocation quantities. **It contains no site.**
`controlled_stock_validate_opening` recomputes that boundary, rejects partial
old/new movement membership, checks each later source's exact managed link and
reconciles prepared/held quantities in both directions with immutable opening
cells. The opening containers supply their immutable controlling sites. Neither
that count nor a lot's location establishes where an earlier dispensing happened.

For a post-opening clinical/operational annotation of a pre-opening dispense,
the new adapter may return `opening_custody_site` only when all of these hold:

- The annotation's parent event/opening/product and exact native dispense,
  authorization, patient, document hash and allocation set agree. The target is
  the new controlled annotation, never a fabricated pre-opening controlled event.
- The referenced opening passes the unchanged opening validator. Its unique
  boundary entry equals the exact constructor result using its stored prefix
  selectors. Every original allocation's debit belongs to that same opening's
  original movement membership; no straddling or substituted dispense/lot.
- At that boundary, pickup is null, return and discrepancy heads are zero, and
  every allocation has `prepared_quantity == dispensed_quantity > 0` and empty
  held entries. A retained clinical/operational annotation prefix is allowed;
  its head and amendment ancestry must be exact. A pre-opening pickup amendment
  is not compatible with this no-pickup case.
- For each exact original allocation and lot, sum only positive opening-created
  `prepared` cells belonging to this opening and dispense. Their quantities must
  equal that allocation's full dispensed quantity. All selected containers have
  matching opening/product/unit, and their distinct controlling-site set has
  exactly one member. Multiple containers at that one site are supported.
  Zero-quantity cells cannot supply site evidence or hide a second site.
- The new annotation's sequence is after the stored correction prefix, and the
  unchanged opening validator identifies it as a later controlled source. Retain
  the cutoff heads, boundary hash, selected immutable cell/container rows and
  original document hashes in the packet. Any managed dispense/pickup evidence
  for the same source must agree with the resulting site; conflicts fail closed.

This proves the package's controlling site **at opening**, which is sufficient
for the explicitly labeled review scope of its later annotation. It makes no
claim about original pre-opening physical location or event time. Current heads,
positions and subsequent quantities are not inputs; later depletion does not
rewrite that evidence. A pickup amendment instead requires an exact managed
original pickup as above; do not infer its handoff location from an old count.

| Actual retained fixture/source case | What source establishes | C2a result |
|---|---|---|
| `187_prepared_native` | Canonical original dispense exists, but modern movement provenance is absent; the opening constructor rejects it. | No fallback; visible unsupported provenance. |
| `188_prepared_native` | Two original allocations, exact modern movement sources, full prepared quantities; projection accepted. | Eligible for the opening adapter only after an actual valid opening supplies the exact positive one-site cells. Projection alone has no site and is not enough. |
| `188_clinical_annotation`, `188_operational_annotation` | Valid retained correction prefix does not become a physical hold; full prepared projection accepted. | Same conditional opening adapter for a later controlled annotation, preserving the retained prefix. Do not backfill the old annotation as a new event. |
| `188_pickup`, `188_pickup_amendment` | Original pickup exists but pre-189 `stock_pickup_sources` is absent; exact opening pickup verification rejects. | No backfill or earlier-site inference. |
| `188_unresolved_discrepancy` | Real intake/report and hold exist; opening constructor explicitly rejects an unresolved cutover case. | Unsupported opening exception remains unavailable. |
| Proven modern pickup of an opening-prepared package | Exact managed pickup event/transitions identify the package's controlling site; native operation/allocation evidence matches. | Supports a later pickup amendment through that pickup target, not through guessed original dispensing site. New genuine fixture required. |
| Partial prepared/held package, zero-only cells, completely handed-off boundary, multiple sites, or discrepancy whose ordinary source predates opening | May retain valid native history, but the restricted adapter cannot establish its declared complete-package site basis. | `historical_site_unproven`; no signing or inferred site. |

These conclusions are source analysis of `native-history-seed.sql`,
`native-history-observe.sql`, `opening.sql` and `opening-history.sql`, not a new
runtime claim. The legacy observation fixture deliberately has no site/opening/
cells; accepted projection must never be reported as accepted site derivation.
New acceptance must construct a genuine valid synthetic opening and later owned
annotation, then prove the complete algorithm and its refusal cases.

### Exact discrepancy and correction source shapes

For all four discrepancy kinds, `source_bundle.native.document` is the exact
`native_return_discrepancy_events.document`. `document.source` has precisely
`{event_id, record_hash}` for an ordinary native return action `intake`, `dispose`
or `restock`, from v1 or v2. Its `target` has authorization/pet/dispense IDs.
`allocations` is sorted unique `{allocation_id, lot_id, quantity}` with positive
quantity no greater than the source allocation. It is not a reference to the
previous discrepancy event. The independent native verifier binds the source
document, operation request/result/hash, exact return/discrepancy heads, actor,
time, prefix chain and source quantities.

| Discrepancy action | Exact additional contract |
|---|---|
| `report` | New case ID is this event ID. Source and allocation subset establish the case. It does not create a stock quantity effect. |
| `note` | Same open case, exact original source and exactly the case's allocation set/quantities; no compensation IDs. |
| `resolve_confirmed_original` | Same open case/source/allocations; actual canonical DVM confirmation and no case-linked compensation through the reviewed return head; empty correction IDs. C2 review does not replace that source assertion or release a different hold. |
| `resolve_corrected` | Same case/source/allocations; sorted unique 1–100 correction IDs identify v2 `retract_*` return events whose `correction_target` equals the original source and `discrepancy_id` equals this case. Exact `native_return_discrepancy_correction_links` bind case/correction/resolution, and summed compensation per allocation equals the case quantity with no extra allocation. Each correction remains its own review target. |

The site adapter verifies the full canonical source then derives the site from
the **exact ordinary source's controlled event**, checking same product/dispense
and the source document hash. It verifies case/report and all resolution links;
it never follows `prior_event_id` as if that were the affected physical source.
No generic recursive search is needed. If that ordinary source has no controlled
event, the first slice returns unsupported even when the native source is valid.

For the three dispense annotation kinds, the document carries exact
`target`, `authorization_hash`, `dispense_document_hash`, `sequence`, prior
event/hash, actor, kind, reason/note, `amends_event_id`, `pickup_amendment`,
reviewed-context hash, created time and record hash. `amends_event_id`, when
nonnull, references an earlier correction of the same kind and dispense; it does
not itself carry a separate target hash. Bind the referenced immutable document
and hash after the canonical verifier checks that relationship. For a pickup
amendment, `pickup_amendment.original_pickup_id` identifies the actual original
pickup and `amends_event_id` equals the prior pickup-amendment head (null for the
first amendment). A “recorded in error” value is still annotation, not an actual
returned package or usable stock.

The existing genuine `native-operations.sql` fixture exercises all three
annotation kinds and `report` → `note` → `resolve_confirmed_original`, followed by
a second report, an exact v2 retract-disposal and `resolve_corrected`, against
the same ordinary v2 disposal source. Add an equivalent v1 ordinary-source case
to new acceptance; the canonical validators permit v1/v2 ordinary sources, but
this existing fixture alone is not evidence that the new adapter has exercised
both. No source interpreter or runtime was changed for this analysis.

`controlled_stock_context` permits existing containers with empty line arrays,
and posting can retain their transitions even for a zero-effect annotation.
Therefore discrepancy/annotation site dispatch always uses these source-specific
rules **before** considering transition presence. Arbitrary empty-line transitions
cannot confer site scope; any conflicting retained evidence rejects. Physical/
retraction adapters continue to require their actual source effects and exact
line/cell membership under the parent validator.

## Versioned extension and admission

Proposed next schema: `controlled_review_v3`, with newly named public facades such
as `prepare_controlled_record_review_v3`. Names are provisional until inventory
review. They must avoid the frozen parent selector prefixes and the six exact
v2 facade names. Do not replace functions, add triggers/indexes/columns to parent
relations, grant the old private facades, or write into the v2 definition stream.

Before implementation, prove a new Gate A against the fully admitted 206 package:
new object name collision rejection; unchanged 205 manifest literal/revision/live
snapshot and ten writer bodies; unchanged private v2 descriptor/live snapshot;
all original rows and ledger preserved; exact new child and parent-side internal
RI-trigger inventory. An added child FK can add an internal trigger on a frozen
parent: the new descriptor must bind that trigger semantically while proving the
old selectors unchanged. Do not exclude all parent RI drift to make admission pass.

Derive the new descriptor from reviewed finite DDL, signatures, function bodies,
ACLs, columns, indexes, constraints and trigger semantics. Independently realize
it in a disposable reference, compare, freeze a new artifact and its complete
input map, then accept against that frozen artifact. Default installation remains
private; any later app-grant profile is separately predetermined and reviewed.
No new migration number is assigned until its actual release predecessor is fixed.

The promoted private v2 package contains no definitions or review operations.
Prefer a v3 admission invariant that those v2 operational tables are still empty;
the old helpers remain private and serve retained tests only. If populated v2
history must be supported, design a separate read-only bridge and terminal
ownership rule first. Two live protocols independently accepting a decision for
the same event is not acceptable. Reusing an event lock alone cannot make an old
terminal guard check a new table. Privileged-owner writes are not an application
authorization path; restore/integrity checks must nevertheless detect mixed or
conflicting histories. Do not claim concurrent old/new signing is solved.

## Policy, eligibility and calendar data

Separate three concepts: the parent event's frozen `secondary_review_required`
flag; the policy obligation attached to that exact historical event; current
permission to read or sign. Revoking a signer or disabling a new-operation rule
must not erase an outstanding obligation, original deadline or saved receipt.
No new policy retroactively changes the parent flag or invents an old approval.

Proposed immutable records (exact SQL still requires review):

| Record | Required binding and validation |
|---|---|
| Site policy version | Exact site/product scope, consecutive version, predecessor/hash, approval provenance, enabled state, effective start and server publication time. Exact event-kind rules refer to adapter version, fixed review meaning/quorum, deadline rule and escalation rule. Effective end is derived from the next version's start. Separate review from physical observation. No real seeded defaults. |
| Eligibility version | Site/product/event-kind/capability scope, named actor membership and permitted live roles, consecutive version, enabled flag and provenance. Current active profile, real session and live role must also pass. ADMIN is not an implicit reviewer override. Use actor identity, not session/name, for independence. |
| Calendar version | Site, IANA zone identifier, bounded date coverage, explicit staffed/un-staffed local dates and close instants. Validate local-date/UTC mapping, ordering and daylight-saving ambiguities; no assumption that Monday–Friday or the server timezone is the practice calendar. Retain resolved UTC boundaries so later tzdata changes cannot rewrite old deadlines. |
| Event obligation | Unique exact event target and adapter version; policy/calendar version and hashes, actual anchor timestamp, resolved staffed date/close instant or explicit unavailable reason; required review meaning and frozen escalation owner/rule reference. Derived server-side, immutable and idempotent. |
| Review operation | Owned preparation/request/packet/target hashes, server transaction/boot/expiry context, explicit decision and meaning; immutable final receipt/cancellation with deferred reciprocal checks, following the proven v2 lifecycle. |
| Escalation evidence | Obligation ID, reason, stable idempotency identity, first detected server time, responsible routing version and later acknowledgment/resolution evidence. No automatic approval, stock refund, external message or provider action. |

An ordinary administration/dispensing obligation anchors its approved
next-staffed-business-day calculation to the actual event time, not the time a
queue is opened. Convert to the site's local date, select the first later date
explicitly staffed in the frozen calendar, and use its explicitly configured
close instant. A record entered late can already be overdue when first seen.
An absent calendar or insufficient date coverage produces an explicit unavailable
deadline; an unavailable eligible reviewer produces a separate blocked signing
state and escalation. Neither becomes an invented due date or silent exemption.
Technical preparation TTL remains 15 minutes and is unrelated
to this deadline. The boundary is explicit: completed by `due_at` is timely;
unfinished with server time greater than `due_at` is overdue.

The approved recommendation does not specify an identical deadline for every
return, pickup, discrepancy or amendment subtype. The following exact configuration
contract encodes the choice without providing real defaults or silently creating
duplicate native deadlines.

### Exact policy selection and deadline contract

Each published site/product policy contains exactly 22 keyed event rules, one for
each listed literal kind. Every rule has explicit fields `enabled`,
`adapter_version`, `meaning`, `quorum`, `deadline_mode`, `deadline_anchor` and
`escalation_mode`; unknown/missing keys or kinds reject. Supported meaning is
`independent_record_review_v1`, quorum is exactly `1`, and enabled rules require a
reviewed adapter. `deadline_mode` is `next_staffed_day_close` or
`not_configured`; `deadline_anchor` is fixed by kind as below, never arbitrary
JSONPath or a caller timestamp. `escalation_mode` is `overdue`,
`immediate_on_record`, or `not_configured`, with exact allowed combinations.
Publication also binds the chosen calendar version/coverage, named routing
configuration version and approval reference. This is a proposed finite schema,
not a configuration seed.

| Kind group | Historical policy selection anchor | Supported deadline/escalation configuration |
|---|---|---|
| Patient treatment and anesthesia | Parent `observed_at`, which must equal original administration time | An enabled commissioned ordinary rule requires `next_staffed_day_close` and `overdue`. |
| Native dispense and pickup | Select one family policy at the exact original managed dispense's `observed_at`; calculate the chosen event's deadline from that event's own `observed_at` | Policy has required `native_deadline_kind` equal to exactly `record_native_dispense` or `record_native_pickup` when either ordinary native deadline is enabled. Only that kind may use `next_staffed_day_close`; the other explicitly uses `not_configured`. No default choice and no automatic paired deadline. Both can still require independent record review according to their own parent flags. |
| Receive, adjust and ordinary return actions | Parent `observed_at` | This first slice leaves deadline mode `not_configured`. Pre-release checking, typed loss/waste and return eligibility are separate physical policies; no invented generic next-day rule. |
| Retractions and dispense annotations | Parent `recorded_at`; `observed_at` must be null | Independent review, deadline `not_configured`; no inherited approval or fabricated physical date. A later deadline rule requires an explicitly versioned reviewed addition. |
| All discrepancy actions | Parent `recorded_at`; this is record availability, not asserted discovery time | Deadline `not_configured`. `report` uses `immediate_on_record`; later notes/resolutions do not duplicate the original report escalation. This does not claim prompt recording or compliance with an external discovery-based reporting clock. |

For native rules, the selected kind is a practice configuration choice that must
be recorded explicitly before commissioning; software tests both choices using
synthetic policies. Choosing pickup does not manufacture a pickup for an unclaimed
prepared package. Its existing preparation review obligation remains visible with
no configured deadline. Bind the choice, policy/calendar versions and exact source
target once per original `dispense_id`, even if the pickup queue materializes this
binding first. Recompute from the immutable original managed dispense's site/time,
not the current policy. The pickup's independently proven site must agree. Changing
the selected kind later applies to new dispense families, so a policy revision
between preparation and pickup cannot produce two deadlines for one family.
The selected pickup deadline still anchors to the pickup's own observed time;
this does not pretend the preparation happened at handoff. Missing original
controlled dispense or historical family policy means the deadline is unavailable,
including an otherwise site-supported opening-package pickup. It may still receive
current authorized record review. Selecting both or omitting the choice
while enabling the deadline rejects publication. No clinical fact is needed to
build and test this finite choice now.

Publish policies under an exact site/product stream lock with contiguous versions,
strictly increasing `effective_from` and server-stamped `published_at`.
`effective_from >= published_at`; no retroactive publication. Effective intervals
are half-open `[effective_from, next_version.effective_from)`, derived from that
immutable stream so overlapping intervals cannot be supplied. No mutable `end_at`
on an old row. Select the one interval containing the event's fixed anchor and
require its publication time no later than that anchor. A latest currently enabled
version is **not** a historical selection rule. A disabled rule at that anchor is
retained explicitly; it cannot erase a parent's required-review flag. Future
scheduled versions cannot authorize today's signing; current authorization is
selected independently at server time, with an immediate eligibility revocation
stream so a scheduled policy does not prevent present access revocation.

Late-recorded physical events select by their actual observed time. For example,
an event observed before the first publication but entered afterward has no
historical deadline policy; it cannot borrow the publication's date merely because
the write occurred later. Assertion events select by their actual server record
time. Policy changes effective exactly at the anchor use the new interval;
deadline changes never recompute an already persisted obligation.

Calendar versions are independently immutable and published before the applicable
policy becomes effective. The policy references one exact version; an obligation
stores the anchor, local date, selected next staffed date, resolved UTC close,
calendar/version hashes and calculation version. Missing historical policy,
explicitly unconfigured mode and insufficient calendar coverage have distinct
reasons. No result is silently replaced by current configuration. A future version
may extend calendar coverage for future obligations; a previously unavailable
historical deadline remains unavailable in retained evidence.

Calendar/policy revisions publish prospectively. Old obligations retain their
version/deadline; a later staffing closure needs a separately attributed exception
or amendment, not an UPDATE that erases lateness. Missing historical configuration
cannot be filled by pretending a newly published version existed earlier. A new
definition may enable a current review of an old record while keeping its missing
historical deadline visible.

### Review meaning, terminal outcome and visible states

C2a supports one meaning only: **“Independent record review; no claim of personal
physical observation.”** Its semantic key is `independent_record_review_v1` and
quorum is exactly one distinct authorized person other than the event's original
actor. Changing session or display name does not create independence. Physical
witnesses, multi-reviewer quorum and re-review are not configurable options hidden
inside this first protocol.

One obligation identity is permanently unique on `(event_id, meaning)` and binds
that event's exact target/hash. Policy changes cannot create a competing obligation
for the same meaning. An event with parent `secondary_review_required=false` is
reported as `not_required`; C2a does not create a required obligation for it by
backdating a policy. For a required event, approval and rejection are each terminal
and mutually exclusive. One unique terminal row per obligation and one owned
operation receipt make this a database invariant. Cancellation terminates only the
owned preparation, not the underlying review obligation.

Rejection records the exact rejected packet and reason, creates a separate
escalation, and leaves the original event and stock unchanged. It cannot be edited,
replaced by approval or cleared by publishing a new policy. Resolving an escalation
does not turn rejection into approval. A genuine correction has a new canonical
event/target/obligation and needs a new independent review; the original rejection
remains. Re-review of unchanged evidence would require a separately designed
append-only adjudication protocol and is unavailable in C2a.

Expose separate status dimensions instead of conflating authorization and history:

| Field | Finite meaning |
|---|---|
| `review_state` | `not_required`, `awaiting_review`, `approved`, `rejected`. Preparation expiry/cancellation never erases `awaiting_review`. |
| `deadline_state` | `not_configured`, `not_assigned`, `historical_policy_unavailable`, `calendar_unavailable`, `not_due`, `overdue`, `completed_on_time`, `completed_late`, `completed_time_unassessable`. `not_assigned` means the other native event was explicitly selected for the family's deadline, not that this event's required review disappeared. Retain the specific unavailable/unassigned reason alongside a saved decision. |
| `signing_state` | `available`, `blocked`, `terminal`, with bounded reason codes for exact current authorization, unsupported provenance, metadata integrity or technical operation state. This is current and actor-specific, not stored historical permission. |

Missing historical policy/calendar does **not alone forbid signing**. If an exact
current review authorization and supported site/packet exist, a person can review
the old record while its receipt explicitly says the historical deadline is
unavailable and makes no timeliness claim. Bind the historical selection inputs,
absence reason, native family source target/choice when relevant, event-specific
deadline anchor, current authorization ID/version and exact packet in the receipt;
later configuration cannot change them. Unsupported historical site/source or
missing current authorization does block signing. These cases have different
queue labels and acceptance assertions.

Current `read` capability is independent of current `review` capability. A scoped
authorized reader sees all required obligations in that scope, including those
with no eligible signer, missing historical configuration, unsupported site or
terminal rejection; the queue must never filter by who can currently sign.
Site-unproven entries cannot leak into an arbitrarily chosen site queue: expose
them only through a separately explicit product-scoped `exception_read` capability
that grants no signing and returns the bounded provenance reason. No ambient
ADMIN privilege substitutes for either capability.

Revoking a person's read access removes that person's access, not the obligation,
deadline or escalation. Explicit oversight/exception readers can retain visibility
without being signers. If every reader or escalation recipient is unconfigured,
persist the backlog and a routing-unavailable diagnostic for an explicitly scoped
configuration/audit capability; never send it to an arbitrary user. Worker discovery
does not depend on an interactive user's eligibility. Current role/scope changes
invalidate queue cursors as needed, but do not mutate historical obligations.

Because the frozen physical writer cannot insert new obligation rows, the first
slice must not rely on a trigger on `controlled_stock_events` or on a worker having
already seen every event. A bounded queue derives missing obligations from exact
immutable events and eligible policy versions, shows them even before persistence,
and persists each obligation under its event lock before preparation. An eventual
worker uses per-product sequence checkpoints and idempotent obligations/escalations;
backlog lag is observable and cannot move the anchor or hide an overdue event.
Acceptance must distinguish immediate derivable overdue state from eventual task
creation. A stronger atomic obligation-creation promise requires the separately
reviewed outer physical facade discussed below.

## Locking, revocation and recovery

Retain READ COMMITTED, actual Auth session matching and exact owned request checks.
For new review operations use shared practice barrier `90271040` first, then
operation UUID, then native deadline-family UUID when applicable, then event UUID,
then the exact policy/eligibility scope locks in a
fixed lexical order. Reuse the old review event namespace only if required for a
reviewed compatibility bridge; do not silently create competing terminal domains.
Take configuration locks late so an operation waiting for its event lock does not
block a committed revocation. Configuration publication takes the shared barrier
and its own exact stream lock; it never acquires an operation/event lock or upgrades
the practice barrier. Installation takes the barrier exclusive first.

The same barrier → operation → native-family (when relevant) → event → exact
configuration order applies to obligation workers and every direct-insert guard.
No path can acquire a native-family lock after an event lock. Family selection
reads other immutable event evidence without acquiring another event lock; it
does not call a physical writer or take its product/lot/container locks. Native
family rows are unique by original dispense ID and exact meaning; a losing
materializer must compare the already stored binding exactly after the wait.

After each blocking lock, re-read actor/session, current roles, exact current
eligibility and policy versions, target/packet, cancellation/terminal state and
technical expiry. Final validation follows the last wait. A configuration version
change during preparation requires fresh explicit review and a new operation after
the original is read/cancelled; do not replace the retained request. Definitions
use contiguous immutable versions and newest disabled means disabled, not fallback.
All direct insert guards use the same lock order; deferred checks alone do not
serialize decision-versus-cancellation races.

Existing role/session mutators do not automatically obey a new C2 advisory lock.
State the permission linearization point as the fresh post-wait server check;
prove revocation committed before that check rejects. If requirements demand
commit-order serialization with a later role/session revocation, audit and extend
those mutators under a separate compatible design rather than claiming a new lock
already controls them. Do not lock mutable authorization rows casually and create
a cycle with the frozen physical writer's lock tails.

Keep prior-transaction preparation semantics: another top-level transaction is
required to sign; a savepoint is insufficient. Server boot/XID and creation/expiry
are not caller-supplied and survive restore without rewriting. Signing verifies
the exact displayed packet and definition; distinct current actors are required.
Committed owned receipt recovery precedes current execution eligibility and TTL
checks, after identity/session and metadata integrity checks. A new live session
for the same actor can recover; another actor cannot. Revocation must not make an
already committed result look unknown. Pending work returns explicit cancelled,
expired, stale or blocked states; uncertain ACK never means retry with a new UUID.

Keep bounded queue semantics: maximum 100 candidates per page, explicit scope and
version-bound cursor, empty-but-continuing pages supported, no hidden excluded
identifiers in cursors. Adding deadline/eligibility filters must not turn the
cursor into an unbounded scan or silently change existing v2 pagination semantics.

## Future physical-policy facade: feasibility, not authorization

Frozen `controlled_stock_permission` rejects `witness != 'none'` unconditionally.
Therefore setting the parent policy to `c2_required` cannot be made executable by
a new UI or ordinary wrapper. A possible additive route is a separately sealed
outer physical policy with the parent engine policy still accurately describing
its own narrower enforcement. This must be explicitly displayed and audited as
two policy layers; it cannot claim that the frozen parent enforces observers.

Assess a new SECURITY DEFINER facade as the **only app-granted controlled physical
surface**, retaining all old physical prepare/execute/helper ACLs unchanged and
private. It could bind outer operation UUID, unchanged parent request/context,
exact policy version, identified actual observers and independent evidence before
calling the old protocol once. Existing ordinary writer grants cannot supply the
private executing context for managed products. Do not grant schema/helper access
or create a service-role bypass. Prove this against every writer and nested
anesthesia path, not merely the intended UI.

Before adopting that design, resolve these exact gaps:

- **Replay/ownership:** use one permanently bound physical operation identity;
  prove parent saved receipt and outer saved receipt reconcile without a gap, and
  that outer saved recovery remains available after eligibility changes. A parent
  result without its required outer binding must be an integrity failure, never
  adopted into a different outer request.
- **Cancellation:** serialize outer cancellation, parent cancellation and execute;
  parent saved state wins over cancellation. There must be no surviving prepared
  parent operation that an app can execute outside its outer requirements.
- **Context/observation:** an observer signs exact identified quantity, source and
  actual observation, not a generic approval token. Distinguish pre-release receipt
  checking from recording an act already performed. Delayed entry cannot fabricate
  timely approval; an exception record must preserve the actual event honestly.
- **Late waits:** the unchanged parent can block after the outer check on its
  product/lot/canonical locks. Recheck outer policy, observer evidence/session rules
  and stale state after the parent call, before commit, and roll back all database
  effects on failure. Prove this with observed waits. If the chosen physical rule
  requires approval before a real-world act, an after-call database check alone
  does not establish that real-world ordering.
- **Locks:** outer barrier/operation ordering must compose with the frozen parent
  barrier → controlled operation → existing canonical lock tails → product/lot/
  container order. No late exclusive barrier upgrade, new lock acquired in an
  inverse order, or observer sign transaction waiting on a physical transaction
  that waits for that observer.
- **Integrity/restore:** outer rows must bind parent event/action/receipt and
  observer evidence in both directions, including late failure and restore.
  Adding a parent trigger would violate the frozen seal; prove application-path
  enforcement plus independent full-history detection, and label privileged owner
  bypass limits. Do not present owner-trigger disabling resistance as an ACL claim.
- **Missing event semantics:** generic `adjust_inventory` does not contain a
  structured physical waste/discovery/correction target. An outer typed envelope
  would need its own immutable binding and allowed quantity semantics. Transfers,
  counts and off-site waste require their own reviewed design and cannot be solved
  by renaming an adjustment or approving an unresolved SOP.

This assessment allows record-review C2a to proceed independently. It does not
prove the outer physical facade sufficient for all C2/C3 requirements, authorize
its implementation, or require modifying/resealing the frozen parent as a shortcut.

## Proposed file ownership and acceptance gates

After independent design approval, create a new isolated worktree. Reserve new
names; do not evolve the current v2 SQL or generator in place.

| Owner | Proposed responsibility |
|---|---|
| Schema worker | New `record-review-v3-schema.sql`, finite `record_review_v3_descriptor.py`, target/site adapter SQL and immutable policy/calendar/obligation validators; new expectation artifacts only after separate reference. |
| Protocol owner | New `record-review-v3-protocol.sql`, owned lifecycle and bounded queue/configuration facades; exact request/response schemas, capability boundaries and recovery semantics. No physical wrapper edits in this slice. |
| Probe worker | Sole runtime owner; new v3 source/adapter/Auth/contention/calendar/restart/restore harnesses and actual CLI transaction proof when promoted. All fixture identities/configuration synthetic and local. |
| Independent reviewer | Source and lock-graph review before reference; independent descriptor/reference/freeze audit; raw acceptance and cleanup audit; no implementation ownership. |
| Root | Requirement mapping, integration, sanitized evidence, PR, exact-head CI/preview and specific merge approval. Future UI/physical slices separately assigned. |

Required meaningful proofs:

1. Enumerate all 22 strings from the effective admitted sources; test one real
   owned canonical event per supported adapter, including v1/v2 ordinary returns,
   every retraction, every discrepancy resolution and all three annotations.
   No fabricated `controlled_stock_events` success fixture. Anesthesia remains
   one debit/charge; native preparation, pickup, custody and compensation remain
   distinct exact effects. Preserve all original rows and sources.
2. Site negatives: zero-container annotations, missing controlled predecessor,
   pre-opening source, conflicting/multiple sites, same lot at different sites,
   wrong product/allocation/source hash, forward amendment, relocated current
   head and changed current policy. Valid packets stay equal after unrelated
   current-state changes; unsupported historical provenance is explicit.
3. Calendar determinism: weekend/nonstandard staffed days, holidays/closure,
   split staffing, end-of-day boundary, year/leap transition, daylight-saving
   gap/fold, missing horizon, late recording, retrospective configuration refusal,
   new calendar after obligation, no eligible reviewer and absent responsible
   routing. Retain exact original due instants across restart/restore and tzdata
   observation changes. Test both native deadline-kind choices, preparation/pickup
   policy changes, pickup-first materialization, missing legacy family policy and
   a still-required other event with `not_assigned`. No duplicate native-family
   deadline or 15-minute-TTL/clinical-deadline conflation.
4. Genuine two-person Auth: own-record refusal across different sessions,
   cross-account operation isolation, no ADMIN bypass, named-roster/role
   intersection, packet tampering, stale definition/calendar, raw helper/table and
   service/anonymous denial. Observe actual blocking waits, then commit role,
   profile, session or config revocation before release and require exact refusal.
5. Real transaction boundaries: prior commit, natural technical expiry around an
   observed wait, cancellation/execute and competing reviewers, immutable terminal
   evidence, deferred late failure, unknown ACK saved recovery under new session,
   restart and populated restore. Configuration revocation must remain possible
   while a signer waits on an event lock.
6. Independent seal drift: functions/security/ACL/column ACL, constraints, type
   inventory, indexes and both sides of RI triggers; parent205 and private206
   exact literals and metadata remain unchanged. Restore audits historical
   bindings without requiring today's eligibility/calendar to match old policy.
7. Queue/escalation: >100 real events; sparse empty pages with continuing cursor;
   no excluded identity leak; changed scope/version rejects; new obligation and
   escalation retries do not duplicate; scheduler absence does not hide due work.
   Read-authorized but review-revoked users retain obligation visibility; read
   revocation removes access without deleting evidence. Product-scoped unsupported
   provenance cannot leak through a chosen site cursor. Missing historical policy
   → new current authorization → saved review/recovery must never fabricate a due
   date. Rejection is terminal, remains visible and escalates; a new correction
   requires its own review. Escalation never modifies stock, approves a review or
   sends external messages.

## Design decisions ready for independent challenge

The initial source questions are now resolved into finite contracts, subject to
independent review and implementation proof:

- Legacy site support is limited to the complete-package opening adapter and
  exact managed pickup evidence described above. Accepted native projection is
  not accepted site provenance. All enumerated partial/handed-off/zero-only/
  multisite or unlinked discrepancy cases remain explicit unsupported results.
- Discrepancy sites use the exact ordinary `document.source`, not prior-case
  sequence; compensation and case quantities are verified separately. Zero-effect
  annotations ignore arbitrary empty-line transitions as site authority.
- Native deadline choice is explicit, finite and bound once per exact original
  managed dispense family, with the selected event's own time as due-date anchor.
  No policy default or configuration transition invents a second paired deadline.
- C2a installs over operationally empty v2 only. Populated v2 bridging and parallel
  old/new signing are out of this slice; refusal is explicit and tested.
- One independent record-review meaning/quorum and one terminal outcome are
  supported. Rejection remains terminal; re-review and physical observations are
  separate future protocols. Historical deadline absence does not bar a review
  authorized now, and is retained exactly in its receipt.
- Authorization is checked fresh after all observed waits. Stronger commit-order
  serialization with unrelated role/session mutators is not claimed. The source
  audit and contention tests must establish this stated linearization point.

Implementation review must still fix exact bounded SQL/request schemas, index and
constraint inventory, publication/eligibility administration authorization,
calendar gap/fold validation and evidence packet limits before freezing the new
descriptor. These are protocol completion checks, not permission to infer actual
practice facts. Calendar exceptions cannot rewrite deadlines in C2a; unexpected
closures are separately recorded escalation annotations, with original due dates
retained. Any future due-date adjudication requires a distinct reviewed extension.

The outer physical facade remains a separate feasibility/design gate. The frozen
witness refusal and absence of typed adjust correction/loss semantics are concrete
boundaries, not missing frontend buttons.

Completion of this design and its synthetic implementation must leave site/roster/
opening/SOP commissioning empty and activation unavailable. The physical recovery
case of an event after backup, full clinical rehearsal and later hosted installation
remain separate required gates in the completion plan.
