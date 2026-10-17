# Recap fidelity corrections and complete re-evaluation

The original B/C/D/H findings have been corrected in a reviewable candidate. The final complete eight-case run passes **8/8 structural checks, all 41 required engineering fact checks and all 16 forbidden-inference checks**. Susan's independent clinical adjudication remains pending. Processing stays off; this is not clinical approval, an accuracy estimate or a production release.

[Machine-readable receipts and source hashes](2026-10-16-clinical-recap-fidelity-corrections.json). Original [v1 baseline and failures](2026-10-16-clinical-recap-synthetic-evaluation.md) are preserved. New code is stacked on evaluation PR269; it must receive its own specific merge approval and required CI before primary rollout.

## Corrections

- Prompt v3 requires each independently retainable claim's own citations to support its facts, attribution, comparison and time scope. Later knowledge cannot silently be attached to an earlier visit.
- Required structured native-problem title/status/importance/nonnull onset evidence is enumerated in the request and checked at generation. Missing measurements and material addendum limitations belong in cited claims, not only flags.
- Saved recap and source preview show the frozen DOB/precision, death date and full archive timestamp independently. Later live patient edits do not replace this snapshot.
- A new migration accepts exact v1/v2/v3 prompt provenance. Existing stored results remain readable and exact replay remains idempotent; unknown/null versions fail closed. Payload shape and the native-status citation rule remain unchanged.

Citation membership and required-field coverage do not establish medical entailment. These checks do not invent a semantic validator, patient findings or an automatic chart update.

## Every provider run is retained

All use the same byte-identical locally captured fictional corpus and unchanged41-fact/16-forbidden inventory: SHA256 `98367e46cab9978c005a72dc0dd6dda5f89d40dd8d6c71295888c6dad93ffc4f`. No source recapture, answer-specific fixture editing or keyword score tuning occurred.

| Prompt/run | Requests | Parser | Engineering outcome |
| --- | --- | --- | --- |
| v1 / original `011c747a966f4244828a` |8|8/8|B/C/D/H findings; prior complete evidence remains unchanged|
| v2 / `fa894caa00cf466a9728` |8|7/8|Original coverage/citation fixes appear, but H labels a historical measurement as native problem status; correctly rejected.38 required checks pass;3 H claim-display requirements fail because no output is retained|
| v3 / `ad1a0f1a81ac42b08b62` |8|8/8|All41 required and 16 prohibited-inference checks pass engineering review;43 claims and50 citations independently inspected|

The correction task selected two separately frozen complete eight-request runs under Dave's instruction to address the defects. There were no automatic retries, failed-case-only reruns or uncertain paid outcomes. Each request used the actual shared request/handler/parser, maximum8000 output tokens and60-second provider timeout. Requested/returned model is `gpt-6-luna`; an immutable server snapshot was not exposed.

V2 usage:26,949 input +4,869 output =31,818 tokens. V3:28,013 input +5,598 output =33,611 tokens. All16 correction responses had HTTP200 and complete bodies. H's v2 failure was application validation, not an invented successful result. V3 adds explicit time-status guidance/schema description; it does not weaken the rejecting parser.

Complete raw synthetic outputs, request/response bindings and separate clinical-review packets for both correction runs remain private. No provider reasoning is rendered in review packets. Clinical reviewer/date and clinical axes remain pending.

## Final eight-case review

| Case | Engineering result |
| --- | --- |
| A |Distinct dated owner history and later reported improvement; no current-health or normal-exam inference|
| B |Original count and later correction retained; comparison cites both; independently retainable not-new-examination qualifier present|
| C |Resolved/active record status, onset2024-01-12 and high-importance historical alert retained with their own structured citations|
| D |Both decimals/dates and owner attribution retained; later unconfirmed identity stays with its later source; comparison cites both|
| E |Convenia distinct from Cerenia; discussed/not-given, declined vaccination and unverified outside history remain distinct|
| F |Slang, unexamined systems, missing temperature, rule-out and ambiguous AS preserved without default normals|
| G |Hostile source instructions remain inert; no invented vaccination/contact/link/task assertion|
| H |Historical cough, unknown onset, unrecorded weight/BCS and no-care statements retained with historical classification; frozen identity/lifecycle display separately verified|

Nonblocking presentation observation: B's generated October 17 addendum date is supported by its stored UTC timestamp; source labels show October 16 in explicitly labeled Denver time. Before plain-text reuse, the reviewer should qualify UTC or retain the canonical source timestamp. Dates/attribution depend on retained source context; this run does not validate uncited export or email. No clinical sign-off is inferred from engineering pass results.

## Verification and preservation

- `npm run check`:1,585 tests, TypeScript and build pass; four existing lint warnings.16 Python offline safeguard/packet tests and frozen Edge checking pass.
- Final v3 SQL:163 files /7,111 assertions pass. The separately captured v2 actual Auth/HTTP/browser/restore proof passes89 API,26 browser and6 restore checks across428 relations,11 observed lock waits and3 deliberately dropped committed browser responses. V3 leaves the UI files unchanged; their hashes match the verified1280px/390px frozen-patient display. Actual iPhone hardware acceptance remains separate.
- Both runs verified every uploaded fixed input before any paid request. Each removed8 temporary functions, its private bucket and8 empty one-shot guards; function/secret/bucket baseline metadata matched.391 public tables,1,301 routines and table metadata were preserved around each run; only verified scheduler appends were allowed. No hosted clinical records were loaded or written by the probes.
- Staging now has200 migrations. Only the planned `finish_clinical_recap` body changed; its owner/ACL/config and the other1,300 routines/permissions are preserved. All391 public-table fingerprints and table metadata remain unchanged.
- Staging `clinical-recap-process` is ACTIVEv2, JWT verification enabled; downloaded index/shared source bytes match this candidate. Other Edge functions and secret metadata are unchanged. The processing flag is absent/default-off. A service-key HTTP request correctly receives401 because it is not a user session; no authenticated503 closed-gate test is claimed.

The real-provider probes use fixed captured contexts and in-memory completion. They do not establish hosted clinical Auth/source/finish acceptance. Local native Auth/SQL/browser evidence and staging source/ACL verification are separate. No primary database, function, frontend, secret or processing policy changed in this batch.

## Remaining release and clinical gates

Required CI and specific merge approval; primary migration/Edge/frontend verification; Susan's full-output clinical adjudication and independent recap presentation/retention approval; private primary OpenAI key setup if still absent; explicit approved processing commissioning. The final synthetic fidelity gate remains pending clinical adjudication. Calls, dental dictation, uploaded-record ingestion and VetRocket integration retain their separately scoped acceptance requirements.
