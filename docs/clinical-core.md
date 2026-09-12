# Clinical core — implementation increment 2026-09-12

This increment adds household editing, a patient workspace, dated weights, clinical encounters and important historical problems. It is the first part of [phase 2](../plans/2026-09-12-practice-platform/phase-02-clinical-core.md), not the full clinical launch.

## Workflow

Open **Hub → Clients**, search by household name, email, phone or patient name, then open a household. Search runs on the server across all records; each result page is capped at 250 and the UI explains the cap. Add/edit the primary contact and separate mailing/housecall addresses. Creation offers duplicate review and an explicit separate-household action; it never merges records automatically.

Use **Add patient** or open an existing patient. Identity fields include name, species, breed, birthday with exact/estimated/unknown certainty, derived age, color, sex/neuter status and microchip as text. Existing birthdates are marked estimated until staff verifies their certainty. Patient forms warn about matching household names or microchips and never merge records. Patient ownership transfer is intentionally blocked; a later explicit ownership workflow must preserve the history.

Weights retain their measured date, original value/unit, actor and creation time. Kilogram/pound equivalents are display conversions. Legacy undated profile weight is shown only when there is no measured history; new history does not overwrite that legacy field. A mistaken measurement currently requires review outside this UI; a void/correction workflow remains open.

Add a problem with onset, notes, active/resolved state and routine/high importance. High-importance history stays above the patient workspace even when resolved. Existing free-text allergies also remain visible. These alerts will need propagation into future scheduling, vaccination, prescribing and export workflows.

Choose **New encounter**, record clinic or housecall location and Denver visit time, then enter SOAP. Saving is explicit, with unsaved/saving/saved/error status. Route/back navigation and tab closure warn about unsaved clinical text. A save includes the expected record version; a stale version preserves the local draft and requires review/reload. Server refresh never silently replaces that draft.

**Review and sign** confirms that the saved version will be locked and attributed to the signed-in account. Assessment and plan must both be nonempty. Signed text stays readable/copyable; later corrections are append-only addenda. Active staff can currently author/sign; validate role responsibilities and the note workflow with the practice veterinarian before a pilot. This is account attribution, not an assertion about legal signature compliance.

Archiving/deceased status retains all history and prevents new visits or weights. Existing draft corrections and signed-note addenda remain available. Client/patient deletion cannot cascade erase clinical records.

## Database and deployment

Migration: `20260912210000_clinical_core.sql`. Adds `patient_weights`, `patient_problems`, `clinical_encounters`, `clinical_addenda`, client/patient fields, audit triggers and RPCs. New clinical tables have active-staff SELECT policies with no browser DML grants. Authenticated RPCs verify active staff, stamp authorship, validate state and enforce versions. Signed/addendum immutability is also protected by triggers. Dates use `America/Denver` independently of session timezone.

**Deploy this migration to the application's actual backend before deploying the frontend.** The client list now calls `search_clients`, so it requires this migration too. The repository's tracked `.env` still names the original Lovable backend, which the connected Supabase account cannot access. This change does not switch it silently.

The dedicated project `mgadheotkdnrsatfivjy` now has all 16 migrations, including this one. The MCP receipt was reconciled to repository version `20260912210000` and name `clinical_core` after successful execution. Remote verification: 44 public tables with RLS enabled, zero Auth users/clients, no direct authenticated clinical UPDATE and no anonymous clinical-save execution. Outbound delivery configuration is unchanged and disabled. No patient data was imported, staff invited, or client messages sent.

Before Lovable rollout, either deploy the same migration through authorized access to the original backend after data review, or complete the documented [backend cutover](deployment-runbook.md). Vercel/DNS commissioning remains separate.

## Validation

- `npm run check`: 39 unit/handler tests, both TypeScript configurations, lint with no errors and production build pass.
- `npm run test:e2e`: 10 Chromium checks pass, including mobile two-patient creation, identity persistence, mixed-unit weight history, household duplicate review, client/SOAP conflicts, route blocking, signing and addenda. Browser fixtures use mocked APIs and no real clinical records.
- Fresh isolated local reset replays all 16 migrations. `supabase test db`: 52 clinical plus 19 staff pgTAP assertions pass, including actor spoofing, disabled-user/anonymous access, stale versions, immutable history, date boundaries and ownership protection. Tests roll back synthetic records.
- Screenshots reviewed for desktop/mobile; signed-note contrast and important-history text contrast improved using a semantic clinical alert token. Existing typography is deferred to the branding phase; no hook suppressions were added.

The existing Fast Refresh warning and large initial bundle warning remain. Dependency major-version findings from the foundation report are not resolved by this increment.

## Still open in phase 2

Multiple contacts/ownership history, controlled merge tooling, patient/encounter-linked documents and lab PDFs, client-visible versus internal record separation, QOL forms/consents, document/export alerts, veterinarian acceptance, and live hosted staff acceptance remain open. No autosave or offline synchronization is claimed.

Creation/addendum RPCs do not yet use durable idempotency keys. A lost response can leave an uncertain outcome; inspect saved records before retrying. No automatic retry worker or local storage of clinical drafts is introduced. Weight corrections and medication reconciliation are additional workflows, not implied by this schema.
