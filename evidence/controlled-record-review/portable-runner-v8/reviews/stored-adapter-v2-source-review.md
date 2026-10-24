# Independent stored-adapter V2 source/placement review

2026-10-23: **source/helper clearance granted** to the exact prospective freeze below. Actual V5 profile/publication and any regression diagnostic/full run require their separate admission. No historical638/full-run acceptance is inferred from offline callback shapes.

Freeze directory: `controller-integration/prospective-stored-adapter/` under the portable runner draft. `source-ready-v2.json` SHA256 `d7922bf8eed07747979cded3196b26b791b76a8835de99f6c7af1a6a2ce6c389`.

| Source | SHA256 |
| --- | --- |
| portable_runtime_adapter_v2.py | 22c0253e01b86409f86d10b7eea1fe8d66acc18fba736b4b0374c52a77e6536c |
| worker.py | 63cbfa02435a084c26c1bad45b1928013a40b538b79cd717d96aa097de5195e9 |
| source-pins-v2.json | e7538fd6fa32abcd2e9064ab37c68e2a140098b4c6c3dbdb848d2785a3352306 |
| test_portable_runtime_adapter_v2_regression.py | cf4d345b35144fcdda1a7375d341a9406d030ce69c818b4a39b0510497aa7c1e |
| test_stored_adapter_v2_canonical.py | 56fa226ca553bb09ae1f336086154d722bfe0f75c68620fe53e28a6ae18d966f |
| explicit-root test_stored_adapter_v2.py | e7b785e0d8ccc727c9964dd3f07d62045c71f5c11538f046cf6ba9d69695fd54 |
| lineage.json | e837d135705fdb780c7bdf779379995ddb565684445ab0a644fadf0dcdda0415 |

## Root cause and bounded correction

The unchanged inherited `test_integration_gate_brackets_frozen_source_inventory_deadline` first calls the real `read_pinned(BASELINE,BASELINE_SHA)`. Its original private tmp path is absent from the canonical publication, so it fails before the mocked source callback advances the clock and before the intended deadline assertion. An independent exact-method control reproduces the old failure on the actual V4 publication; the same assertion succeeds with only the baseline placement changed to the already-admitted public support file. No class fixture generation, child or DB is needed for that control.

That public source is `tests/controlled-drugs/fixtures/record-review-v3/history/maps/stored634.json`:84,980 bytes, unchanged legacy SHA256 `9138f6415099ebab1081ebfe8f169b0f13aca8d06cb4c375cf1fffa737044b54`. It was already in the original publication authority. New source pins preserve all eight old dependencies and add exactly this member. No private overlay, scan, live fallback or new baseline-map contents are introduced.

The production worker checks exact membership/metadata in the admitted current tree, physically rereads the support and supplies its exact path with the original job deadline/checker. The V2 factory changes no target global. Class setup binds only `r.BASELINE`, after validating the unchanged private declaration and unchanged `BASELINE_SHA`; it registers cleanup before fixture work and restores immediately on setup failure and at normal class cleanup. It changes no integration gate, clock, digest, inventory, success assertion or callback result. Unexpected path/hash mutation fails. The genuine production historical638 child callback remains unchanged.

All four existing replacement method ASTs remain exact; all21 inherited method identities and the helper identity remain original, preserving all25 target IDs/assertions. Binding the support path does not make the current larger source closure pass the old638 positive gate; that positive remains the separately admitted genuine historical callback.

## Regression composition and controls

The old adapter regression itself reruns the nested25 and would otherwise encounter the same missing-path failure. The prospective regression copy preserves all **eight** original method ASTs/logical IDs; only top-level canonical context/import and a fresh V2 fixture factory argument binding adapt its API. The separate seven-method canonical copy preserves all seven explicit-root method ASTs and derives ROOT from the fixed public layout. No generic regression-worker ROOT injection is added. Earlier reviewer shorthand saying11 old adapter tests was incorrect; direct AST/inventory verification gives8.

Seven separately written controls pass: actual V2 class binding plus unchanged deadline assertion and restoration; original-check refusal after assignment and immediate restoration; forged support metadata before-import refusal; changed legacy digest refusal; and prospective-worker exact/missing/wrong support metadata handling with original path/deadline/checker identity. The controlled fixture loader stops after the placement assertion; this is not full fixture/historical acceptance.

Thirteen focused source-unit controls also pass independently, zero skips, with processes/sockets forbidden. Exact file/lineage hashes, 4/8/7 method AST conservation, all original pin metadata and canonical ROOT ancestry are checked independently. Two nested full25 offline runs are retained in the author's15-test final log, zero skips; their historical callback is explicitly shape-only. Those author source controls are not claimed as independent genuine historical638 execution.

Resource delta is one additional four-slot regression job:16MiB, making22 regressions/89 total suite processes and a1,692MiB reservation within the same1,920MiB pool. Seven additive IDs produce1,394 total while retaining original IDs. The only new disk fixture copies nine small pinned dependencies totaling306,999 bytes inside a cleaned context, below the existing1MiB scoped-small-fixture allowance. No new historical/90MiB source copies occur; the existing33,427,253 SQL fixture bytes remain in memory. The existing963,718,189-byte scratch bound remains sufficient. Unit-fixture120-second budgets do not renew the production/formal job deadline; the actual worker supplies its original cutoff/check directly.

## Evidence and scope

| Independent receipt | SHA256 |
| --- | --- |
| stored-baseline-placement-hypothesis.json | 343d47acfd092f16d8d944fc58f74cf41f505626c8b32eb225da62679d7e29f8 |
| stored-adapter-v2-independent-controls.json | 304d6e5659bfe6e0e1e21abb8fcb75a577e15945d0fa475154a758453affd3a1 |
| stored-adapter-v2-lineage-and-13-results.json | 9237284236a3a00b16edc1bf61b9d27830fc3c7ddb959deb54acb2afdc4718ec |
| stored-adapter-v2-focused-13.log | c9a495551554316e047eed4706a17190fce1963b29cdfe4b11d76067723d383d |

The first placement-control run incorrectly expected a path in unittest's filtered bare-assert message; its corrected control wraps the unchanged reader to record the actual path. This fixture expectation error is preserved and excluded from product findings. Existing frozen sources, maps and all failed roots remain unchanged.

Reviewer work used source/artifact reads and bounded unit/assembly controls, with no target-worker/Transport/historical child, DB, service or network execution. This clears source placement and composition only. A newly admitted complete profile/publication, fixed full-regression diagnostic if used, then a fresh full run from job1 remain required; no prior failed run or selected suffix can supply acceptance.
