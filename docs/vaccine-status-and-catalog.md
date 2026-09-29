# Vaccine status summary, vaccine catalog metadata and rabies serial numbers

Added 2026-09-28 (branch `feat/vaccine-status-and-catalog`). Requested by Dr. Susan Edler: vaccine due dates (upcoming, last administered) visible per pet, and vaccine inventory carrying vaccine information. **No clinical values are seeded or hard-coded.** Every clinical default below is either blank until a reviewer enters it or is a display-only placeholder pending clinical review (register rows `C-VACCINE-01` and `C-VACCINE-02` in `docs/clinical-staff-acceptance-register.json`).

Migrations (slot 20260928120000–20260928129999):

- `20260928120000_vaccine_catalog_profiles_and_status.sql` — `catalog_vaccine_profiles`, `save_catalog_vaccine_profile`, `patient_vaccine_status_summary`, and a validation constraint for the `vaccine_due_soon_days` app setting.
- `20260928121000_rabies_certificate_serial_number.sql` — serial-aware `preview_vaccine_certificate` wrapper (see [vaccine-certificates.md](vaccine-certificates.md)).

## 1. Patient vaccine status summary

`PatientVaccineStatus` (`src/hub/features/vaccines/PatientVaccineStatus.tsx`) sits at the top of the patient page, directly under the important-alerts and allergy banners. It shows one row per vaccine group: last given date and source, next due date and source, days remaining/overdue, and a state chip — **Overdue**, **Due soon**, **Current**, **No due date** — using the shared tone grammar (`status-chip` + `statusToneClass`). Rows are ordered most urgent first. It is read-only; the full history, due-plan editor, outside-history review and certificates remain in their existing panels further down.

Data comes from one security-definer RPC, `patient_vaccine_status_summary(p_pet_id uuid) → jsonb` (active staff only; `anon` has no grant). It unifies:

| Source | Included when | `source` label |
| --- | --- | --- |
| `patient_treatments` (`kind='vaccine'`, not historical) | not corrected (`patient_treatment_corrections`) | `practice_administration` |
| `patient_treatments` historical entries | not corrected | `historical_record` |
| `ezyvet_imported_vaccinations` | latest reviewed version only, reviewed status `administered` with a reviewed date | `outside_record` |
| `patient_vaccine_due_plans` | status `current` or `proposed` (retired omitted) | `reviewed_due_plan` / `due_plan_anchor` |

### Grouping

A record joins **every active reviewed `vaccine_due_templates` group that lists its product** (so a combination product counts toward each of its groups). If no active template lists the product, the product's catalog profile `group_key` is used. Otherwise the row is grouped per product (`product:<id>`), or per recorded name for product-less historical entries (`record:<name>`). Group names come from the reviewed plan snapshot, then the template, then the profile key/product name. Due plans with no matching records still produce a row (anchored on the plan).

### Which date wins

1. A **current reviewed patient due plan** supplies the next due date (`reviewed_due_plan`). If an administration newer than the plan's anchor exists, the row is flagged `administration_after_plan_anchor` (“review the due plan”); the plan date is still shown because only a reviewer changes it.
2. Otherwise, the **latest uncorrected administration** in the group supplies its recorded next due date, labelled with its source. Ties on the same day prefer practice administration, then historical entry, then outside record. If that latest record has no next due date, the row shows **No due date** — an older record's date is not resurrected.
3. A **proposed** plan never supplies a date; the row is flagged `plan_awaiting_review` and falls back to rule 2.

Last given = the newest administration date; if a plan's anchor is newer than every record, the plan anchor is shown (`due_plan_anchor`). `as_of` is the America/Denver date when the summary was computed; the client computes states against it, not the browser clock.

### Due-soon window (display policy, pending clinical review)

“Due soon” = due today through `as_of + window` days; the day after the due date is overdue. The window is **not** a clinical rule and does not change any due date or reminder. Administrators set it in **Settings → Vaccine status display** (`app_settings.vaccine_due_soon_days`, whole days 1–365, enforced by the `app_settings_vaccine_due_soon_days_check` constraint). Until a value is saved, the UI uses a **30-day display default, labelled on screen as pending clinical review** (`DEFAULT_DUE_SOON_DAYS` in `src/hub/features/vaccines/vaccine-status.ts`). Nothing is seeded.

## 2. Vaccine catalog metadata

`catalog_vaccine_profiles` (one optional row per `kind='vaccine'` catalog product; audit-logged; RLS: active staff read; no direct writes; rows cannot be deleted or moved to another product):

| Field | Meaning |
| --- | --- |
| `group_key` | Optional group key (same format as due-plan template keys). Used for grouping only when no active template lists the product. |
| `species` | Labeled species, lowercase, deduplicated, up to 10. Informational. |
| `vaccine_type` | Label formulation/type text. |
| `labeled_duration` | `1 year`, `3 years`, or `other licensed duration` — same vocabulary as the rabies certificate's USDA duration. Informational; never calculates a due date. |
| `default_booster_interval_days` | Optional whole days (1–36500). Used **only** to offer a pre-fill. |
| `review_note` | Required label source / reviewer. |

`save_catalog_vaccine_profile(p_product_id, p_expected_version, p_group_key, p_species, p_vaccine_type, p_labeled_duration, p_default_booster_interval_days, p_review_note)` requires an active **DVM or ADMIN**. Optimistic concurrency via `version`; a lost-response retry by the same reviewer with identical values returns the saved row; any other stale write fails with `PT409`.

UI: **Inventory → Product catalog → Edit** on a vaccine product shows a “Vaccine information” form (read-only for other staff). The catalog list shows a one-line summary for vaccine products.

### Pre-fill, never auto-decide

When recording a live vaccine administration (`PatientTreatments`), if the selected lot's product has a default booster interval, the form shows the interval (marked as a catalog value pending clinical review) and a **“Pre-fill next due date: YYYY-MM-DD”** button (administration date + interval). Nothing is filled until the clinician presses it; the filled date stays editable and is labelled as pre-filled until changed. Historical entries get no pre-fill. The clinician-entered `next_due_on` remains the only value saved.

## 3. Rabies certificate serial number

See [vaccine-certificates.md](vaccine-certificates.md#lot-versus-serial-on-printed-certificates). The rabies form has a separate “Vaccine serial number” field; certificates print Lot number and Vaccine serial number separately. Earlier issued snapshots keep “Lot / serial number”.

## Tests

- SQL (pgTAP): `supabase/tests/vaccine_status_and_catalog.test.sql` (63 assertions: no seeding, authority, validation/normalization, idempotency/conflict, precedence, combination products, corrections, proposed/current/retired plans, outside records incl. superseded/not-administered/undated, other-patient isolation, anon/non-staff denial, setting constraint) and `supabase/tests/rabies_certificate_serial.test.sql` (16 assertions). Existing `vaccine_certificates` and `certificate_due_plans` tests still pass.
- Unit: `tests/vaccines/vaccine-status.test.ts` (state boundaries, calendar arithmetic, window parsing, sorting, parsing guards, pre-fill, profile validation, SQL/TS vocabulary contract).
- Renderer golden snapshots: `tests/certificates/serial-snapshot.test.ts` + `tests/certificates/snapshots/*.html`.

## Owner / clinical actions

- Dr. Edler: review `C-VACCINE-01` (precedence, labels, due-soon window — set a practice value in Settings or accept the 30-day display default) and `C-VACCINE-02` (enter or approve per-product vaccine metadata; confirm pre-fill behaviour and serial wording).
- Apply both migrations to the hosted project through the normal reviewed deployment path, then regenerate `src/integrations/supabase/types.ts` (the feature uses a local typed client until then).
