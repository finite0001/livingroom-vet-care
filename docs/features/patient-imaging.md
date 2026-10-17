# Patient imaging

Open a patient’s **Medical → Imaging** section. This is a manually reviewed VetRocket study register. Automatic image/result exchange and a native DICOM viewer are not connected by this feature.

## Link a study

1. In VetRocket, confirm the patient ID and study identity/date. Obtain the study-specific share link, not the clinic login/home page.
2. Choose **Link imaging study**. Enter the clinic/account label, vendor patient ID, study ID, date, modality and description. Optional accession/body region retain source wording.
3. Optionally select an encounter. To associate a report, upload the PDF through the existing patient Documents tab, return to Imaging and reload the choices. A report associated with an encounter requires that same encounter selection.
4. Confirm the source belongs to the patient shown and enter the identity review note. Save the link.

Only the observed HTTPS `*.vetrocket.net/view.html?link=…` share-link family is supported initially. A different genuine account link needs a documented extension to validation. Images remain in the vendor viewer; links may require vendor authorization and may expire. Opening a link does not prove it belongs to the patient—the manual identity check is required.

## Review and correct

Choose **View study** to open the recorded details. **Open VetRocket viewer** launches a separate tab after checking the current record. **Download current PDF** is available only when its exact saved private report version is still ready. Neither action sends records to a client or another clinic.

Use **Correct details** to update study metadata, an expired link or its report association. Enter a reason and reconfirm identity. Account, vendor patient ID, external study ID and native patient identity are permanent. Use **Void record** for an incorrect association; retain the explanation and review the original source before linking another study. Voided identity cannot be silently reused for another pet. Archived/deceased patient history remains readable, but new studies are disabled.

**View history** shows original and corrected versions with actor/time/reason. Source associations do not edit SOAP notes or imply a radiologist has reviewed the images.

## Interrupted saves

If a response is lost, **Check saved work** recovers the exact original request. Its pending intent is retained in this browser tab’s session storage and recovered after a page reload. If no receipt is found, retry the original request or choose **Cancel request and return to editing**. Cancellation first resolves any already-committed result; otherwise it records a terminal cancellation so a delayed original request cannot save afterward. Do not clear browser storage or switch operators to bypass an unconfirmed action.

For outgoing records, select an eligible report PDF through the existing reviewed document/release workflow. Imaging viewer links stay internal; complete record requests disclose that imaging metadata was excluded. A manually linked study is an intermediate workflow. The original VetRocket integration requirement still needs supported account access and a correctly matched representative study/report exchange.

Research, source limitations and subsequent steps: [VetRocket plan](../../plans/20261016-vetrocket-imaging/plan.md).
