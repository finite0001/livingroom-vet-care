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

`PT409` indicates a stale record; preserve local form data and explicitly reload the current version. `23514` indicates invalid clinical metadata, transition or mismatched retry. `42501` indicates inactive/nonstaff/anonymous access. Draft JSON contains no calculated clinical interpretation.

## HHHHHMM quality-of-life scale (migration `20260928130000_qol_hhhhhmm_scale.sql`)

Requested by Dr. Susan Edler as a structured companion to the free-text template above, which remains unchanged. Named UI export: `QolScaleCard({ petId })`, mounted inside `PatientCareCharts` so its editors report into the same dirty-state guard.

**Source.** The HHHHHMM Quality of Life Scale was developed by Dr. Alice Villalobos: Villalobos AE, Kaplan L. *Canine and Feline Geriatric Oncology: Honoring the Human-Animal Bond*. Ames, IA: Blackwell Publishing; 2007 (scale first published by Villalobos in 2004 and later revised). The seven categories are Hurt, Hunger, Hydration, Hygiene, Happiness, Mobility and More good days than bad, each scored 0–10 (total 0–70). This implementation reproduces only the category names and score ranges; it does not reproduce the published scoring guidance or interpretation. Dr. Edler should confirm the citation and any licensing/attribution expectations before practice use.

**No clinical interpretation.** The software sums scores; it does not classify a total, suggest a prognosis, or make any end-of-life or treatment recommendation. The published "acceptable" cut-off is deliberately **not** displayed. An optional practice reference line exists only as an administrator setting (`qol_scale_reference_settings`), which ships **disabled with no total and no wording**. When an administrator enables it (a total 0–70, wording and a review note are all required), the trend shows a dashed line and a notice that it is a configured setting, pending Dr. Susan Edler's clinical review, and not a recommendation for the patient. It is never applied as a per-assessment label. Chart gridlines are neutral decades (0, 10, …, 70). Tracked as `C-PILOT-09` in `docs/clinical-staff-acceptance-register.json`.

**Workflow.** A new assessment records date/time (America/Denver), assessor, a score and optional note (≤2000 chars) per category, and overall notes. Drafts may be partial; the total is `null` ("not available until all 7 categories are scored") until every category has a score. Signing requires all seven scores, freezes that version and stamps the signer from the session; corrections are appended addenda. Signed assessments reopen read-only. Drafts use optimistic revisions and client UUID retry keys exactly like the free-text QOL records (`useCareMutation`).

**Trend.** The card charts totals (0–70) or any single category (0–10) for up to the 100 most recent **signed, fully scored** assessments in chronological order, reports the change since the previous signed assessment, and lists a per-category history table. Drafts are excluded from the trend. Pure helpers live in `src/hub/features/care-charts/qol-scale.ts`.

### Database contract

- `patient_qol_scale_assessments`: seven `smallint` categories with `CHECK (0–10)`, generated stored `total` (sum; null while any category is null), `qol_scale_signed_requires_all_categories` CHECK, `scale_version='hhhhhmm-villalobos'`. The `qol_scale_guard` trigger requires active staff, stamps authorship/versions, rejects deletes, and rejects any update of a signed row (`23514`).
- `patient_qol_scale_addenda`: append-only; signed assessments only.
- `qol_scale_reference_settings`: single row (fixed UUID); ADMIN-only via RPC; revision-stamped and audited.
- Authenticated/service users have SELECT only (active-staff RLS); all writes use security-definer RPCs; all three tables are audited by `audit_trigger_fn`.

RPCs (errors: `PT409` stale version, `23514` invalid data/transition/replay mismatch, `42501` inactive/nonstaff/non-admin):

- `save_patient_qol_scale(p_id, p_pet_id, p_expected_version, p_assessed_at, p_assessor, p_hurt, p_hunger, p_hydration, p_hygiene, p_happiness, p_mobility, p_more_good_days, p_hurt_note, p_hunger_note, p_hydration_note, p_hygiene_note, p_happiness_note, p_mobility_note, p_more_good_days_note, p_notes)` — scores are integers 0–10 or null (draft); notes are text (empty string when blank).
- `sign_patient_qol_scale(p_id, p_expected_version)` — idempotent for the same signer.
- `add_patient_qol_scale_addendum(p_id, p_assessment_id, p_content)` — idempotent by ID.
- `save_qol_scale_reference(p_expected_version, p_enabled, p_reference_total, p_reference_label, p_review_note)` — ADMIN only.

Tests: `supabase/tests/qol_scale.test.sql` (pgTAP: ranges, required categories at signing, immutability, addenda, reference setting permissions, RLS, audit), `tests/care-charts/qol-scale.test.ts` (totals, trend ordering, chart geometry, reference gating, no hardcoded thresholds), `e2e/qol-scale.spec.ts` (live total, partial-draft sign block, sign → read-only, trend/series switch, addendum, reference line only when configured).
