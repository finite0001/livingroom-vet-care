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
  correction workload took 581.332 seconds; all 417 bound hashes matched and
  owned resources were removed.
- [x] Publish sanitized evidence with explicit private source-set bindings and
  independently review it.
- [x] Retain sanitized parent failure diagnostics with 15 focused privacy tests;
  repeat full ordinary and historical compatibility with the diagnostic patch.
  All 162 harness methods pass; all 253 historical source bindings match.
- [ ] Complete PR #285 and the next exact-head CI before Dave's specific merge
  approval.

The completed targeted rehearsal took 593.592 seconds within the shared workload
budget. It retained all eleven named capacity observations (seven accepted checks
and four refusals), 33 admitted writer batches, the actual 1,001st canonical event
and its opening refusals. The populated restore compared all 456 selected relations
and ran seven validations: both populated/restored databases in three timezones,
plus restored-session retirement with exact rollback. All 416 bound source hashes
and three private driver inputs matched; all owned containers and volumes were
removed. Independent review and 147 focused harness tests passed before that run. The
latest fresh runs have a distinct source set: only the parent runner changed and
one diagnostic helper was added. Workload, fixture and observer inputs remain
unchanged; the latest harness total is 162.

The private observer covered 50 SQL stages across six immutable-target intervals;
sampled container/backend peaks were 268,330,598/124,870,656 bytes. These are sampled
rehearsal observations, not production benchmarks or guaranteed memory maxima.
The earlier reserve-guard refusal is excluded from completed acceptance. Fresh
ordinary/historical compatibility and repository checks have since passed.
Sanitized public evidence review passed. PR #285, the next exact-head CI and
Dave's specific merge approval remain pending.

The first CI correction child exited nonzero after approximately 686 seconds;
its cause is unknown because its diagnostic was not retained in the CI artifact.
That failed run is excluded from acceptance. The parent now prints only sanitized failure classifications; raw child
diagnostics remain in protected local logs. The parent-only patch is covered
by 15 privacy tests. It changes no engine, fixture, 900-second workload deadline
or 120-second writer reserve. Fresh ordinary/historical passes include the patch;
CI has not yet passed it.

The second CI run confirmed a next-batch admission refusal at 928 completed
corrections, before restore began. The next target was 960; remaining time
210.895428161 seconds was below required 247.737407283 seconds, including the
unchanged 120-second reserve. Source preservation, clone cleanup and outer
owned-container/volume absence checks passed. The other three jobs passed. This
run is excluded from acceptance; the first run's cause remains unknown.

The third CI run put the whole database job on ARM but again refused 928→960
before restore: remaining 229.243710925 seconds was below required 243.556468959,
including the unchanged 120-second reserve. Source preservation, clone cleanup
and outer owned-resource absence checks passed; the other three jobs passed.
This ARM run is excluded from acceptance. The first CI cause remains unknown.

The original database job is restored to `ubuntu-latest`. Its exact two full
candidate and history commands now run in a separate native ARM `controlled-stock`
job with checkout and Supabase CLI 2.118.0 only. Python standard library and Docker
suffice; no Node/npm/browser or global foundation runtime starts in the new job.
All five jobs must pass. The original four jobs' other steps and runner labels
remain unchanged; a semantic YAML comparison verified exact command relocation.
The isolation removes known runtime overlap, without proving the underlying cause
or guaranteeing improved performance. Both standard public runner architectures
specify 4 vCPU, 16 GB RAM and 14 GB SSD with free public-repository usage.
No engine, Python, SQL, 900/120-second guards, batch-32 bound or safety factor of
two changed. The 417/253-file fresh source bindings exclude workflow YAML and
remain valid. The next actual five-job CI run is pending.

The proof is SQL-only and synthetic. It does not prove physical post-backup
reconciliation, cluster-role recovery, Storage binary recovery, return/discrepancy
maxima, simultaneous maxima or production capacity. C1b assembly, C2 workflows and
Susan's physical count, SOP and practice-rule approval remain separate. No hosted
candidate installation or clinical/register activation occurs.
