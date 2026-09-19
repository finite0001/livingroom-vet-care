# C11 — Imported API history and locally reviewed problems

Status: pending. Prepared for Dr. Susan Edler and the practice's record-disclosure reviewer. This checklist does not approve a clinical form, enable schema6 release confirmation, authorize an ezyVet connection or certify a complete patient migration.

## Review the attribution

1. Compare an approved imported history with its original staged observation. Confirm that the narrative, raw source date/category/clinician reference and source identity remain distinct from the administrator's approval and a local clinician's review. Unknown dates must not appear as today's clinical date; outside references must not appear as local signatures.
2. Compare verified and unresolved consultation context. Confirm that missing information stays explicit and a known patient mismatch cannot be hidden by choosing an unresolved label.
3. Inspect an inactive or unknown-status source. Confirm that its software status is not automatically interpreted as a resolved medical condition. The local clinician must deliberately select the local problem's status and importance.

## Review the local clinical decision

4. From a synthetic history, create a locally reviewed problem/reaction with unknown onset. Verify the title, notes, status and high/routine importance controls, duplicate check and reviewer attribution. No source text should automatically become a diagnosis or a high-importance flag.
5. Create two distinct findings from the same source history. Confirm both retain their own decision and source association, without a duplicate retry producing an extra entry.
6. Link evidence to an existing problem. Verify that its text, dates, status and importance stay unchanged. A desired local edit requires a separate explicit clinical action.
7. Reopen an important reaction in the patient record and booking/treatment alert review. Confirm that source corrections or inactive status do not silently remove the reaction, and that a locally resolved important history remains visible where the practice expects it.
8. Edit the local problem after extraction. Verify the original extraction remains auditable and the edited text is not presented as authored by the outside clinician.

## Review recovery and source changes

9. Simulate an approval response being lost. Recover the exact prepared/committed operation without creating a second clinical record. Repeat after browser pointer loss; inspect saved operations and explicit abandonment. A delayed response must not revive an abandoned request.
10. Change the source after review, including changing it and then reverting to identical earlier text. Verify that an old observation is not silently considered current. Review the discrepancy, preserving the original source and local problem until separately reviewed changes are made.

## Review recipient disclosure

11. Select a local problem without the full imported narrative. Confirm that its extraction/source association remains disclosed and the report clearly states that the original narrative was not selected.
12. Select the full imported history as well. Verify that its narrative, original references, source approval, local clinical decision and later discrepancy reviews remain distinguishable. Check that private administrative reasons and unrelated staging fields are excluded.
13. Review earlier schema1–5 releases: frozen content remains unchanged. Fresh delivery must still respect current source and clinical-policy checks; recovering an old receipt does not grant new permission to send it.

Record C11 and affected C01/D02/D04 decisions with the exact integrated code revision, example version, reviewer, date and required corrections. All decisions remain pending until actually reviewed. The API sample contract, source completeness, recipient authorization and clinical interpretation require their own evidence; passing technical tests does not supply them.
