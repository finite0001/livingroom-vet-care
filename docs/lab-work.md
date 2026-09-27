# Native lab orders, due plans and results

`PatientLabWork({ petId, onDirtyChange? })` provides native lab tracking for active staff. Antech is the selected laboratory; **no Antech connection is configured or claimed**. There is no provider traffic, automatic order submission, result interpretation, normal-range inference, billing, or reminder delivery in this module. Test names and dates are entered by staff. Lab provider API commissioning requires an agreed official contract, credentials and supervised validation separately.

The module supports planned/ordered/collected/resulted/cancelled records, due dates, collection and result dates, accession identifiers, narrative observations, and links to existing ready private patient documents. It shows 20 orders per page and saved version history. Use Patient documents for uploading and private downloads; a lab link never sends or shares a file. Previously linked documents may later be voided; history retains their identifiers, while new links require ready documents from the same patient.

Standard interval settings are a separate administrator-reviewed section. There are no seeded test names or intervals. Administrators record a clinical reviewer/rationale when creating, revising or retiring a standard. The reviewer field records staff attestation; it is not a digital clinical signature. Selecting a standard stores its ID, reviewed version, interval and anchor on the order. Staff explicitly calculate and review the date. A different patient interval requires a reason. Existing plans are never recalculated when a standard changes or is retired. Manual patient due dates can be recorded without a template.

Both tables write through security-definer RPCs that require an active authenticated staff actor. Standard settings additionally require an ADMIN role. Stable UUIDs and exact version replays make unchanged retries idempotent. Stale edits fail with a retained draft and explicit reload. Inputs are allowlisted; identity, authorship and version cannot be supplied through the order JSON. Private document selection checks and locks the referenced patient document. Direct mutations and history deletion are not granted to browser or service roles.

Every successful change appends an immutable snapshot with actor, time, version and reason. Changes after results, document links or cancellation require an explicit correction reason. Original results remain in history. No missing-source reconciliation, deletion, or silent overwrite occurs. Dates are calendar dates; audit timestamps display America/Denver. Intervals are whole positive days bounded to 36,500; the bound is a technical validation limit, not a recommendation. Collection/result dates cannot be future dates, and result dates cannot precede collection.

## Integration and verification

The component is mounted in PatientPage and reports unsaved/pending edits to its single navigation guard. Global generated types include the lab schema. `model.ts` provides a narrowly scoped typed view of the existing Supabase client; no second client or secrets are introduced.

Synthetic unit, pgTAP and browser tests cover date arithmetic, empty defaults, role boundaries, cross-patient links, stale revisions, retry deduplication, template override/retirement, preserved result corrections, reopen, and mobile editing. Browser tests exercise the actual PatientPage mount, including shared navigation protection. No actual patient information or live laboratory requests were used. Dr. Susan Edler's clinical form review and production commissioning remain required before practice use.

## Per-order reminder switch

`patient_lab_orders.reminders_enabled` mirrors `patient_vaccine_due_plans.reminders_enabled` (migration `20260928150000`). It defaults **off**; staff turn it on per order with the "Enable due reminders for this lab order" checkbox, which `save_patient_lab_order` records as a normal versioned revision with history. Rules enforced on the server:

- only `planned`/`ordered` orders keep it on; any other status clears it;
- turning it on requires a due date;
- a save that omits the key keeps the stored value;
- changing it invalidates any pending care job, and the provider preflight refuses a handoff that was queued before it was turned off.

Candidate discovery, `enqueue_care_reminder` and `reminder_delivery_context` all require it. Which orders should be reminded is a practice decision for Dr. Edler (`C-PILOT-08`); the software does not turn it on for any order. Lab reminder delivery itself belongs to [reminder dispatch](reminder-dispatch.md).

