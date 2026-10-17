# Call draft citation contract preparation

Source baseline: `9a192f23` (PR 271). PR 272 is open and has not received specific merge approval. This preparation adds no admission, generation, acceptance, provider request, database migration or UI entry point.

The existing Phase 3B plan requires the private access increment to land before call admission is introduced. Its source/claim contract can be developed independently against the already released call document and template definitions.

## Chosen contract

- A separate strict versioned payload preserves the legacy typed/audio payload contract.
- Every proposed claim carries a patient scope and one to eight segment citations: ordinal, exact segment SHA256, UTF-16 start/end and literal excerpt. No model-supplied speaker name, event date or provider URL is accepted as citation metadata.
- Validation checks every segment's order, hash and projection identity, then each claim's own ranges/quotes. Repeated wording is resolved by explicit offsets. Ranges cannot split a surrogate pair or cite generated projection headers.
- Every pinned template field appears once in order, with existing missing/supported/uncertain semantics. Claim, destination, citation and UTF-8 output budgets are bounded. Empty eligible output fails rather than manufacturing filler.
- Other-patient and unassigned claims remain in the private payload but are excluded from proposed chart sections. Generated scope labels and exact citations are not proof of clinical entailment, patient attribution or authorization; explicit clinical review remains required.
- Assembly returns only proposed text by SOAP destination. Private source evidence is not concatenated into chart text. No routine saves or signs it.

## Files and verification

| Action | File | Purpose |
| --- | --- | --- |
| Create | `/Users/davidedler/Developer/lrv-clinical-call-citations-20261017/supabase/functions/_shared/clinical-call-note-model.ts` | Pure Zod payload/citation validation and proposed section assembly |
| Create | `/Users/davidedler/Developer/lrv-clinical-call-citations-20261017/tests/clinical-calls/note-model.test.ts` | Valid multi-segment evidence, repeated quotes, Unicode, per-claim support, tampering, field/size budgets and patient-scope exclusion |

Run scoped Node tests, ESLint and strict TypeScript checks. Use synthetic retained documents only; no credentials, hosted records or provider calls. Keep this work isolated from the PR 272 CI repair.

Implementation status: pure validator and proposed-text assembly prepared. All 25 call-model/handler/UI-model tests pass, including 11 new citation cases. Scoped ESLint and strict TypeScript checks pass. No production consumer is wired; no SQL parity, OpenAI output, clinical entailment, browser review or hosted generation is claimed by these offline results.

## Integration still required

After PR 272 is approved and merged: repeat the same citation rules in SQL, add guarded admission/attempt/finish/recovery and policy configuration, implement private review and selected-section save, wire the default-off OpenAI handler, exercise real local Auth/browser/races/restore, and perform the separately bounded fidelity evaluation. No clinical or hosted activation follows from this preparatory contract.

Open clinical decisions remain Susan's call-processing/retention approval and adjudication; none blocks these offline checks.
