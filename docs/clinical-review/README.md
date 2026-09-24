# Dr. Susan Edler — clinical acceptance review pack

**DRAFT v4 · NOT APPROVED · prepared 2026-09-13**

Review baseline: use the exact code revision recorded in each generated example banner. The original v3 baseline `63414e8` covered schema-4 weight provenance; the expanded pack requires new review for selected source originals and imported API history. This is a review artifact, not an approval record or a statement that the practice is ready to launch. No reviewer approval has been recorded. Every decision below remains **pending**.

Start with [forms and decisions](forms-and-decisions.md), then open [the standalone HTML review examples](review-examples.html). The individual [records](records-example.html), [source originals](sources-example.html), [imported history](imported-history-example.html), [source references without full narratives](imported-history-references-example.html), [certificate](certificate-example.html) and [invoice](invoice-example.html) HTML files also work offline. Examples use existing synthetic fixture data through the real application renderers; they are not screenshots of all editable forms. Dates, signatures and clinical values are test inputs. In particular, the fixture phrase “Eating normally” is an existing fictional caregiver observation, not a prefilled QOL default or validated score.

## Acceptance register

Record decisions per form and exact revision. Blank fields mean no approval. A correction requires a new pack revision and re-review of affected items. Approval of one form does not approve another, authorize release of patient records or enable automation.

| Review ID | Scope | Decision | Reviewer and role | Review date | Evidence / requested change |
|---|---|---|---|---|---|
| C01 | SOAP, historical problems and critical alerts | Pending | | | |
| C02 | Dog/cat dental identifiers, layout and workflow | Pending | | | |
| C03 | Qualitative QOL observations | Pending | | | |
| C04 | Body-map location, measurements and correction history | Pending | | | |
| C05 | Manual anesthesia record and source disclosure | Pending | | | |
| C06 | Vaccine group taxonomy, explicit product mapping and patient overrides | Pending | | | |
| C07 | Lab due/result tracking and standard intervals | Pending | | | |
| C08 | Vaccine/rabies certificate content and signature attestation | Pending | | | |
| C09 | Verified lab originals, correction history and per-version DVM acknowledgment | Pending; supplemental review required | | | |
| C10 | Reviewed ezyVet manual-export originals and replacement history | Pending; supplemental review required | | | |
| C11 | Imported API history, locally reviewed problems/reactions and source discrepancies | Pending; supplemental review required | | | |
| D01 | Invoice charges/credits/status/payment disclosure | Pending | | | |
| D02 | Record-release selection, recipient, originals and confirmation | Pending; separate schema-4, schema-5 and schema-6 provenance examples included | | | |
| D03 | Reminder wording, eligibility, consent and delivery labels | Pending | | | |
| D04 | Frozen email report/originals and delivery attestation | Pending | | | |

For each accepted row, record: exact code revision; pack version; form/template version where available; decision (accept / accept after specified correction / reject); clinician or operational reviewer identity; date; evidence link; unresolved exclusions. “Accept after correction” remains pending until the correction is verified. Keep clinical acceptance separate from production configuration and operator sharing-policy acceptance.

[The lab and historical-import addendum](lab-import-addendum.md) covers C09/C10 beyond the original v3 baseline. It does not regenerate or extend the scope of the older rendered examples. Review these workflows against their exact integrated revision and a synthetic patient; all decisions remain pending.

## Review procedure

1. In a synthetic patient record, enter a nonempty draft, save, reopen and verify values and Denver date/time. For each versioned editor, open a second copy and verify stale-save feedback preserves the first draft.
2. Sign only the synthetic chart; confirm the original becomes read-only and a correction is an attributed addendum or preserved correction history. Cancel navigation with unsaved fields in multiple panels and verify the edits remain.
3. Inspect each relevant HTML example for wording and omissions. Escaped script-like fixture text is deliberately visible; it must not execute. Do not treat fixture signature names as real signatures.
4. Record approval or requested changes per review ID, including required/optional field decisions and missing workflow cases. Confirm clinic and housecall location wording separately.

## Provenance and coverage limits

`generate-examples.mjs` imports the existing certificate, schema-4 provenance-release, schema-5 source-provenance and schema-6 imported-history fixtures and extracts the declarative invoice fixture. It calls the production renderers and adds a prominent synthetic draft banner. Run `npm ci --ignore-scripts`, then `node --experimental-strip-types docs/clinical-review/generate-examples.mjs` from the repository root to regenerate. Generated banners record the exact source revision. No external assets or patient data are fetched.

Fixture sources: `tests/record-releases/clinical-history-fixture.ts`, `tests/record-releases/source-provenance-fixture.ts`, `tests/record-releases/provenance-fixture.ts`, `tests/record-releases/history-fixture.ts`, `tests/record-releases/charts-fixture.ts`, `tests/record-releases/fixture.ts`, `tests/certificates/fixture.ts`, `tests/billing/invoice-document.test.ts`. The rendering examples do not exercise every species/dentition, certificate revision or release-source combination. The example includes selected problem/diagnosis revision history, critical/high-importance highlighting, allergy/legacy profile summary, dated weights and medication/vaccine treatments with correction history. Schema 4 additionally distinguishes original ezyVet weight text/timestamp, reviewed local values, approving staff and later source-discrepancy reviews. A reviewer is not asserted to be the unknown source clinician. The example includes these groups, but does not prove every record or historical revision exists; missing history is not reconstructed. Dr. Edler must still review D02 at this baseline.

Antech has been selected; the practice has no assigned onboarding contact yet, and a direct lab API contract/credentials are not configured here. Anesthesia vendor integration remains TBD; manual records and attached originals are the implemented scope. ezyVet identity and historical-weight imports are staged for explicit staff review with Living Room Vet as the primary system; they do not imply broader clinical-resource promotion. No automated interpretation, dose recommendation, inferred vaccine equivalence or clinical normal range is approved by this pack.

[The schema5 release-source checklist](release-source-provenance.md) extends D02 with selected verified lab and approved external-original provenance. C09/C10 remain separate source-workflow reviews. All decisions are pending; use the exact integrated implementation revision and [generated synthetic schema5 example](sources-example.html).

The separate schema5 example includes original/corrected lab reports and original/replacement manual ezyVet exports with mixed acknowledgment states. It uses the production renderer and exact synthetic fixture, preserves the separate schema4 example and introduces no real source, approval or message delivery. Receipt/capture proof remains part of frozen data; the main report uses human-readable entry-method labels.

[Imported API history and locally reviewed problems](imported-history-and-problems.md) adds C11 and extends C01/D02/D04. Source preservation, administrator approval and local DVM clinical decisions remain separate. All decisions remain pending.

The schema6 examples compare [full imported narratives](imported-history-example.html) with [source references alone](imported-history-references-example.html) for the same synthetic local problem. Both retain local decision attribution, original extraction fields, later local edits and discrepancy history. Full-narrative omission must remain explicit; source references are not a complete original record.

## Native prescribing review in progress

The independent native prescription workflow has a [separate pending review checklist and synthetic print examples](native-prescribing.md). Signed authorization, partial dispensing and canceled history are shown separately. These component examples do not establish a completed prescribing workflow or clinical acceptance.

## Native dispensing corrections and returns — supplemental review

The [physical-return review packet](../../plans/20260916-native-prescribing/returns-review.md) and [synthetic return example](native-dispense-returns-example.html) cover held custody, disposal and reviewed restocking in the locally verified native implementation. The [correction example](native-dispense-corrections-example.html) preserves original dispensing and separately attributed amendments. Review against the exact revisions recorded by the examples/evidence; neither example records clinical approval.

| Review ID | Scope | Decision | Reviewer and role | Review date | Evidence / requested change |
|---|---|---|---|---|---|
| C12 | Native prescribing authority, partial fills, labels and pickup | Pending | | | |
| C13 | Attributed dispense annotations and pickup amendments | Pending | | | |
| C14 | Physical return custody, disposal and eligible restocking policy | Pending | | | |

The [return reconciliation contract](../../plans/20260916-native-prescribing/return-reconciliation-contract.md) is engineering preparation for correcting mistaken quantity claims. It does not add an available correction control or authorize reversal of actual physical disposal. Its future clinical review must include physically held evidence and unresolved discrepancies when stock has already been used.

The current platform direction is independent of ezyVet. Retained historical-import examples document existing evidence; they do not add an ongoing integration requirement or authorize source synchronization.
