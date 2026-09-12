# Phase 5 — charting and external clinical integrations

Priority: external PIMS discovery starts in phase 1; charting P1, promoted to P0 where required by October services. Status: planned. Depends on: clinical identity and immutable record model.

## Implementation checklist

1. [ ] **Veterinary-software API:** preserve the requested ability to pull outside practice data. ezyVet is the candidate identified in the reference hub; confirm the actual vendor and credential entitlement. Complete [external PIMS integration](external-pims-integration.md), including resumable sync, mappings, source provenance and conflict review. Do not require every new Living Room patient to have an external ID.
2. [ ] **Dental:** species/dentition-specific chart, tooth/surface findings, missing/extracted teeth, procedure annotations and attachments. Keep visit snapshots plus comparison history; clinician validates chart notation.
3. [ ] **Anesthesia:** patient/encounter-linked form and upload first, with observations, drugs/events, recovery and signed record. In parallel obtain device/software sample output and API contract. Adapter preserves source IDs, timestamps, units, gaps and original files. Queue mismatches for staff confirmation; repeat imports must not duplicate observations. Automatic integration is only accepted after actual vendor sample/round-trip testing.
4. [ ] **QOL:** practice-approved instrument and scoring version, dated answers, clinician/owner authorship and trend view. Changing questionnaire does not retroactively change old results. Include printable summary. Scores support discussion; they do not trigger clinical decisions automatically.
5. [ ] **Body maps:** appropriate animal outlines, stable lesion IDs, normalized coordinates and anatomical view; dated measurements/photos/notes and resolved status. Reopen and add an observation without replacing the prior mass history. Offer keyboard-accessible lesion list alongside the drawing.
6. [ ] **Labs:** order/result distinction, PDF upload, pending/reviewed status and vet-reviewed client release. Build API import after vendor selection; match source IDs, preserve units/reference ranges and original report. Abnormal imported findings must not become unreviewed autonomous treatment advice.

## File work

- Create feature folders `/Users/davidedler/livingroom-vet-care/src/hub/features/dental/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/anesthesia/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/qol/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/body-maps/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/labs/` and `/Users/davidedler/livingroom-vet-care/src/hub/features/integrations/`.
- Create vendor adapters under `/Users/davidedler/livingroom-vet-care/supabase/functions/_shared/integrations/` and authenticated import entrypoints under `/Users/davidedler/livingroom-vet-care/supabase/functions/`.
- Add schema and generated types; extend patient tabs and export document selection. No planned deletions.

## Acceptance and risks

Reopen dental, QOL and body maps on a second visit and compare preserved history. Replay anesthesia/lab imports, including timezone/unit conversion, partial file and unknown patient cases. Staff can distinguish imported source records from locally authored signed notes. External credentials remain server-side and practice-scoped. Vendor access, available fields and proprietary formats may materially change effort; do not promise integrations based solely on the presence of an API menu in a repo.

Next: complete clinic launch rehearsal; advanced charting must precede clinical reliance on those services.
