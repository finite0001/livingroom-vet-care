# Source contracts and local architectural findings

Reviewed 2026-09-13 against the public [ezyVet API documentation](https://developers.ezyvet.com/), downloaded directly because the web reader exceeded its response-size limit. No account or clinical data was accessed. Public pages must be rechecked when implementing each resource and compared with authorized practice samples before commissioning.

## Documented source facts

| Resource | Public contract | Mapping implication |
| --- | --- | --- |
| [Consult](https://developers.ezyvet.com/#get-consult) | GET `/v1/consult`, `read-consult`, `animal_id` filter and relationship | Patient association can be checked explicitly. A description or presenting-problem reference is not a signed SOAP note. |
| [History](https://developers.ezyvet.com/#get-history) | GET `/v1/history`, `read-history`, at most10 items; animal/consult references, comments, history_system, chain, timestamp and vet reference | Preserve category/date/author references without assuming undocumented SOAP mappings or signatures. |
| [Vaccination](https://developers.ezyvet.com/#get-vaccination) | Consult/product references and administration/next-administration dates; no direct patient field in the illustrated response | Resolve the consult's patient. Lot/manufacturer cannot be invented. |
| [Prescription](https://developers.ezyvet.com/#get-prescription) and [items](https://developers.ezyvet.com/#get-prescriptionitem) | Patient/consult/prescriber references; item product, quantity, remaining, instructions and start date | Historical source authorization is distinct from a new local prescription. |
| [Attachment](https://developers.ezyvet.com/#get-attachment) | Parent record type/ID, MIME, name and download reference | A returned URL alone does not authorize arbitrary host access. Verify the supported download contract. |

## Repository findings

- `supabase/functions/ezyvet-import/adapter.ts` has resource-specific contracts for animal, healthstatus, consult and history. Consult/history use limit10 and enforce patient-scoped ingestion; vaccination now uses its dedicated consult-scoped contract and application cap of 10.
- `handler.ts` accepts `animal_link_id` for healthstatus and consult/history. Migration2300 protects weight imports and migration4900 supplies patient-scoped clinical runs. Migration5200 adds the distinct vaccination consult-bound context; do not send an animal_id filter to an endpoint whose documented parent is consult_id.
- Generic snapshots and `ezyvet_identity_heads` deduplicate by source host/site/resource/ID and payload hash. Source reversion can reuse a snapshot while advancing its head version. Approval must compare both snapshot hash and observed head version.
- `src/hub/features/clinical/PatientProblems.tsx` uses native create/edit without durable import preparation. The new import needs stable operation IDs, immutable approvals and independent provenance rather than retrying ordinary null-ID creation.
- `ClinicalWorkspace.tsx` signs with the current local actor/time. Imported narratives require their own attributed representation.
- `PatientTreatments.tsx` has historical treatment entry that avoids stock/billing. It requires reviewed clinical fields and lacks an API-source association. It is not a safe generic destination for incomplete vaccine or prescription JSON.
- `src/hub/pages/RefillsPage.tsx` and `src/hub/hooks/use-refills.ts` represent refill work, not an imported-prescription authorization ledger.
- Existing weight request preparation, explicit abandonment, source review and exact approval recovery provide useful local precedents. Weight recovery after browser-pointer loss still needs database assistance; implement the new workflow's required server discovery explicitly rather than claiming that capability already exists. Existing schema5 source releases provide immutable rendering and source-change invalidation patterns.

## Alternatives

A manual-original-to-problem transcription shortcut is implementable, but alone leaves the requested API migration gap. Automatic classification of history text would introduce unverified clinical interpretations. Use patient-scoped API history with immutable outside attribution, followed by explicit local review. Retain the manual-original workflow as a separate supported source, without claiming it completes API migration.

## Vaccination contract refresh — September 13, 2026

The official documentation specifies GET `/v1/vaccination`, scope `read-vaccination`, and `consult_id` filtering. Its documented default page size is 10; the importer deliberately caps each request and accepted page at 10. This application cap is not a claim that the provider documents a maximum of 10.

Preserved source fields include `id`, `consult_id`, `product_id`, `active`, `created_at`, `modified_at`, `vet_id`, `qty`, `description`, `notes`, `date_of_administration` and `date_of_next_administration`. The documented examples contain string IDs; validation accepts canonical numeric strings and safe integers. Quantity represents product units without an inferred dose unit. Date interpretation, product mapping and local clinical adoption remain later review work. No practice vaccination sample was used in this contract verification.
