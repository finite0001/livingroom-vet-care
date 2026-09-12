# Phase 2 — clients, patients and clinical records

Priority: P0 for housecalls. Status: planned. Depends on: phase 1. Context: [architecture](architecture.md).

## Requirements and design

Support households with multiple pets, multiple contacts and distinct mailing/housecall addresses. Add a patient workspace linked from the current client page. Clinical authoring is encounter-based; longitudinal diagnoses and serious alerts remain visible across encounters. Imported outside records retain their source and original identity.

## Implementation checklist

1. [ ] Extend client and pet schema with addresses, color, sex/neuter status, approximate/unknown birthdate, deceased/archive states, weight measurements and ownership/contact relationships. Keep microchip as text, preserving leading zeros.
2. [ ] Build client and patient creation/edit/search, validation and explicit duplicate/merge review. Do not merge solely on name or email. Show all requested pet fields and derived age.
3. [ ] Build encounter list and SOAP editor with autosave status, optimistic concurrency/version conflicts, author, visit location/type and signed/addendum states. Prevent silent overwrite between staff.
4. [ ] Add dated historical diagnoses/problems with active/resolved status. Create high-importance alerts for reactions/allergies, using semantic red, icon and explicit wording on patient header, booking, medication/vaccine workflows and relevant export.
5. [ ] Add private patient/encounter-linked documents and lab PDF uploads with category/date/source. Separate client-visible clinical records from internal operational notes. Preserve original uploads and versioned interpretations.
6. [ ] Add basic QOL form early if end-of-life housecalls are offered; the richer longitudinal UI remains in phase 5. Capture patient-associated consents for services actually offered.

## File work

- Modify `/Users/davidedler/livingroom-vet-care/src/hub/pages/ClientProfilePage.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/components/clients/CreateClientSheet.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-clients.ts`, `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-client-files.ts` and `/Users/davidedler/livingroom-vet-care/src/App.tsx`.
- Create feature modules under `/Users/davidedler/livingroom-vet-care/src/hub/features/patients/` and `/Users/davidedler/livingroom-vet-care/src/hub/features/clinical/`, including patient page, SOAP editor, problem list and alert components.
- Add migrations and generated types; add tests under `/Users/davidedler/livingroom-vet-care/e2e/clinical.spec.ts` and database policy tests under `/Users/davidedler/livingroom-vet-care/supabase/tests/`.
- No planned deletions.

## Acceptance and risks

Create two patients in one household, save/reload every requested field, record weight in different units, sign SOAP, add a correction and reopen history. Important reaction remains visible with keyboard/screen-reader support and on mobile. A second staff edit cannot overwrite newer content unnoticed. A document from a different practice/patient cannot be attached to the current encounter. Archiving preserves history. Veterinarian accepts note structure and alerts before pilot.

Next: vaccination/inventory domain and patient-linked communications. Offline clinical sync is not assumed; if mandatory for housecalls, rescope before October commitment.
