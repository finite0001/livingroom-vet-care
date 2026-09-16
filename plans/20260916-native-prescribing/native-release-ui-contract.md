# Native prescription release UI contract

Status: proposed browser contract for schema10, September 16, 2026. Analysis only; no implementation, deployment, policy acceptance or clinical approval is implied. Aligned with the parent-approved [database contract](native-release-database-contract.md). Implementation and runtime acceptance remain pending.

## Existing behavior and evidence

Paths below are relative to this worktree.

| Existing source | Observed behavior relevant to schema10 |
|---|---|
| `src/hub/features/record-releases/selection.ts` | Closed `sourceLabels` drives `SourceKind`; no native prescription/dispense family exists. `mergeReleaseSelection` deduplicates and throws before replacing a selection that exceeds its family bound. |
| `src/hub/features/record-releases/api.ts` | Discovery/select-all/preview RPC declarations name v9. Candidates are currently a broad common interface with per-family optional fields. `policy_v9_accepted` is required. Confirmation/read are unversioned RPCs. |
| `src/hub/features/record-releases/PatientRecordReleases.tsx` | Validates every family and `has_more` entry, requests offset `sourcePage * 100`, retains known candidates across pages, and supports explicit individual/page/all-page selections. Preview must be exactly schema9; confirmation freezes selection, recipient, snapshot, hash and one UUID. Policy9 gates confirmation, not preview. |
| Same component | Imported prescriptions, imported vaccinations and API originals are capped at20; other families at100. All-source results are validated before replacing selection. Dependency warnings enforce selected provenance/original pairs. Clinical preview is the shared rendered artifact, not just candidate labels. |
| Same component and `PatientPage.tsx` | Dirty includes selections, preview, uncertain confirmation, withdrawal reason, delivery drafts and busy state. Patient page combines clinical guards and keys release component by patient. Candidate cache currently uses patient/page without actor and allows normal query refetch defaults. Do not assume actor isolation merely from a patient key. |
| `src/hub/features/record-releases/RecordReleaseArtifact.tsx` and `print.ts` | Shared deterministic renderer supplies the preview iframe. Export of a confirmed package requires a fresh authorized read; original files remain separate from HTML. Renderer is the shared Edge/browser implementation, currently schemas1–9. |
| `src/hub/features/record-releases/refresh.ts` | Source mutations invalidate v9 candidate queries plus release history. New native mutations currently coordinate their prescription/fulfillment panels through an evidence revision; they do not yet invalidate release candidates. |
| `src/hub/features/prescriptions/PatientPrescriptions.tsx`, `PrescriptionAuthorizationReview.tsx`, `PrescriptionFulfillment.tsx` | Distinguish immutable signed orders from current status and actual dispenses. V2 shows native used/forfeited/unopened quantities; external remaining use stays unknown. Partial and multi-lot dispensing, forfeiture and pickup are separate records. Fresh label copies bind exact signed and dispense artifacts. |
| `e2e/record-release-workflow.spec.ts` | Existing coverage includes explicit selection, identical confirmation retries, stale rejection, policy gating, malformed candidates, all-page selection, over-limit preservation, provenance dependencies, retained outside-prescription disclosure and separate email/SMS recovery. These are regression requirements. |
| `tests/record-releases/api-attachments.test.ts`, `prescription.test.ts`, and fixture files | Protect schema9 exact source/selection relationships, outside history meanings, original byte binding, delivery limits and mixed-package rendering. Preserve old fixtures instead of changing their schema versions in place. |

## Explicit selection model

Adopt **`native_prescription_ids`** and **`native_dispense_ids`**, each at most20 IDs per package. Existing family limits remain unchanged. The database must enforce the proposed **1 MiB complete snapshot limit**; do not estimate acceptance from displayed rows or HTML length. Final exact byte-counting definition belongs to the database contract.

| Family | Visible label | Unit selected and disclosure |
|---|---|---|
| `native_prescription_ids` | Signed practice prescriptions | One immutable native authorization. Include signed instructions and schema-defined status/usage evidence. A prescription is not proof of dispensing, handoff, pharmacy receipt or medication administration. |
| `native_dispense_ids` | Recorded practice dispensing | One actual immutable dispense, including partial quantity and frozen lot details. A dispense-only selection is valid: include its full signed prescription artifact and deterministic captured status/usage as required context. This does **not** silently add its authorization to `native_prescription_ids`. |
| Existing `imported_prescription_ids` | Clinician-reviewed outside prescriptions | Preserve the historical-only, complete/partial-source disclosure. Never merge into the native family or imply a native authorization. |
| Existing `treatment_ids` | Medication and vaccine history | Retain established treatment/administration meaning; native dispensing must not be synthesized as a treatment. |

Both native sections appear near the existing outside-prescription section. Drafts, refill requests and operational notes are not selectable native prescribing records. No raw review contexts, staff configuration notes, invoice internals, stock adjustment records or communication contents enter the release merely because a prescription/dispense was selected.

If a dispense's parent is also explicitly selected, list that selection once and preserve the exact required parent context for the dispense. The renderer may avoid repeating identical prose only under the shared rendering contract; it must not omit independent IDs, selection counts or provenance. Do not group both families under one checkbox that changes the other's explicit selection.

“All eligible records” includes both native families only through the server's complete bounded result. If either native family exceeds20 or the complete package exceeds the snapshot bound, retain the prior selection and ask staff to choose a smaller package. Never silently take the newest20. “Select all shown” means this page only and follows the same atomic merge limit. Required parent context does not consume a hidden extra checkbox or change a selected-family count.

## Discovery and review display

Discovery uses the exact common projection `{id,version:1,recorded_at,label,source_label}`. Native `label` contains signed medication name and identifying date; `source_label` must distinguish `Living Room Vet · Signed prescription` from `Living Room Vet · Recorded dispense`. Validate these fields and immutable IDs. Do not invent optional live status/usage fields in discovery. Explain beside both lists that current status and complete selected evidence will be checked in preview. Display the immutable record's date in America/Denver and stable reference as secondary text; version1 is a projection version, not a mutable prescription revision.

The exact preview projection contains:

- A selected prescription's full signed artifact, deterministic status (latest terminal head/time/reason/successor reference) and verified aggregate V2 usage. It does not include every dispense or closure.
- A selected dispense's frozen public artifact with **invoice_id omitted**, its embedded full prescription/status/usage, and nullable pickup `{id,picked_up_at,recipient_name,actor_id}`. Omit recipient relationship, internal reasons and financial references. A nullable pickup means no acknowledgment is present in this capture.
- Forfeiture appears in aggregate usage/head, not as automatically included full closure history. Replacement's successor ID is a reference, not an implicitly selected replacement artifact.
- The original full saved dispense `artifact_hash` identifies the server-verified source; it is not the hash of the public projection. The complete release source hash binds the public projection. Do not pass the invoice-free projection into the full dispensing-label validator.

- Cancellation/replacement/expiry is a visible historical warning, not a reason to omit an otherwise eligible medical record. “Historical record — cancelled” must not be rendered as current permission to dispense. If the server excludes any record, its exclusion semantics must be explicit in select-all results.
- Native remaining quantity is mathematical ledger allowance at the captured observation, not current clinical permission. External pharmacy allowance remains **unknown** even when native ledger activity is zero. Never show zero as a substitute for unknown.
- Distinguish “no pickup acknowledgment recorded in this capture” from “not collected.” Never equate dispensing with administration. A partial dispense is a complete event of the stated quantity; do not label it “partial source history,” which is an existing imported-record concept.
- Preview states the package contains explicitly selected records plus their required signed context. It is not a complete medication reconciliation or an exhaustive patient-history export.

The shared schema10 renderer, not a browser-only template, must display the exact signed directions, authorization identity/hash, selected dispense quantity and frozen lots, and all required schema-defined warnings. Client-visible text must not include raw RPC names, operational context dumps or database/billing IDs unless an intentional clinical record reference is required.

## UI wiring and exact compatibility

1. Add both family keys/labels and centralize their20-item bounds in selection helpers, page selection, all-source validation, explanatory copy and tests. Keep inherited source dependency checks unchanged; embedded native signed context is not a `document_ids` dependency.
2. Add `list_record_release_sources_v10`, `select_all_record_release_sources_v10`, `preview_record_release_v10` and `policy_v10_accepted` exactly as specified in the database contract. Validate both new arrays and their `has_more` flags, bounds, required fields and cross-patient identity. A missing native array is a malformed response, not an empty family. Reject unknown snapshot versions rather than accepting `>=10`.
3. New previews require schema10, including native-only selections and mixed selections. Current read/history/render paths remain a strict union of schemas1–10. Saved schema1–9 artifacts and their selection/hash/recipient are not rewritten or upgraded. Existing9 policy acceptance does not imply10 acceptance; historical9 remains governed by its own saved version's policy.
4. Show: “Preview is available. Confirmation requires the practice's recorded acceptance of the version10 release form, including signed practice prescriptions and recorded dispensing.” No UI auto-acceptance, prechecked clinical attestation or provider activation. The practice's clinical reviewer remains Dr. Susan Edler.
5. Freeze the exact preview selection, recipient, complete snapshot and hash with one confirmation UUID. A dropped reply retains these values, blocks competing selections and retries/reconciles the original intent. New native content does not authorize sending: confirmed packages still enter the separate reviewed email/SMS-link flows.
6. The complete preview is rendered and reviewed before confirmation. Selection/recipient/native-evidence changes clear attestation and require a new preview. Server snapshot/hash checks remain authoritative for concurrent sign/cancel/replace/dispense/forfeit/pickup changes. Browser refreshing must never silently replace a pending reviewed snapshot.
7. Key candidate queries/workspace state by actor and patient, suppress late replies after either changes, and suppress background refetch while a release review or uncertain confirmation is held. Keep the existing combined patient/unload guards. Audit the existing confirm path's clearing of pending state on a later `40001/23514/42501` after an uncertain response: a later rejection is not proof the original operation never committed. Preserve identity until exact recovery resolves it.
8. Extend `refreshPatientReleases` for the v10 query key. Call it after confirmed/recovered native sign/cancel/replace/dispense/forfeit/pickup, never during a read. Refresh clean discovery; if a draft/review is held, disclose stale candidate evidence without dropping selected IDs or resetting its UUID. The exact server source registry must invalidate package eligibility when included native evidence changes.
9. Confirmed export, email capture and document-link preparation must fresh-read saved package eligibility through existing authorized paths. Captured clinical content stays immutable; current invalidation status is displayed outside it. Do not replace old captured prescription status with a live catalog/ledger lookup inside deterministic rendering.

## Acceptance cases

### Browser and shared validation

- Native prescription only, native dispense only with required embedded parent, and explicit parent+dispense selections; unsigned drafts and unselected sibling dispenses absent.
- Mixed schema10 with inherited SOAP, labs/original files, outside prescription history and API originals. Old schema1–9 fixtures still render/read; new selection never downgrades to9 on malformed10.
- Cancelled/replaced/expired prescriptions visible as historical evidence; active status cannot be inferred from existence of a signature. Partial fills, multi-lot details and native forfeiture quantities rendered with the contract's exact semantics; external remaining allowance remains unknown.
- Rows on multiple source pages retain explicit checkboxes. Twenty selections succeed;21st individual/page/all-source addition preserves prior IDs and explains the limit. Snapshot bound rejects without truncation. Separate native families count independently; embedded parent context does not fabricate a selected parent.
- Missing/malformed native fields, wrong patient/authorization/dispense binding, wrong captured hash, duplicate rows, absent `has_more` and forged parent context fail locally and cannot enable confirmation.
- Policy9-only operator may preview10 but cannot confirm it. Explicit accepted10 allows confirmation after manual review. Opening an older9 package does not demand silent conversion.
- Concurrent cancellation, replacement, partial dispense, forfeiture or pickup after preview rejects stale confirmation and retains explicit selections for re-review. Dropped confirmation response recovers/retries the exact UUID/payload; actor/patient change cannot expose old preview or accept late results.
- Native workspace mutation refreshes idle release discovery; an open release review remains visibly stale and protected. Window focus, source pagination, route navigation and sign-out cannot unmount an uncertain request without the established guard.
- Confirming a package does not create email/SMS/outbox/provider delivery by itself. Both email and SMS-link capture retain native snapshot bindings and inherited original-byte verification; revoked/ineligible packages cannot gain new delivery grants.

### Actual local cross-layer acceptance

Use synthetic staff/DVM/client/patient/native order plus actual partial dispense and pickup in an explicitly owned disposable runtime. Through the browser select each family, review the schema10 artifact, confirm and reopen. Verify stored selection, snapshot/hash, exact parent and dispense references, release source registry entries, and absence of financial/stock/delivery side effects. Mutate included native evidence through the real authorized RPC, then prove stale preview rejection and existing-package eligibility disclosure without changing its stored hash. Exercise policy9 versus10, historical9 reads, and mixed-original byte tampering through both email and document-link artifact assembly. No production clinical acceptance is inferred from these tests.

## Resolved database alignment and remaining verification

The database contract settles separate20-item families (up to40 explicit native records), native-only composition, minimal candidate shapes, full signed required context, terminal event/status fields, aggregate forfeiture, restricted pickup projection and private financial-field exclusion. No `checked_at`, render timestamp or literal current date enters the snapshot hash; a real expiry-state transition still changes current comparison. Native source dependencies are authorization terminal events, fulfillment head changes and pickup changes for an explicitly selected dispense.

Implementation must still prove the inherited canonical1MiB limit and mixed-original bytes, exact policy10 acceptance/read dispatch, no discovery advisory-lock accumulation, full old-schema regression coverage and the actual local browser lifecycle. These are acceptance gates, not recommendations to weaken validation or resume ezyVet integration work.
