# Recording → OpenAI transcription → reviewed SOAP

Base: merged/deployed PR262, `0e8df95c4fb1480476dae0b3dc0415706a500e73`. User selects OpenAI for both steps; draft consent/retention settings for Susan; real processing stays off until approval. Standing authorization covers merging completed PRs in this chat.

## Architecture and deliberate scope

Capture/pause/resume/stop a single-patient clinician dictation, preview/download the finalized PCM WAV, then request transcription and SOAP through separate durable attempts. Upload an existing compatible WAV as an alternative. No server audio bucket: audio exists in browser/request/provider processing memory, not retained by the app. Saved transcript, model/source hashes, generated claims/excerpts and action history remain clinical source history. Explicit local download supports recovery; tab/crash-safe recordings and multi-pet ambient attribution are not claimed. This is an independent native design; [VetRec evidence](research/vetrec-workflow.md) distinguishes published, observed and unknown behavior.

Reuse existing immutable dictation proposals and selective clinician acceptance. Generation creates one proposal atomically; it cannot save/sign the encounter. All four SOAP sections use arrays of clinical claims with literal source excerpts. Missing findings remain empty. Schema/quote checks cannot establish medical accuracy; clinician review remains mandatory.

## Implementation sequence

1. Generate migration194: private policy, jobs, attempts, events and generation provenance; session-bound staff reserve/read/claim/retry; narrowly scoped service dispatch/result/failure operations. Global policy draft plus server flag default OFF. Never impersonate a staff session in a service worker.
2. Add strict canonical16kHz mono16-bit PCM WAV admission and browser AudioWorklet recording. Bound to600seconds /19.2MB PCM; stop tracks on every stop/cancel/error/unmount, flush final samples, preview/download, guard unsaved navigation. Unsupported capture gets an explicit compatible-file alternative. Do not claim actual iPhone acceptance from desktop tests.
3. Implement fixed OpenAI endpoints and policy-pinned `gpt-transcribe` / `gpt-6-luna` contracts; [official research](research/openai-contract.md). Responses `store:false`, `background:false`, explicit cache mode without breakpoints; no tools, Files API, conversation or silent retries. Key only server-side. No provider no-retention guarantee inferred from these flags.
4. Persist a claim and one-shot dispatch before each paid call. Distinguish definitive failure from uncertain outcome. Recover original attempt state; never automatically repeat a dispatched call. Expired/uncertain retries require an explicit reason and possible-charge acknowledgement, create a new attempt and fence late old results. Preserve a received result across persistence retries without another provider call.
5. Add recording/process/recover/explicit retry UI in Medical, sharing the parent draft/busy guard. Read individual AI claim excerpts and flags beside imported proposals; existing review/sign/addenda rules stay intact.
6. Unit/SQL/real owned Auth+HTTP+browser+contention/populated-restore proof. Fake OpenAI responses prove transport/orchestration only. The staging practice key is now configured. A bounded fixed-speech test passed the actual shared adapter against OpenAI once per stage, without clinical database use or activation; the temporary endpoint was removed.
7. Stage additive migration and disabled Edge Function, verify gates and preservation. Production release follows completed checks with standing approval; keep policy and provider flag OFF. Do not enable message/payment/clinical automation.

## Draft policy for Susan

Clinician dictation first; confirm selected patient and source permission before capture/processing. Raw audio is not retained server-side; local recording disappears when discarded/page closes unless explicitly downloaded. Provider handling is separate and needs account verification. Transcript/proposal/review histories follow the existing clinical-record policy, not message purge. Susan must approve permission wording, permitted workflow, source/transcript retention and replay/download access before live processing. Draft policy is visibly inactive and has no public approval endpoint.

## Acceptance

- Same UUID + same intent recovers one source/attempt/result; mismatched reuse fails. Wrong actor/patient, retired session, inactive patient, bad WAV/hash and stale encounter denied before paid dispatch.
- Duplicate dispatch emits no second provider request; competing claims serialize. Late/superseded/expired results cannot overwrite later work. Unknown response never silently triggers a retry.
- Source excerpt mismatch/refusal/incomplete/malformed/empty responses yield no proposal. Negations and omitted objective findings retained in synthetic examples; this is not clinical model validation.
- Generated draft leaves saved chart unchanged until explicit selected acceptance; signing remains separate. Read-only provenance includes every claim excerpt and model/source attribution.
- Recording pause/resume excludes paused samples; stop/cancel/unmount closes tracks; finalized audio is valid/playable and downloadable. Navigation retains/discards source deliberately. Narrow controls wrap and remain readable.
- Canonical replay/restore includes all five new families; original hosted rows/functions remain unchanged. No real provider call, source recording, or paid API test without authorized configured credentials.

## Outstanding evidence

Susan policy and provider account data-control review; actual supported iPhone recording test; private VetRec/VetRocket account instructions and supported imaging contract. These do not prevent building the disabled feature and honest owned-runtime proof.
