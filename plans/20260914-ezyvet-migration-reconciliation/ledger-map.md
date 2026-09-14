# Existing ledger contracts

Read-only code review at `b585f47`. No hosted query or provider sample claim. Paths below are relative to the repository root.

| Resource | Canonical evidence | Reconciliation rule |
| --- | --- | --- |
| Contact/animal | `20260913010000_ezyvet_import.sql`: shared runs/pages/items/snapshots/reviews. `20260913040000_ezyvet_review_import.sql`: identity heads and record links. | Generic `proposed_match` is not create/link approval. Use exact `ezyvet_record_links` receipt and source identity. Shared scans need filtering to declared identities. |
| Weight/healthstatus | `20260913230000_reviewed_weight_import.sql`: weight runs, prepared requests, approvals, source reviews. | Approvals bind snapshot/head, animal mapping, patient version and native weight ID; a discrepancy acknowledgment is separate from approval. |
| Consult/history | `20260913490000_ezyvet_clinical_runs.sql`: scoped run/page/observation. `20260913500000_reviewed_imported_history.sql`: history requests/versions, problem extractions/source links/discrepancy reviews. | No separate approved-consult receipt. `legacy_unscoped` runs cannot satisfy patient-scoped clinical coverage. |
| Vaccination | `20260913520000_consult_scoped_vaccination_import.sql`: exact consult-bound run/page/observation. `20260913530000_reviewed_imported_vaccinations.sql`: review requests and versioned imported history. | Latest approval and current source/consult/mapping eligibility are independent; import never means local administration. |
| Prescription/header | `20260913550000_patient_scoped_prescription_import.sql`: patient-scoped header evidence. | Staging header does not mean approved prescribing history. |
| Prescription/items | `20260913560000_parent_scoped_prescription_items.sql`, `20260913570000_prescription_reference_reconciliation.sql`, `20260913580000_prescription_source_review_context.sql`, `20260913590000_prescription_review_preparation.sql`, `20260913610000_reviewed_imported_prescriptions.sql`. | Preserve expected/observed/duplicate/missing IDs and unresolved consult reference. Approved partial history remains partial and grants no local prescribing authority. |
| Attachment metadata | `20260913690000_attachment_metadata_runs.sql`: Animal parent context, run/page/ordinal observation, external/file IDs, raw/stable hashes. | Observed page count differs from distinct staged snapshots. Metadata alone is not captured or reviewed bytes. |
| Attachment original/review | `20260913700000_attachment_original_capture.sql`: request/attempt/failure/intent/capture. `20260914010000_reviewed_canonical_api_originals.sql` and `20260914020000_canonical_api_approval_cancellation.sql`: approval/correction/cancellation. | Ready capture is not clinical approval. Bind exact metadata observation, verified bytes and approval version; retain superseded/canceled history. |

## Cross-cutting invariants

- Shared `claim_ezyvet_import_core` owns source/site/resource serialization,90-second lease, cooldown and cursor. Do not introduce a competing scheduler or call several claims under a parent lock.
- Generic states are running/review_ready/page_limit_reached. A terminal page limit is incomplete. `fail_ezyvet_import_page` clears lease and overwrites latest error/cooldown; historical failure accounting needs new durable events.
- Snapshot deduplication is identity plus payload hash. Shared page-item keys can collapse duplicate same-snapshot occurrences within a page. Do not claim exact occurrence evidence where the legacy ledger never retained it.
- Observed head version is required as well as snapshot hash: A→B→A must be detected as source evolution.
- Terminal historical recovery may survive household/source changes; running continuation still requires current parent/mapping membership.
- Attachment order is operation/run → mapping/patient/Animal → shared attachment source gate → sorted heads. Original capture has its request lock before that chain. Parent membership must not invert this order.
- Owner transfer is not implicit. Active ADMIN is checked after waits, not only before. Parent binding does not transfer child ownership or reset an uncertain child request UUID.
- `EzyVetImportPage.tsx` aggregates child draft guards and actor keys; `EzyVetClinicalImports.tsx` demonstrates server read-before-resume and retained IDs when recovery is uncertain. Reuse those patterns.

Reviewed by two independent codebase explorers: one mapped ledger identities/count semantics; one reviewed owner, lock and recovery risks. Their findings informed the implementation contract; no additional agents or external scans are part of the production design.
