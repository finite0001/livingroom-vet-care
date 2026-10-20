# Populated restore at genuine 1,000-correction depth

Base: released PR #284. Reuse one genuine dispense, one allocation and 1,000
canonical operational annotations. Close selected-schema populated restore
coverage without changing engine behavior, canonical writers, migrations, limits
or pins. All acceptance below refers to the revised producer source set unless
an earlier source set is explicitly named.

- [x] Explicit local restore opt-in includes correction capacity; CI requests both
  full rehearsals. Add restore to CI only after targeted feasibility passed.
- [x] Run restore after the verified 1,000-event opening/replay phase and before
  event 1,001. Keep the same absolute 900-second workload deadline, 120-second
  writer reserve, batch-32 bound and admission safety factor of two.
- [x] Copy exact post-replay history into a uniquely marked populated clone,
  commit one valid frozen unattached opening, preserve every canonical relation
  including admission rows and all original sessions, and add exactly one
  synthetic opening session only in the populated clone.
- [x] Dump populated data into a second marked clone; compare all 456 selected
  public/auth/storage/extensions relations, technical manifest and ten writers.
- [x] Validate the complete 1,000-event chain/receipts, exact retained head,
  quantities/billing and opening/product boundary in UTC/Denver/Kathmandu without
  caller claims; prove exact rollback after restored-session retirement.
- [x] Share the workload deadline across ownership checks, SQL, dump/restore and
  snapshots. Never mutate the caller's database/marker to switch targets.
  Attempt every marked cleanup and require source preservation and successful
  removal before publishing PASS; cleanup itself may exceed the workload clock.
- [x] Review and test the revised fixture-only operational-annotation producer:
  real preview before/after each batch; advance only head from strictly bound
  actual receipts; retain canonical full-history verification on every append.
- [x] Prove the producer contract with three rolled-back successful writes,
  eight receipt-mutation refusals, two canonical stale-context `PT409` refusals,
  and exact all-relation/manifest rollback. The earlier `40001` expectation
  failure is archived and excluded from acceptance.
- [x] Pass 182 focused Python harness methods, including producer parsing,
  preservation, privacy, ownership and deadline guards; independently review.
- [x] Complete the current source-frozen targeted rehearsal: 418.477 seconds,
  418 source hashes plus three private input hashes matched, 33 committed
  batches/1,001 canonical writes/66 real previews, all original eleven capacity
  observations and seven restore validations, exact owned-resource removal.
- [x] Complete fresh full ordinary compatibility with the revised producer:
  166 canonical SQL suites/7,338 assertions, all existing candidate probes,
  producer contract, eleven capacity outcomes and seven restore validations;
  458.641-second correction workload, all 418 source bindings matched and exact
  owned-resource absence verified. Genuine Auth/PostgREST passed 133 combined
  checks with eight observed lock queues (not an HTTP request count).
- [x] Complete fresh genuine 187/188 historical compatibility and populated
  generic-opening restore: seven native cases/83 SQL checks and two generic
  openings/29 checks, all 254 current-source bindings matched, both actual
  runtime labels independently verified to have no containers or volumes.
- [x] Repository checks previously passed 1,687 tests, all three TypeScript
  checks and production build; four existing lint warnings/chunk warning remain.
  The subsequent changes are Python/SQL/CI/docs and have separate harness/rehearsal
  validation requirements above.
- [x] Publish current-source sanitized JSON/Markdown evidence and independently
  review exact private source/result bindings.
- [ ] Complete PR #285 and exact-head CI with all five jobs passing before
  Dave's specific merge approval and authorized release.

The current private targeted observer covered 51 labeled SQL stages across six
immutable-target intervals and nine switch/drop boundaries. Sampled container /
backend peaks were 270,742,323 / 123,211,776 bytes. All observer checks were clear;
no cancellation or emergency stop occurred. Direct intervening dump/snapshot/
marker commands are outside the tagged-query cancellation scope. These sampled
observations are not production benchmarks or guaranteed memory maxima.

Earlier passes remain archived with their own source bindings: targeted restore
593.592 seconds/416 files; parent-diagnostic ordinary 581.332 seconds/417 files;
historical 253 files. The revised producer changes the fixture and correction
probe and adds a helper, so those passes do not validate the new source set.
The first per-stage-observer reserve refusal and producer contract SQLSTATE
expectation failure are also excluded from acceptance.

Four CI attempts are excluded. Run 39320338590 failed after about 686 seconds
with no retained child diagnostic; its cause remains unknown. Run 39331162145
refused 928→960 with 210.895428161 seconds remaining versus 247.737407283 required.
Run 39337225028 put the whole database job on ARM and refused the same batch with
229.243710925 remaining versus 243.556468959 required. Run 39342481911 isolated
the ARM controlled-stock job and refused 960→992 with 183.093148143 remaining
versus 250.748689660 required. Each required amount includes the unchanged
120-second reserve. Restore had not started in the three confirmed refusals;
source/clone preservation and outer resource absence passed. The fourth run's
other four jobs passed. No failed run counts as capacity or restore acceptance.

The original database job uses ubuntu-latest. Exact full candidate/history
commands run separately on ubuntu-24.04-arm with checkout and CLI 2.118.0 only,
without a foundation stack or browser workload. Isolation removes known overlap
but did not by itself complete the bounded workload; no performance guarantee is
claimed. Parent diagnostics expose only fixed error categories and bounded
counts/timing/cleanup status, with fifteen focused privacy tests.

This SQL-only synthetic proof does not establish physical post-backup
reconciliation, cluster-role/default-privilege/Storage binary recovery, genuine
return/discrepancy maxima, simultaneous maxima or production capacity. C1b
assembly and C2 workflows remain separate. Susan's physical count, SOP and
practice-rule approval remain pending; no hosted candidate installation or
clinical/register activation occurs.
