# Schema5 release provenance — supplemental disclosure review

Status: pending. Prepared for Dr. Susan Edler and the practice's record-disclosure reviewer. This checklist does not approve a form, enable release confirmation, authorize a recipient or establish Antech/ezyVet connectivity. Record the exact integrated revision and any required corrections in the review register.

## What the reviewer must distinguish

A laboratory original, a staff-reviewed manual ezyVet export and a locally signed clinical note have different sources. A verified byte digest identifies the file inspected; it does not authenticate the outside author or certify that a patient history is complete. Administrator source approval and a DVM acknowledgment are separate actions. Acknowledgment applies to one exact version and must not appear to endorse every finding or transfer to a later correction automatically.

## Synthetic review cases

1. Select an original lab report and its exact original file. Confirm that the laboratory/source label, report reference and dates, reviewed entry method and acknowledgment state are understandable. Compare the displayed metadata with the selected original, not an unrelated lab order.
2. Select a corrected report and the earlier original as historical evidence. Confirm that each retains its own identity and file, the relationship is clear and the old version is visibly historical. The correction must not rewrite the earlier report.
3. Select an approved ezyVet manual export and a later replacement from the same series. Confirm that the local patient/source-site/animal association and staff-reviewed export reference are understandable. No external signature, live API fetch or complete structured import should be implied.
4. Compare versions with no acknowledgment and with a recorded DVM acknowledgment. Verify whose identity is displayed and what was acknowledged. Absence of an acknowledgment must not be shown as agreement or as a technical error.
5. Check that source selection requires the corresponding original. Try removing the original and confirm that the interface prevents an incomplete package. Review selected records and originals after loading another page; unseen records must not silently join the selection.
6. Inspect the frozen release report, then each original attachment through the existing email or document-link review workflow. Confirm that the same source information remains visible and that current recipient, message and forwarding/expiry controls still require review. Opening a download does not establish that its contents were read.
7. Review a saved schema1–4 release. Its historical content must remain unchanged. Where newly available source provenance makes fresh delivery ineligible, the interface must explain that another reviewed release is needed without rewriting or deleting the earlier artifact.
8. Change the reviewed laboratory account/patient/order mapping and confirm that an older report cannot be freshly released under the superseded identity. A later review of the same identity must be reflected in the new snapshot; historical report versions with unchanged identity remain selectable.
9. Add a source correction or acknowledgment after preview. Confirm that stale confirmation/delivery is rejected and a fresh preview is required. If a previously committed request's response was lost, its exact receipt must remain recoverable; recovery must not create a second release or regenerate captured bytes.

## Decisions to record

- Are the source, historical-version and acknowledgment labels sufficiently clear for staff and intended recipients?
- Does the selected source metadata disclose only appropriate information alongside the original files? Identify any source reference or identity fields requiring different presentation.
- Can staff reliably distinguish a frozen report from the separate original attachments and verify their selection?
- Are the correction, stale-review and legacy-release explanations clear enough to prevent accidental sharing of an unreviewed package?
- What changes are required before schema5 disclosure acceptance can be recorded?

All example values must be synthetic. Actual source completeness, provider authenticity, clinical interpretation and recipient authorization remain separate checks. C09, C10 and D02 acceptance must reference the new integrated revision; earlier examples or technical test results do not supply that acceptance.
