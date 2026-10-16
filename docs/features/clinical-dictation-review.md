# Dictation draft review

Open a patient's **Medical** tab, select a saved encounter, and expand **Dictation drafts**. For an unsigned encounter, choose **Import dictation draft**. Supply the transcript, its source and authorization, and any proposed SOAP sections. Each proposed section needs an exact supporting excerpt copied from the transcript. Leave unused sections and excerpts empty. Confirm patient attribution and authorized use, then save the draft for review.

This first native slice accepts staff-supplied transcripts and proposed text. It does not record audio, transcribe a recording, generate notes, call VetRec, or exchange images with VetRocket. Audio capture, processing jobs and generation are later implementation work. Supporting excerpts identify source text; they do not establish clinical accuracy.

Saving an imported draft retains its original transcript, source description, proposed wording and attribution. It does not change the encounter. Select an imported draft to compare the retained transcript, its excerpts, the current saved section and proposed wording. Choose only the sections to replace, edit their reviewed wording, and confirm the review. **Accept selected sections into saved draft** replaces those sections and preserves all unselected saved text. Signing remains the existing separate clinical action. A rejected draft requires a reason and never changes the encounter.

If another clinician changes or signs the encounter after import, acceptance is blocked. The original proposal remains available; reject it with a reason, or prepare a new import against the latest saved encounter. A signed encounter's historical proposals can still be viewed and unused proposals rejected. This flow cannot replace signed text or bypass the addendum workflow.

An unconfirmed save retains its original request. Use **Recover dictation save** or retry that same request. Do not recreate the import or acceptance under a new request while its result is unknown. Recovery confirms the original action, then loads the current encounter so a later edit or signature remains visible. If that refresh fails after confirmed acceptance, use the existing **Reload latest saved record** action before further editing.

Unsaved review text is held in the current page, with the existing clinical navigation warning. It is not stored in browser persistence. Unconfirmed operations prevent further dictation edits until recovered. Other unsaved clinical edits must be saved or discarded before dictation changes. Import and review changes are unavailable for inactive patients; ordinary existing clinical corrections/addenda remain governed by the existing editor.

Only current active staff with a live session can use the guarded review APIs. Original source/proposal and review/action histories are immutable and private. The panel shows the latest 20 imports for the selected encounter; earlier stored source history is retained. Raw transcripts are not attached automatically to emails, record-release packages, message retention or ordinary patient-document uploads.

## Engineering release

Apply generated migration `20261016040402_clinical_dictation_review.sql` through the established migration process before the corresponding frontend release. It creates three private attributed histories and guarded read/submit/review/recovery functions. It does not change the existing clinical signer, prescriptions, payments, reminder configuration, storage MIME rules or provider credentials. Test with the owned disposable runner under `tests/clinical-dictation/`; no hosted patient edits or external-provider requests are required for that proof.

Rollback a frontend release through the normal deployment process; retain clinical sources, review decisions, existing chart text and action receipts. Do not delete clinical source history as a rollback. No audio/AI job or scheduled worker is installed by this slice.
