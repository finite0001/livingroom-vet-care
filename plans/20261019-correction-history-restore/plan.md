# Populated restore at genuine 1,000-correction depth

Base: released PR #284. Reuse its one genuine dispense, one allocation and
1,000 canonical operational annotations. This closes a selected-schema restore
gap; it changes no engine behavior, canonical writer, migration, limit or pin.

- [x] Add an explicit local restore opt-in that includes correction capacity.
  Targeted feasibility passed before adding the explicit restore flag to CI.
- [x] Run after the verified 1,000-event opening/replay phase and before event
  1,001. Use the same absolute 900-second workload deadline and 120-second append
  reserve; no deadline reset. Require the original capacity outcomes afterward.
- [x] Copy the exact post-replay history into a uniquely marked populated clone.
  Commit one valid frozen, unattached opening there, with no canonical writes.
  Preserve every canonical relation, including admission rows, and each original
  Auth session; add exactly one synthetic opening session only inside the clone.
- [x] Dump the populated clone and restore into a second uniquely marked clone.
  Compare every selected relation in public/auth/storage/extensions, the technical
  manifest and all ten canonical writers. Do not publish raw fingerprints or IDs.
- [x] Validate the complete 1,000-event chain and receipts, exact retained head,
  unchanged original source quantities/billing and full opening/product boundary
  in UTC, Denver and Kathmandu without caller claims. Exercise session retirement
  inside a rolled-back validation transaction and prove exact restoration.
- [x] Bound all ownership checks, dump/restore, SQL and snapshots by the shared
  workload deadline. Never mutate the original runtime's database/marker to switch
  targets. Cleanup may run afterward but must attempt every owned clone and must
  succeed before any PASS is published. Preserve source runtime and history clone.
- [x] Add focused no-Docker ownership, deadline, preservation and result tests;
  independently review before the first source-frozen targeted rehearsal.
- [x] Complete targeted feasibility with the original eleven capacity outcomes
  still required after the restore phase.
- [x] Complete fresh historical compatibility: seven native cases/83 SQL checks
  and two generic opening cases/29 checks across eras 187/188, with populated
  selected-schema restore, three timezones and both owned runtimes removed.
- [x] Complete repository checks: npm check passed 1,687 tests, all three
  TypeScript checks and the production build (four existing lint warnings and
  the existing chunk-size warning).
- [x] Complete fresh full ordinary compatibility with the explicit restore opt-in:
  166 canonical SQL suites/7,338 assertions, existing candidate/API probes, and
  the complete correction-capacity plus populated-restore proof passed. Its
  correction workload took 582.279 seconds; all 416 bound hashes matched and
  owned resources were removed.
- [x] Publish sanitized evidence with explicit private source-set bindings and
  independently review it.
- [ ] Complete PR and exact-head CI before Dave's specific merge approval.

The completed targeted rehearsal took 593.592 seconds within the shared workload
budget. It retained all eleven named capacity observations (seven accepted checks
and four refusals), 33 admitted writer batches, the actual 1,001st canonical event
and its opening refusals. The populated restore compared all 456 selected relations
and ran seven validations: both populated/restored databases in three timezones,
plus restored-session retirement with exact rollback. All 416 bound source hashes
and three private driver inputs matched; all owned containers and volumes were
removed. Independent review and 147 focused harness tests passed before the run.

The private observer covered 50 SQL stages across six immutable-target intervals;
sampled container/backend peaks were 268,330,598/124,870,656 bytes. These are sampled
rehearsal observations, not production benchmarks or guaranteed memory maxima.
The earlier reserve-guard refusal is excluded from completed acceptance. Fresh
ordinary/historical compatibility and repository checks have since passed.
Sanitized public evidence review, PR, exact-head CI and Dave's specific merge
approval remain pending.

The proof is SQL-only and synthetic. It does not prove physical post-backup
reconciliation, cluster-role recovery, Storage binary recovery, return/discrepancy
maxima, simultaneous maxima or production capacity. C1b assembly, C2 workflows and
Susan's physical count, SOP and practice-rule approval remain separate. No hosted
candidate installation or clinical/register activation occurs.
