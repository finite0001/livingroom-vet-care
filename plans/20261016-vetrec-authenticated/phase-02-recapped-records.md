# Phase 2: reviewed, source-cited records recap

Priority: after Phase 1 contracts. Status: planned. Vendor evidence VR-A06 is form-only; no claim of verified vendor OCR or citations. Native design below is independent.

## Outcome and architecture

Patient Medical → Recap → select authorized records and date range → freeze exact source versions → generate chronological history and unresolved issues → review cited claims. Historical medication/vaccine entries remain historical, never become new orders or administrations. Subsequent notes may explicitly use a reviewed recap snapshot as labeled background; no automatic context bleed.

Start with readable native clinical sources. Reuse source-ID/version/hash patterns from `src/hub/features/record-releases/selection.ts`, but **not** its client-shareability gate or publication side effects. Internal clinical access and authority to send records are different. Add uploaded PDF/image extraction as a separately accepted increment; existing diagnostic-renderer `pdftotext` self-validation is not general document ingestion/OCR.

## Implementation steps and affected files

1. Create `src/hub/features/clinical/recap/{model,api,PatientRecap}.ts[x]` with bounded source selection, dates, missing/unreadable source reporting and source-linked review UI.
2. Create private snapshot/job/claim/review persistence in `supabase/migrations/<new>_clinical_record_recaps.sql`. Each source has patient, source kind, immutable version/hash, date and allowed reader. Revalidate authority/current source availability before viewing/accepting. Keep raw AI output and reviewer edits distinct.
3. Add `supabase/functions/_shared/clinical-recap-{model,handler}.ts` plus a narrowly scoped Edge entrypoint. Reuse durable claim/lease/idempotency patterns instead of adding a second generic queue platform. Treat source text as data, never instructions.
4. Produce dated claim lists, active versus historical problems, source-bound medication/vaccine history and explicit contradictions. Every supported claim cites source/version and excerpt; page/offset when available. No new diagnosis or recommendation from the model. Deleted, stale or unavailable sources are visible, not silently omitted.
5. Add explicit reviewed recap context selection to generation manifests. A frozen recap does not follow future edits automatically. A source correction marks affected recaps stale; regeneration preserves older reviews.
6. For uploaded records, separately implement private immutable originals, MIME/signature/size/page limits, isolated extraction/OCR with no credentials/network, per-page provenance, unreadable/handwriting warnings and review. ZIP/Office/Excel support is not required merely because the vendor form lists it; add only with safe parsing and a concrete practice need. No arbitrary URL fetch.

## Success criteria

- Wrong-patient or unauthorized sources rejected; mixed-household records cannot enter another patient's recap through free text or filenames.
- Every claim opens its exact allowed source/version. An old lab result is not represented as today's status. Contradictory doses/diagnoses remain unresolved; unknown vaccination date stays unknown.
- Source changes between select/generate/review are detected; concurrent reviews/lost responses preserve one intended outcome.
- Synthetic prompt-injection documents cannot change instructions, reveal unrelated records or trigger tools. Oversized/unreadable sources fail visibly; partial extraction cannot be presented as a complete review.
- Bounded synchronous reads and paginated source lists; durable generation for larger inputs; no PHI in operational logs.
- Native-source fixture, hostile document fixture, source removal/version conflict, local Auth/browser recovery tests and populated restore where schema changes require it.

## Checklist / dependencies

- [ ] Implement readable-native-source recap first.
- [ ] Review source authority and exact-version behavior.
- [ ] Add synthetic generation/review/contradiction tests.
- [ ] Implement and separately validate uploaded-record extraction before claiming scanned-record support.
- [ ] Required CI, staging and specific PR release approval.

Unresolved: approved document types and authorized sample files, OCR provider/runtime choice and clinical review of recap presentation. No real upload performed during investigation.
