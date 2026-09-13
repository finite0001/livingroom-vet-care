# Lab and historical-import review addendum — pending

Reviewer: Dr. Susan Edler. No approval or clinical acknowledgment has been recorded by preparing this document. This supplements the original v3 pack; the existing HTML examples do not demonstrate these new workflows.

Scope: lab provenance4100 and staff workflow `c56b4e3`; historical manual-export provenance4200 `bb3320a` and byte verifier `aa14ba4`. The historical-import staff panel is still undergoing separate integration/testing. Record the final integrated revision when conducting review; these component references are not blanket acceptance of a later release.

## C09: original and corrected lab reports

Use a synthetic patient with a saved lab order, two different private report originals and an explicitly reviewed manual source identity. Do not use real patient records or send the examples.

1. Compare source patient/order references with the selected local patient and order. Confirm staff can recognize a wrong mapping before linking a report.
2. Open the original file and verify that its patient, collection/result dates and accession information agree with the intended order. The file digest identifies saved bytes; it does not establish Antech authenticity, patient identity or clinical correctness.
3. Link the reviewed original, then acknowledge it as a DVM. Verify that byte verification, staff linking and DVM acknowledgment are three distinct events. Acknowledgment does not record an interpretation, treatment plan, client notification or completed follow-up task.
4. Introduce a corrected report using a new document, exact prior report and explicit reason. Confirm the first report and its acknowledgment remain visible and the correction requires separate review. Decide how staff will notice and handle corrected results operationally.
5. Confirm lab notes, result status, due plans and next-care reminders retain their separate meanings. Linking a file must not silently change a due date, complete an order or send a client message.
6. Void a synthetic original and inspect historical display. Confirm staff can distinguish preserved provenance from a file that is eligible for new linking or acknowledgment.

Decision needed: accept the source-matching, correction and review presentation, or specify required changes. Antech API onboarding, report interpretation, patient-specific reference ranges and real provider acceptance remain separate gates. No automatic lab interpretation is approved.

## C10: historical medical-record originals from ezyVet

Use a synthetic approved ezyVet animal mapping and a same-patient ready medical-record document. Equal animal IDs at different source sites must remain distinguishable. The current workflow preserves a manually obtained export; it does not fetch an export from ezyVet or certify the source clinician.

1. Review local patient, source site and animal identity, received date, export reference and the actual original file before administrator approval. Confirm the label communicates staff-reviewed manual provenance.
2. Verify that approval makes the original available as historical evidence without creating locally signed SOAP, diagnoses, prescriptions, vaccine administrations, stock movements or charges.
3. Replace an original using a new document in the same export series and an explicit reason. Confirm prior originals and their acknowledgments remain intact, and later replacements do not inherit clinical acknowledgment.
4. As a DVM, acknowledge the exact historical version. Confirm reviewer identity means the local reviewing veterinarian, not the outside author. Document interpretation and clinically significant findings in the appropriate native chart separately.
5. Compare the source record with the local chart and list any missing diagnoses/reactions, vaccines/due dates, prescriptions, visits or attachments needed for safe continuity. File preservation alone does not prove structured import or a complete patient migration.
6. Review sharing separately: an existing release may include an explicitly selected shareable original, but its frozen schema does not automatically include this new import ledger or claim complete external history. Do not treat the import approval as recipient authorization.

Decision needed: accept the manual provenance/replacement/review presentation and specify reconciliation requirements before importing real patient histories. Actual source account authorization, API formats, completeness and structured historical mappings remain open.

Record each decision under C09/C10 in [the acceptance register](README.md), including the exact revision, reviewer, date, required corrections and exclusions. The existing C07 lab-plan review and D02 record-disclosure review remain independently pending.
