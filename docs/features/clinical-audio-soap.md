# Audio dictation and reviewed SOAP

The Medical workspace can capture a clinician's dictation for one saved patient encounter, transcribe it with OpenAI, then generate a SOAP proposal. Processing requires an approved recording policy, the server flag `CLINICAL_AUDIO_PROCESSING_ENABLED=true`, and a server-only `OPENAI_API_KEY`. The shipped policy is a draft for Susan and processing remains off.

## Staff workflow

1. Select a saved, unsigned encounter. Save or discard other clinical edits.
2. Describe the dictation source and permission; confirm the selected patient and authorization.
3. Start, pause/resume, and stop the recording. Preview it locally. Download the WAV if you need a copy. A compatible mono 16 kHz, 16-bit PCM WAV can also be selected.
4. Transcribe, then review the saved transcript before generating SOAP.
5. Generate the draft. Each clinical claim carries a literal supporting transcript excerpt. Check every claim, negation, attribution, measurement and any review flags.
6. Download or discard local audio and controls, then open the draft for review below. Select and edit only the sections you want to accept. Other saved sections remain unchanged. Acceptance leaves the encounter unsigned; signing is a separate action.

## Interrupted requests

Use **Recover source save** or **Recover processing status** after a lost connection. Recovery reads or confirms the original request; it does not repeat an OpenAI call. An original claimed request may be resumed under the same identity. An expired or uncertain dispatched attempt requires an explicit new retry, reason and acknowledgement of a possible additional charge. Late results from an earlier attempt cannot overwrite the retry.

Do not assume that closing this page cancels a request already sent. Download the WAV first if the local recording must survive closing the page.

## Recording and retention draft for Susan

| Decision | Proposed initial setting | Status |
| --- | --- | --- |
| Permitted workflow | Clinician dictation about one selected patient; no multi-patient ambient conversation | Awaiting approval |
| Authorization | Staff confirms patient identity and applicable source permission before capture/processing | Awaiting wording review |
| Raw audio in this app | Browser/request memory only; no server-side audio archive. Explicit local downloads become staff-managed copies | Awaiting approval |
| Transcript and proposals | Retain as clinical source history with the existing chart/review history; do not use message-purge rules | Awaiting retention/access review |
| Provider handling | Confirm the practice account's OpenAI data controls and retention terms before activation | Awaiting account review |
| Activation | Owner commissioning after Susan approves the policy and clinical example review | Inactive |

OpenAI Responses requests use `store:false`, no background processing, no tools and no conversation state. These settings do not establish zero retention at the provider; provider abuse-monitoring retention and account-specific controls must be reviewed separately. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## Current limits

Recordings must be one second to ten minutes, canonical PCM WAV, and audible. Unsupported capture offers a compatible-file alternative. Raw audio is not crash-safe or retained by the app. Saved transcripts cannot be edited in place; make a new source if a correction is needed. Claim/excerpt validation proves source linkage, not medical correctness. Desktop browser testing does not certify actual iPhone hardware. This independently implemented workflow does not establish parity with every VetRec feature.
