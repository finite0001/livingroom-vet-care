# Native reviewed imaging register — implementation contract

This increment is manual linking, not an automatic PACS feed or a native diagnostic viewer.

## RPCs (all require active staff + live session + exact actor)

- `list_imaging_studies(p_actor_id uuid,p_pet_id uuid,p_after uuid default null)` → `{items: Detail[], next: uuid|null}`; ascending study UUID, 20 rows.
- `read_imaging_study(p_actor_id uuid,p_pet_id uuid,p_id uuid)` → Detail|null.
- `save_imaging_study(p_actor_id uuid,p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer|null,p_kind text,p_values jsonb|null,p_reason text)` → Detail.
- `recover_imaging_action` takes the same arguments as save → Detail|null; same actor and exact intent only. Return committed receipt, never repeat an uncertain write with a new UUID.
- `cancel_imaging_action` takes the same save arguments → `{cancelled:boolean,receipt:Detail|null}`. Before returning from an uncertain request to editing, durably cancel it. If the original already committed, this returns its receipt instead. Late original writes cannot execute after cancellation.
- `list_imaging_history(p_actor_id uuid,p_pet_id uuid,p_id uuid,p_before integer default null)` → `{items: Revision[],next: integer|null}`; descending version,20 rows.

`Detail = {study: Study, report_available: boolean|null}`. `Study = {id,pet_id,version,values,status,created_by,updated_by,created_at,updated_at}`. Status `recorded|void`. Values below. Revision `{study_id,pet_id,version,snapshot:Study,reason,actor_id,session_id,created_at}`.

Kinds `record|correct|void`. Record: expected null, values required, reason empty. Correct: expected positive version, full values required, nonempty reason ≤1000. Void: expected positive, values null, nonempty reason ≤1000. Void is terminal. Any source identity correction requires void and staff review of the original retained identity; no reassignment to another pet.

## Exact values (all keys required, no extras)

```
account_label: exact trimmed nonempty string ≤160
vendor_patient_id: exact trimmed nonempty string ≤160
external_study_id: exact trimmed nonempty string ≤160
accession: string ≤160
study_date: real YYYY-MM-DD calendar date
modality: DX|CR|US|CT|MR|IO|ES|OT
description: exact trimmed nonempty string ≤160
body_region: string ≤160
viewer_url: https://<lowercase alphanumeric/hyphen hostname>.vetrocket.net/view.html?link=<8–1800 alphanumeric,underscore,hyphen chars>
encounter_id: uuid|null
encounter_version: positive integer|null
document_id: uuid|null
document_version: positive integer|null
identity_verified: true
review_note: exact trimmed nonempty string ≤2000
```

Account, external study ID and vendor patient ID are immutable after first save. Unique `(account_label,external_study_id)` across all patients, including voided records; never pet-name matching. Vendor fixed VetRocket. Viewer URL is private and opened only on explicit action with `noopener noreferrer`; no iframe, prefetch, server fetch, outgoing release link or full-link logging. Strict URL shape intentionally supports only the observed share-link family until account contract is known. Expiry/authorization remain vendor controlled.

Optional encounter and PDF selected explicitly from current patient sources, exact versions. Save rejects changed/wrong-patient sources and non-PDF/non-ready/missing-object reports. Encounter association never alters SOAP. Current report availability is recomputed on reads; a voided/stale/missing PDF disables report opening, retaining original history. Existing document release selection handles independently shareable PDFs. No radiologist approval claim.

UI: lazy Medical → Imaging after labs; read/list/history, create, correction, void, recover uncertain action before editing/retry; identity confirmation + patient name. Use session actor, shadcn/semantic tokens, mobile-first. Preserve page dirty/navigation/sibling editor guards. Deceased/archived: readable history, no new study; corrections/void history still supported. Report upload uses existing Documents then select here. No new upload pipeline.
