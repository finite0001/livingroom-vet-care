# Dental charting

## Scope and clinical review

The patient record supports explicit adult/permanent or deciduous dog/cat dentition, and manual notes for other species or nonstandard/mixed dentition. No teeth are premarked normal. Per-tooth observations, planned/performed procedure notes and optional labeled millimeter measurements are staff-entered. No diagnosis, periodontal score, treatment recommendation or clinical interpretation is generated.

**Dr. Susan Edler must review and approve the tooth layout, form wording, measurements, signing permissions and local dental workflow before clinical deployment.** The implementation is not an AVDC-approved chart or clinical endorsement.

Tooth identifiers were verified September 12, 2026 against the [AVDC Modified Triadan tooth-numbering table](https://avdc.org/PDF/Triadan_Tooth_Numbering_System.pdf) and [AVDC nomenclature](https://avdc.org/avdc-nomenclature/). Adult dog/cat layouts contain 42/30 positions; deciduous dog/cat layouts contain 28/26. Quadrants are labeled from the patient's perspective: maxillary right/left and mandibular right/left. Feline and deciduous numbering gaps remain deliberate; the UI does not shift labels to fill them. The selector is a labeled quadrant layout rather than an anatomical illustration. Unexpected/retained/supernumerary teeth can be described in manual notes until an expanded template is clinically approved.

## Staff workflow

1. Open a patient and choose **New dental chart**. Select dentition explicitly and enter the visit's Denver date/time. Standard layouts are limited to dog/canine and cat/feline species labels; other species receive the manual option.
2. Select a tooth and enter observations. Presence starts as **Not recorded**; **Present** does not imply healthy. Missing/extracted teeth retain their position and identifiers. Do not infer findings for unrecorded teeth.
3. Record optional measurements with a site/description and a finite positive millimeter value. Measurement labels carry the context; there is no automatic periodontal grading. Zero and negative values are rejected. Use narrative notes for observations that do not fit this optional positive measurement field.
4. Save, reopen and review. Draft version conflicts preserve local text and require explicit reload/discard before replacing a draft. Each saved version retains tooth state and narrative history.
5. Review and sign the saved chart. Signing is disabled while local changes are unsaved and locks the original. Later information is appended as an attributed addendum. No signed record is overwritten.

## Persistence and authorization

Migration `20260913070000_dental_chart.sql` adds chart, revision and addendum tables with active-staff read policies. Clients and the service role cannot directly mutate them. RPCs validate the signed-in actor, patient identity, active-patient draft status, dentition, valid tooth numbers and measurement shape. A saved chart's dentition is immutable; start another chart rather than converting identifiers in place.

Stable chart UUIDs and version/content checks make retries of completed saves idempotent. Repeated signing at the same prior version does not add another signature. Addenda use stable UUIDs and reject changed replay content. Every chart version records its actor; signed records record signer/time. Historical missing/extracted observations remain in version history even if a later correction changes the recorded presence.

Visit input uses the shared Denver time parser and rejects skipped/repeated DST wall times. This does not assume the user's browser timezone. Unsupported species cannot receive invented standard tooth IDs through the server.

## Verification and integration

Unit tests verify tooth counts, exact quadrant ordering, expected gaps and measurement rejection. SQL tests verify authorization, cross-patient writes/signatures/addenda, invalid dentition/measurements, retry deduplication, stale writes, immutable signatures and historical preservation. Browser tests cover save/reopen, failed draft retention, changed tooth state, signing/addenda, feline deciduous gaps and manual species notes.

`PatientDentalChart({ petId, species, onDirtyChange? })` is wired into the patient page. The optional dirty callback reports draft/addendum/pending status. The component confirms discard when switching or reloading charts and warns on browser unload. **Root integration must combine this callback with the existing patient-page router blocker for SPA navigation**; the component intentionally does not register a competing `useBlocker` beside ClinicalWorkspace. The same coordination is needed for the other clinical panels.

Clinical reviewer acceptance, supervision/role policy, real patient commissioning and any anatomical diagram expansion remain rollout gates. No production records or external provider traffic were used in implementation tests.
