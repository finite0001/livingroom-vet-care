# Controlled stock source reconciliation — local checkpoint

> Historical checkpoint, superseded by the [corrected source and execution-candidate evidence](2026-10-15-controlled-engine-candidate-local.md). The687-check oracle compared anesthesia’s audit link to itself. The corrected961-check gate exercises136 actual canonical retries and verifies the returned treatment row. The original JSON and hashes below remain unchanged as historical evidence; they are not current receipt-contract acceptance.

The [local reference oracle](../../tests/controlled-drugs/engine/README.md) is implemented and integrated into the canonical native prescription acceptance runner. This checkpoint adds verification tooling, not a physical controlled-drug writer. [Machine receipt](2026-10-15-controlled-source-local.json).

The oracle reconciles 136 synthetic canonical operations across ten producers, six return actions and three annotation kinds. Its 687 SQL checks preserve exact receipt/actor/source membership, signed fractional quantities and five distinct negative compensation movements. They reject changed actors/receipts and missing pickup/restock source links, preserve original effects after catalog price/availability edits, and ensure annotations never invent physical quantities or observation times. Conditional return requirements retain the actual intake identity/custody and require checking the original pickup; they do not grant controlled take-back eligibility.

The temporary invoker functions run only inside a rolled-back transaction in a marked, schema-only disposable clone. No source clinical records or runtime policy decisions are copied. The clone receives only synthetic canonical fixtures, ten stock manifest rows and the canonical disabled version-zero ordinary-return seed. Every table in the copied schemas is fingerprinted before and after the proof. The populated clone and original database are unchanged; the clone and enclosing owned runtimes/volumes are removed.

Validation passed:

- `npm run check`: 1,471 unit tests, TypeScript and production build; zero lint errors and four existing warnings.
- Full native runner: all 783 existing native Auth/API/browser checks, 78 SQL/TypeScript replay cases, estimate decision/publication concurrency checks, 40 stock-boundary Auth/API checks, 16 observed lock queues, populated source restore and 275 native restore checks.
- New source-reconciliation gate: all 687 SQL checks, ten producers/six return actions/three annotation kinds, two missing-reverse-source denials, exact table fingerprints and owned cleanup.

The source oracle’s synthetic SQL claims are **not genuine Auth/API acceptance** for a controlled-drug engine. Existing native Auth/browser proofs are separate parent regressions. The complete canonical SQL suite and new GitHub CI/frontend suite were not rerun for this local checkpoint; no new PR is represented as reviewed or deployed.

[PR257’s verified rollout](2026-10-14-native-handoff-rollout.md) remains the released backend. This checkpoint adds no migration190, hosted RPC, backend write, provider request, Edge deployment, secret change, actual controlled policy/opening or activation. It preserves all 45 original requirements.

C1b owned prepare/execute/read/cancel, reservation locking/session freshness, reviewed policy enforcement, container transitions/posting, deferred consistency and managed restore proof remain unfinished. C2 workflows and C3 actual practice acceptance are still required. [Susan’s rules](../controlled-drug-rules-susan-review.md) remain draft and inactive.
