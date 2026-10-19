# Genuine opening correction-history capacity

Base: PR #283. Canonical migration count remains 204. This batch tests one
previously unproved source-history family in the isolated local candidate. It
does not change supported limits or authorize clinical/register activation.

## Scope

Create one genuine dispense and append operational annotations through the actual
canonical preview and correction RPCs. Preserve every original event, operation,
source-provenance row, sequence, predecessor and receipt. No direct event inserts,
disabled canonical-history triggers, manufactured provenance or shared-to-exclusive
lock bypass. Any privileged opening-row fault injection must be explicitly labeled
and roll back both relation data and its exact original trigger/manifest state.

Keep correction history separate from return and discrepancy history. Passing this
batch must not be described as proving 1,000 events in every family, simultaneous
maximum allocations/dispenses/history, a valid 1 MiB opening or production capacity.

## Staged feasibility gate

- [x] Use a uniquely owned local runtime and UUID-marked disposable database;
  verify exact Docker project/workdir labels and database markers before queries
  or cleanup. Leave unrelated runtimes untouched.
- [x] Commit canonical writers before entering exclusive configuration. Resume
  increasing history at 64, 128, 256, 512 and 1,000 annotations, with no more than
  32 genuine appends per fresh backend. Do not treat retained backend state as a
  new run.
- [x] Share one 900-second workload deadline across setup, canonical writers,
  validation and source/manifest checks. Safety cleanup may run afterward but is
  mandatory for success. Recompute the remaining SQL timeout after ownership
  checks, and reject SQL results returned after their applicable deadline.
- [x] Admit only the next batch of at most 32 canonical appends. From a completed
  measured writer interval, forecast that next batch using cubic incremental
  work multiplied by two, plus a 120-second validation reserve. The next batch
  must fit strictly inside the remaining budget; equality refuses. Enforce the
  reserve with the actual writer deadline at global deadline minus 120 seconds,
  rather than relying only on a forecast. The first batch is explicitly labeled
  calibration, without a manufactured cost estimate. A final 992→1,000 batch may
  contain eight appends; event 1,001 requires the valid positive opening first.
- [x] Keep the full 1,000-event forecast diagnostic/unknown, not an admission
  requirement or proof. The preceding full-goal cubic forecast refused at 256;
  the separately frozen 512-only diagnostic completed and supplied another real
  measurement. This policy does not fit favorable coefficients, reduce the
  factor/reserve, or alter product checks: it bounds one next batch with a hard
  deadline. It can still stop partially and must then produce no capacity PASS.
- [x] Fail closed on missing/contradictory stage evidence, ownership failure or
  exhausted budget. Retain private failure diagnostics and always attempt exact
  owned cleanup. Do not bypass constraints or add unreviewed function changes to
  force the large fixture to pass.
- [x] Run the targeted feasibility probe before making it mandatory in the full
  ordinary runner or CI. Root review must approve that integration after a full
  passing source-bound result. The reviewed integration uses
  `--include-correction-capacity`; CI now invokes that flag. Fresh full runs pass;
  exact-head CI remains pending.

## Full acceptance, after feasibility

- [x] Independently verify exactly 1,000 genuine correction events and operations,
  the complete ordered chain, exact head identity/version/hash, and original
  dispense/allocation/movement quantities and provenance.
- [x] Treat exact replay as a new canonical writer admission in its fresh
  transaction. Require exactly one expected admission row, with all prior row
  values retained exactly and all other relation fingerprints unchanged. Compare
  checkpoint 1,000 against the full private before-replay fingerprint, and the
  post-configuration rollback against the full after-replay fingerprint. Keep
  both complete snapshots private; do not omit or normalize the audit table.
- [x] Construct a synthetic, frozen and unattached opening retaining correction
  head 1,000. Validate its complete boundary, product projections and immediate
  deferred constraints. Preserve source rows and all ten canonical writer bodies.
- [x] Roll back configuration before the next canonical write. Create event 1,001
  through the real writer, then prove that selectors 0 and 1,000 cannot hide the
  oversized actual history. Require the intended no-truncation guard and exact
  relation/manifest rollback for each rejection.
- [x] Preserve separate counts for checkpoint execution, positive assertions,
  refusals and genuine source events. Bind all executed SQL/Python inputs, record
  actual image/content pins, and verify owned database/container/volume cleanup.
- [x] Add focused no-Docker tests for ownership, result validation and budget
  gates in `supabase/tests/test_correction_capacity_harness.py`, discovered by
  the existing CI harness step. All 120 harness tests pass, including 59 correction
  tests; independent source and integration reviews are clear.
- [x] Complete repository checks: `npm run check` passes 1,687 tests, all three
  TypeScript projects and the build. Four existing lint warnings and the existing
  bundle chunk warning remain; no new failure is waived.
- [x] Run fresh full ordinary and historical compatibility, including the new
  correction-capacity probe in the ordinary run, and independently verify source
  hashes, complete replay fingerprints and exact-label resource absence.
- [x] Finish sanitized public evidence and its independent review. Counts,
  source bindings, image pins, privacy and scope match the retained local proofs.
- [ ] Prepare a PR and complete exact-head CI. Obtain Dave's explicit approval
  for that PR before merge/release.

Populated restore of the 1,000-correction opening is **not included** in this
batch. It remains separate acceptance work if later added; this proof makes no
physical-history, cluster-role or Storage binary recovery claim.

## Completed targeted proof

The source-bound targeted run completed its workload in 515.053 seconds inside
the unchanged 900-second budget. Its eleven named observations comprise seven
accepted assertions and four refusals. It validated the genuine 1,000-event
opening, exact canonical replay with its single audited admission append, and
the genuine 1,001st event followed by both no-truncation refusals. All 456 relation
fingerprints remain represented, and all 414 bound source hashes matched.

Maximum sampled container memory was 239,075,328 bytes; maximum observed backend
RSS was 122,548,224 bytes. No query cancellation, emergency stop or monitor error
occurred. The observer closed before clone cleanup, and independent checks found
no owned containers or volumes remaining. These are local diagnostic observations,
not production workload measurements or capacity approval.

Earlier parser failures, conservative forecast stops, the separately bounded
512-only diagnostics, the rejected input-hash attempt and the replay-baseline
failure are excluded from successful capacity coverage. No clinical/register
activation occurred.

## Completed fresh local acceptance

The full ordinary run passes 166 canonical SQL suites / 7,338 assertions, the
existing candidate probes, and the new correction workload in 581.646 seconds.
Its eleven correction observations remain seven accepted assertions and four
refusals. All 33 next-batch admissions and completed samples were independently
recomputed; the final eight-write batch and separate event 1,001 remain explicit.
The full 456-relation replay snapshots prove the exact admission count change
33→34 and no other relation change. All 414 source hashes match. Genuine local
Auth/PostgREST acceptance passes 133 combined response/setup/state/cleanup checks
with eight observed queues; 133 is not an HTTP request count. Exact project-label
checks independently find no owned containers or volumes.

The fresh historical run retains seven native cases / 83 checks and two generic
available-only openings / 29 checks, including six focused refusals. All 250 source
hashes match. Original 187 history remains 63 relations / 50 rows; 188 remains
66 / 122. Both selected-schema populated generic-opening restores preserve all
456 relation fingerprints and validate without caller claims under UTC,
America/Denver and Asia/Kathmandu. Those restores do not include the new
1,000-correction opening. Both historical runtimes have independently verified
empty container and volume lists. Sanitized evidence review, PR and exact-head CI
remain pending.

## Limits

Existing fail-closed exception behavior remains. This work supplies no real
product configuration, physical count, clinical policy, collection authority or
SOP. Return/discrepancy lifecycle maxima, combined-maxima stress, physical history
after backup, C1b production assembly and C2/C3 remain separate. Susan's actual
configuration, count, SOP and practice-rule approval remain pending.
