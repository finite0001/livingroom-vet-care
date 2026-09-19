# Qualitative QOL observations and mass body maps

This module is a documentation workspace, not a validated quality-of-life instrument. Template `draft-2026-09-12` records appetite, drinking, mobility, comfort, social engagement, good/difficult days and clinician notes as free qualitative observations. It generates no score, prognosis, euthanasia recommendation or treatment advice. **Dr. Susan Edler must review the template and clinical workflow before production clinical use.** This code and synthetic tests do not constitute that review.

Named UI export: `PatientCareCharts({ petId, onDirtyChange? })`. The optional callback aggregates dirty QOL/lesion forms, addenda, corrections and unresolved requests for the patient page’s single shared navigation blocker. This component does not register a competing router blocker; root integration must connect the callback. Existing active-staff authentication applies. Authenticated table access is SELECT only; mutations use security-definer RPCs that stamp the authenticated author and audit every change. All observation timestamps are explicitly interpreted and displayed in America/Denver, rejecting skipped or repeated DST wall times.

QOL drafts use optimistic revisions. Signing freezes the saved version; later corrections append an addendum. Save/append operation IDs and payloads survive ambiguous responses within the current application session, with a browser unload warning while a request remains unresolved. A chart must be reopened from saved history before signing newly saved content; unsaved edits disable signature.

Mass/lesion maps are **species-neutral location schematics**, not anatomical illustrations or diagnoses. Each lesion has a stable patient-scoped ID and current reference location. Click placement, arrow-key movement and normalized numeric inputs are equivalent controls. Each save atomically updates the lesion revision and appends a dated observation containing frozen label, location, optional finite nonnegative millimeter measurements, notes and optional photo document reference. Earlier measurements and locations are never overwritten. Correcting an observation marks the retained original as entered in error, with a required reason. It does not silently reinterpret the latest map position; enter a new observation to revise that position.

A linked photo must be a ready JPEG/PNG document belonging to the same patient. View actions recheck patient/document status and request a short-lived private Storage URL. No public image URLs are stored. Corrections and signed QOL addenda preserve the original.

## RPC contract

- `save_patient_qol(p_id, p_pet_id, p_expected_version, p_observed_at, p_observer, p_appetite, p_drinking, p_mobility, p_comfort, p_social_engagement, p_good_days, p_notes)` returns the QOL row. Client UUID and null expected version create; updates require the observed revision. Exact successful replay returns the same row.
- `sign_patient_qol(p_id, p_expected_version)` returns the signed row. At least one qualitative domain/note must be nonblank.
- `add_patient_qol_addendum(p_id, p_qol_id, p_content)` appends an idempotent signed-record addendum.
- `record_lesion_observation(p_id, p_lesion_id, p_pet_id, p_expected_version, p_observed_at, p_label, p_body_view, p_x, p_y, p_length_mm, p_width_mm, p_depth_mm, p_notes, p_photo_document_id)` creates or reopens the lesion and appends the observation in one transaction. New lesion uses its own stable UUID and null expected revision; observation UUID is the retry key. Body view is dorsal/ventral/left/right; x/y are finite in [0,1]. Measurements are optional and may be zero, never negative or nonfinite.
- `correct_lesion_observation(p_id, p_observation_id, p_reason)` appends one reasoned correction per observation.

`40001` indicates a stale record; preserve local form data and explicitly reload the current version. `23514` indicates invalid clinical metadata, transition or mismatched retry. `42501` indicates inactive/nonstaff/anonymous access. Draft JSON contains no calculated clinical interpretation.
