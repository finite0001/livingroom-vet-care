# Clinical call quote anchors — local verification

The new provider protocol asks for a segment ordinal and unique literal quote. The server derives exact retained hashes and UTF-16 ranges before invoking the unchanged canonical clinical payload validator. Missing, repeated (including overlapping), wrong-segment and altered quotes fail closed. Prompt wording requires each factual assertion to have its own supporting evidence; this does not guarantee clinical entailment.

New results retain exact complete HTTP-response and decoded output-text digests with strict provider/resolver versions. Historical v1 readers and completed-attempt replay remain supported. Migration 204 changes only the finish/failure functions; it does not grant new access or activate call capture/generation.

Verification passed: **1,670 repository unit tests**, three strict TypeScript projects, lint and production build; focused provider/transport tests; **227 SQL assertions** across three suites; **152 combined local Auth/PostgREST, SQL-state, setup/process and restore assertions**; 20 worker HTTP checks, 21 browser checks, eight observed lock waits and ten populated restore checks. The owned runtime was removed. Three local stub provider requests were used, with no real provider requests in this proof. Historical v1 recovery was tested with a labeled fictional adaptation.

The private runtime receipt has SHA256 `b7adc286bfd09ec82ef5e87c82dd9e0521ec624447e4646a78f512bd1d560d1c`; its 231 source hashes match this implementation. See the adjacent JSON for the frozen corpus digest and verification limits. The original ten scenarios and required/forbidden meanings are unchanged, and the original failed real evaluation remains separate.

Independent review found no blockers. This receipt establishes local verification only: a fresh v2 real-provider evaluation, hosted rollout, Susan’s clinical/policy review and real iPhone/Safari acceptance are not claimed here. Clinical gates remain inactive.
