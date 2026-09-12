# Dr. Susan Edler — clinical acceptance review pack

**DRAFT v2 · NOT APPROVED · prepared 2026-09-12**

Review baseline: `3c0c314` (integrated schema-3 historical record release). This is a review artifact, not an approval record or a statement that the practice is ready to launch. No reviewer approval has been recorded. Every decision below remains **pending**.

Start with [forms and decisions](forms-and-decisions.md), then open [the standalone HTML review examples](review-examples.html). The individual [records](records-example.html), [certificate](certificate-example.html) and [invoice](invoice-example.html) HTML files also work offline. Examples use existing synthetic fixture data through the real application renderers; they are not screenshots of all editable forms. Dates, signatures and clinical values are test inputs. In particular, the fixture phrase “Eating normally” is an existing fictional caregiver observation, not a prefilled QOL default or validated score.

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
| D01 | Invoice charges/credits/status/payment disclosure | Pending | | | |
| D02 | Record-release selection, recipient, originals and confirmation | Pending; schema-3 example included | | | |
| D03 | Reminder wording, eligibility, consent and delivery labels | Pending | | | |

For each accepted row, record: exact code revision; pack version; form/template version where available; decision (accept / accept after specified correction / reject); clinician or operational reviewer identity; date; evidence link; unresolved exclusions. “Accept after correction” remains pending until the correction is verified. Keep clinical acceptance separate from production configuration and operator sharing-policy acceptance.

## Review procedure

1. In a synthetic patient record, enter a nonempty draft, save, reopen and verify values and Denver date/time. For each versioned editor, open a second copy and verify stale-save feedback preserves the first draft.
2. Sign only the synthetic chart; confirm the original becomes read-only and a correction is an attributed addendum or preserved correction history. Cancel navigation with unsaved fields in multiple panels and verify the edits remain.
3. Inspect each relevant HTML example for wording and omissions. Escaped script-like fixture text is deliberately visible; it must not execute. Do not treat fixture signature names as real signatures.
4. Record approval or requested changes per review ID, including required/optional field decisions and missing workflow cases. Confirm clinic and housecall location wording separately.

## Provenance and coverage limits

`generate-examples.mjs` imports the existing certificate and schema-3 history-release fixtures and extracts the declarative invoice fixture. It calls the production renderers and adds a prominent synthetic draft banner. Run `npm ci --ignore-scripts`, then `node --experimental-strip-types docs/clinical-review/generate-examples.mjs` from the repository root to regenerate. Generated banners record the exact source revision. No external assets or patient data are fetched.

Fixture sources: `tests/record-releases/history-fixture.ts`, `tests/record-releases/charts-fixture.ts`, `tests/record-releases/fixture.ts`, `tests/certificates/fixture.ts`, `tests/billing/invoice-document.test.ts`. The rendering examples do not exercise every species/dentition, certificate revision or release-source combination. Schema 3 now includes explicitly selected problem/diagnosis revision history, critical/high-importance highlighting, allergy/legacy profile summary, dated weights and medication/vaccine treatments with correction history. The example includes these groups, but does not prove every record or historical revision exists; missing history is not reconstructed. Dr. Edler must still review D02 at this baseline.

Antech has been selected but a direct lab API contract/credentials are not configured here. Anesthesia vendor integration remains TBD; manual records and attached originals are the implemented scope. ezyVet imports are staged for staff review with Living Room Vet as the primary system. No automated interpretation, dose recommendation, inferred vaccine equivalence or clinical normal range is approved by this pack.
