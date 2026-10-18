# Pure call contract self-review

Scope: new call-note model/provider helpers, their synthetic tests and frozen-Deno CI inclusion, against released baseline `4be71331`. This is a developer self-review, not an independent clinical adjudication.

Reviewed strict input/response shape, per-claim evidence, Unicode offsets, field/destination/citation/byte budgets, source immutability, original call-time handling, patient exclusion, model policy derivation, vocabulary/request fingerprints and malformed/incomplete/refusal output. No production route, API caller, database migration or network request consumes these helpers in this increment. Existing typed/audio contracts are unchanged.

Important integration boundaries:

- PostgreSQL must load, authorize and bind the actual source/job/template/policies. A supplied manifest hash's shape is checked here; the database's canonical JSONB hash is not recomputed in JavaScript. Unit fixtures use explicitly fictional hash metadata.
- Exact excerpts and generated patient-scope labels cannot establish clinical entailment, speaker identity or patient attribution. Full private review and explicit unsigned save remain required.
- The parser's serialized-envelope budget does not replace the bounded HTTP stream reader in the eventual handler. Refusal/incomplete/unusable responses fail; these helpers do not retry or dispatch.
- A retired historical result must use retained payload validation/read contracts; this new-request/finish parser requires its pinned approved template context.
- Clinical/account fidelity, SQL parity, actual Auth/browser/recovery/race/restore acceptance and default-off endpoint wiring remain integration work.

Verification: 36 call tests; all 1,621 repository tests; lint/application type checks/build; strict standalone TypeScript; full frozen Deno check. Existing unrelated lint/chunk warnings remain. PR272's separately documented generic RPC advisor is a production rollout finding, not a finding in these unwired helpers.

0 critical, 0 warnings, 0 suggestions in the reviewed helper scope.
