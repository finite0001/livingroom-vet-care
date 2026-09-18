# Dispense annotations and pickup amendments — browser contract

Status: read-only implementation proposal for the next native slice. No correction RPC, screen, print or release behavior is implemented by this document. Exact closed server shapes, privileges and projection versions must be reconciled with the database contract before coding.

## Existing code and reusable boundaries

- `src/hub/features/prescriptions/PrescriptionFulfillment.tsx` lists immutable dispenses, lot allocations, fill slots, closures and pickup acknowledgments. Its independent histories have explicit cursors; loaded pickups are not a complete assertion that no pickup exists. The new amendment action must use an authoritative exact-target read, not a search through the current page.
- `usePrescriptionOperation.ts` and `prescription-state.ts` freeze the reviewed UUID/payload, require recovery before a retry after uncertainty, preserve identity after a later definitive rejection, isolate actor/patient generations and ignore late replies. Its generic operation `kind` can support new operations once a strict adapter validates their full receipts; no state-machine rewrite is needed.
- `PatientPrescriptions.tsx` combines editor dirtiness and sibling authorization evidence revisions. Fulfillment refreshes clean siblings after confirmed/recovered mutations, marks dirty evidence stale and never remounts an uncertain operation. Extend this existing guard rather than introduce a second route blocker.
- `prescription-print.ts` and the shared native renderer bind fresh current status to exact immutable signed/dispensed artifacts. Existing print bundles do not contain corrections. A new API projection and renderer contract are required before current print can claim to disclose annotations.
- `record-releases/refresh.ts` invalidates current source discovery/history after confirmed mutations. Schema10 frozen packages contain original native records and pickup, with no amendment ledger. Cache invalidation alone cannot make an old package ineligible: the server must record affected release invalidation, and new releases need explicit versioned amendment disclosure.

## Patient workspace flow

Add an exact-dispense correction panel, preferably `PrescriptionFulfillmentCorrections.tsx`, opened from the immutable dispense card. Use plain actions “Add a record annotation” and, where an authoritative pickup exists, “Amend pickup record”. Keep original quantity/unit, medication instructions, original lots, timestamp, author, original reason and stable record IDs available throughout. IDs are secondary to patient, medication and dates.

Show two visually separate areas: “Original record” and “Later annotations”. Never overwrite the original card's quantity, lot, pickup recipient or time with corrected values. Each append-only entry displays actor, recorded time, reason, its exact target and prior amendment head. Display the current interpretation separately and label it as an attributed correction. History pagination must expose an explicit load-more action and errors; a partial list must never be described as the complete history.

An annotation is a narrative assertion about the original record. A reported numeric discrepancy is not an inventory adjustment, invoice credit or allowance restoration. Do not offer a generic “Undo dispense” action or editable replacement quantity/lot fields unless the server contract explicitly defines them as attributed evidence with no ledger effect. Required nearby copy: “This annotation preserves the original dispense. It does not change stock, charges or prescription allowance.” No stock/quantity inputs should be initialized to invented medication defaults.

Operational documentation may be staff-attributed; clinical interpretation requires the server-defined DVM authority. Show the selected category and required authority before writing. Do not infer eligibility from a display name or frontend role alone. Server rechecks current active role after its locks. Do not silently convert a failed clinical operation into an operational annotation.

## Pickup semantics

The UI must distinguish at least these meanings, with exact enum names left to the database contract:

1. **Original acknowledgment is inaccurate; actual handoff is not established.** Required explanation; no synthetic corrected recipient/time. Show “Original pickup acknowledgment disputed” or equivalent precise wording. This does not establish that stock was returned to the practice or reopen a refill.
2. **A corrected actual handoff is attested.** Explicit recipient identity/relationship, actual occurrence time if supported by the contract, reason for the change and an affirmative staff attestation. The recorded amendment time remains separate from the asserted handoff time. Show both the immutable original acknowledgment and the corrected attestation.

Never default the actual-handoff attestation on. Changing a recipient spelling must still identify the original acknowledgment and preserve its history. Do not create a second ordinary pickup or alter the original refill closure to simulate an amendment. Whether a disputed acknowledgment can later be superseded by an attested handoff must be specified by the server state machine; UI cannot assume it resets eligibility for `record_native_pickup`.

## Exact review, write and recovery

1. Opening the editor reads exact patient/household, authorization and dispense identities, immutable artifact hash, original pickup when relevant, current authorization state and amendment head. No authorization cancellation should hide historical amendment evidence; allowed writes depend on the agreed server contract.
2. User enters category, correction text/reason and any explicitly supported corrected handoff fields. Editing is dirty before preview. Switching patient, actor, authorization, target or editor mode follows the existing combined guard; automatic background refresh cannot discard text.
3. Review fetches fresh exact-target evidence while preserving entered values. The server preview binds relevant original hashes, current amendment heads and relevant role/context evidence. A stale response retains draft inputs and requests renewed review; it does not loop using an obsolete head.
4. Render the immutable original, proposed assertion, current amendment state and concrete non-effects together. Require explicit acknowledgment of this frozen review. Generate one UUID and freeze the exact normalized request only after the preview is validated.
5. A strict `fulfillment-corrections-api.ts` adapter should own closed request/preview/history/receipt schemas. Validate outer UUID/kind/actor, exact patient/authorization/dispense/pickup, request equality, prior head/new head/version, immutable result fields and chronology. Do not treat an RPC success envelope as proof of a matching receipt. Preserve PostgreSQL timestamp precision in comparisons.
6. Reuse the operation hook: a transport error or malformed success preserves the original request; recover that UUID first. Recovery absent means the original transaction may still be running. A later stale/role rejection after uncertainty does not authorize a new UUID. No drafts or clinical request payloads are persisted to local storage.
7. Only a validated confirmation/recovery clears the editor. Increment the shared evidence revision, clear obsolete print HTML, refresh release queries and reload the clean correction panel. Dirty or uncertain sibling panels remain mounted and visibly stale. If refresh fails after confirmation, report “saved; refresh unavailable”, not “save failed”.

## Print and selected-release consistency

Original artifact hashes remain immutable. A fresh print bundle must additionally bind the exact correction/pickup-amendment head and its disclosed evidence to the target dispense. Render original facts and corrections with attribution and current authorization warning. If current correction evidence cannot be loaded or validated, do not print an unqualified stale copy. Existing historical copies remain historical; their check time must not imply current status.

The next selected-release schema must explicitly include the applicable amendment evidence and head in selected dispense context; authorization-only selection must state whether it includes annotations on unselected dispenses. Do not silently expand selection to every dispense. The server must invalidate affected saved packages when a relevant amendment commits, including uncertain-write recovery cases. Frozen schemas1–10 remain byte-for-byte historical projections with their original acceptance policy; a new schema requires its own explicit clinical acceptance. No browser action sends a notice, refunds payment or contacts a pharmacy as a side effect.

## Acceptance cases

- Staff operational annotation; permitted DVM clinical annotation; role denial preserves draft and never bypasses server authority.
- Exact original plus two append-only corrections are visible; paginate beyond a page and surface errors without claiming completeness.
- Wrong-record acknowledgment leaves actual handoff unknown; corrected actual handoff requires explicit attestation and preserves original recipient/time.
- Concurrent head change forces fresh review without losing text; changed context cannot be confirmed under the old hash.
- Lost successful reply, recovery absence, identical retry, later rejection and matching receipt recovery preserve one UUID and one entry.
- Actor/patient/target switch rejects late replies and clears visible wrong-context state; route/unload and sibling edit guards cover unreviewed drafts and uncertain operations.
- Confirmed/recovered amendment updates clean sibling evidence and clears old label; dirty sibling shows stale evidence without losing its original operation.
- Current print and new selected release disclose the exact amendment chain/head; existing schema10 artifact remains immutable but becomes ineligible where server dependency rules require.
- Actual database assertions: original dispense/pickup/artifacts unchanged; stock movements, invoice items, cash/payment ledger, slot usage and refill status unchanged. No automatic messaging.

## Contract decisions needed before implementation

Exact operation enums/role split; allowed pickup amendment transitions; allowed occurrence-time bounds and precision; whether amendments target the original or a prior amendment; canonical current interpretation; bounded history cursor and full print/release chain limits; exact head dependencies and projection/schema versions. A complete narrative chain that exceeds a package limit must fail explicitly or require an expressly designed disclosure format, never truncate silently.

## Contract reconciliation and implementation scope

The subsequently approved `correction-rpc-contract.md` resolves the pending choices above: one per-dispense sequence; active DVM role for clinical annotations (not prescriber commissioning), active staff for other kinds; pickup amendments name the original pickup and latest pickup-amendment predecessor; 25-row default / 100-row maximum history pages; complete print/release disclosure limited to 100 entries per selected dispense; print V2 and explicitly accepted release schema11. Original time and corrected assertion time remain distinct. Clinical annotation recovery needs current active staff and the original actor, not continued DVM authority.

The browser implementation uses `fulfillment-corrections-api.ts` and `PrescriptionFulfillmentCorrections.tsx`, integrated within the existing fulfillment panel and parent dirty guard. This document is the design record; test results and hosted readiness must be reported separately. Numeric ledger correction, physical returns, restock, credit and refunds remain outside this slice.
