# Call draft citation contract preparation

Source baseline: `4be71331` (PR 272), now specifically approved, merged and verified on primary202. This preparation adds no admission, active generation, acceptance, provider request, database migration or UI entry point.

The private access release dependency is complete. Finish the pure source/claim and provider contracts before wiring guarded admission, generation and private review together.

## Chosen contract

- A separate strict versioned payload preserves the legacy typed/audio payload contract.
- Every proposed claim carries a patient scope and one to eight segment citations: ordinal, exact segment SHA256, UTF-16 start/end and literal excerpt. No model-supplied speaker name, event date or provider URL is accepted as citation metadata.
- Validation checks every segment's order, hash and projection identity, then each claim's own ranges/quotes. Repeated wording is resolved by explicit offsets. Ranges cannot split a surrogate pair or cite generated projection headers.
- Every pinned template field appears once in order, with existing missing/supported/uncertain semantics. Claim, destination, citation and UTF-8 output budgets are bounded. Empty eligible output fails rather than manufacturing filler.
- Other-patient and unassigned claims remain in the private payload but are excluded from proposed chart sections. Generated scope labels and exact citations are not proof of clinical entailment, patient attribution or authorization; explicit clinical review remains required.
- Assembly returns only proposed text by SOAP destination. Private source evidence is not concatenated into chart text. No routine saves or signs it.
- Add a pure server-context OpenAI request builder and response parser. Validate retained segment/projection bindings, original call times, selected patient and template snapshots; reuse the existing versioned veterinary terminology reference. Apply explicit request/response/field budgets and reject refusal, incomplete, tool or multiple-text output. Keep raw transcript/template instructions in untrusted JSON data.
- Retain prompt, source/projection, policy, template, requested/returned model and vocabulary/request fingerprints. PostgreSQL remains responsible for canonical manifest hashes, authorization and actual source-to-job binding; this helper is neither an Auth gate nor a clinical entailment check.

## Files and verification

| Action | File | Purpose |
| --- | --- | --- |
| Create | `/Users/davidedler/Developer/lrv-clinical-call-citations-20261017/supabase/functions/_shared/clinical-call-note-model.ts` | Pure Zod payload/citation validation and proposed section assembly |
| Create | `/Users/davidedler/Developer/lrv-clinical-call-citations-20261017/tests/clinical-calls/note-model.test.ts` | Valid multi-segment evidence, repeated quotes, Unicode, per-claim support, tampering, field/size budgets and patient-scope exclusion |
| Create | `/Users/davidedler/Developer/lrv-clinical-call-citations-20261017/supabase/functions/_shared/clinical-call-note-provider.ts` | Pure bounded OpenAI request/response contract, veterinary context and immutable input receipts |
| Create | `/Users/davidedler/Developer/lrv-clinical-call-citations-20261017/tests/clinical-calls/note-provider.test.ts` | Synthetic request binding, terminology, times, hostile data, response failures and citation validation |

Run scoped Node tests, ESLint and strict TypeScript checks. Use synthetic retained documents only; no credentials, hosted records or provider calls. Keep this work isolated from the PR 272 CI repair.

Implementation status: pure validator, proposed-text assembly and bounded provider request/response contract prepared. All 36 call-model/handler/UI-model tests pass, including 11 citation cases and 11 provider-contract cases. Full repository check passes all 1,621 tests, lint, application type checks and build; existing four lint warnings and chunk warnings remain. Strict standalone TypeScript and the full frozen Deno entry-point/shared-module check pass. The provider model is derived from the existing policy schema, preserving its permitted alias. CI includes both new modules in frozen Deno checks. No production consumer is wired; no SQL parity, real OpenAI output, clinical entailment, browser review or hosted generation is claimed by these offline results. The source hash is a trusted PostgreSQL canonical manifest fingerprint, not a locally recomputed JSON hash.

The Responses structured-output shape and explicit refusal/incomplete handling follow the [official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Offline schema tests do not establish model/account support or output fidelity. See the [source-bound contract evidence](../../docs/launch-evidence/2026-10-17-clinical-call-note-contracts.json).

## Integration still required

Repeat the same citation rules in SQL, add guarded admission/attempt/finish/recovery and policy configuration, implement private review and selected-section save, wire the default-off OpenAI handler, exercise real local Auth/browser/races/restore, and perform the separately bounded fidelity evaluation. No clinical or hosted activation follows from this preparatory contract.

Open clinical decisions remain Susan's call-processing/retention approval and adjudication; none blocks these offline checks.
