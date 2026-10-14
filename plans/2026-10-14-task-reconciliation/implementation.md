# 4C implementation and acceptance

## Service boundary and policy

Current backend checkpoint: local migration185, four private policy/run/result/cursor tables, service-only start/execute/recover, typed reviewed policy/recovery/read contracts and a transactional revision counter are implemented. [Evidence](../../docs/launch-evidence/2026-10-14-task-reconciliation-backend-local.json):151 SQL suites/6,257 assertions (73 package),42 actual API checks,4 observed lock queues, exact populated4-table restore,1,445 units and preserved parent staff task workflow. Hosted backends remain184. The earlier protocol-only checkpoint below is historical.

October14 checkpoint: shared Zod request/receipt contracts and a default-off service handler pass47 boundary counterexamples and the full repository check with1,442 units. [Receipt](../../docs/launch-evidence/2026-10-14-task-reconciliation-contract-local.json). This is unit-level protocol evidence, not a deployed worker or genuine database reconciliation. No additive migration or Edge entrypoint exists yet. Engineering ceilings are25 sources,256 task fan-out and5,000ms per batch; the current request default is5 sources. Final captured fan-out/budget values still need measured SQL fixtures and timeout proof before publication.

Use the existing reviewed operational action protocol for a separate reconciliation-policy operation, preserving exact actor/session/UUID recovery. Keep the template-generation policy independent. Service run receipts must match the shared contract, including frozen policy/window/sweep/cursor/request metadata across start, execute and recover. Lost acknowledgments only read recovery; another scheduled attempt must resume the original unresolved request before creating a successor. A successful HTTP acknowledgement is not a committed run result.

Add private immutable run requests/results, a durable cursor head and append-only policy. Reconciliation defaults off; template generation remains its independent reviewed policy. Staff DVM/ADMIN policy review uses a live matched session and exact actor/version/action receipt. Do not infer activation from migration, cron registration or template publication.

A dedicated service RPC validates service identity, exact run UUID and bounded request. It takes schedule73260123 → care → run/source/task locks and rechecks gates after waiting. Materializers remain private. Workers never assert room use or checklist completion. Read-only recovery returns the stored result before changed-state validation. Another request cannot reuse a run UUID; completed or failed runs never execute again.

Use existing canonical worker authentication and safe error mapping. Missing/false environment gate returns disabled before a database client is created. Database activation gates dispatch before Vault/HTTP. Register the job/cadence explicitly in scheduler CHECK, dispatcher whitelist, cadence projection, cron and Operations enum. Cron stays inactive until commissioning. Do not alter delivery, payment or unrelated worker settings.

## Bounded sweep

Prefer two explicit cursor lanes over extending the appointment-only staff reconciler:

1. Reviewed-window appointments plus sources with unresolved existing tasks.
2. Actual-use IDs independent of appointment date, including open/unfinished use, uncovered ended use and corrected use versions formerly covered by completed work.

Persist a sweep boundary and opaque `(kind,id)` continuation. Each batch resumes exactly its stored checkpoint; successful task changes and checkpoint/result commit atomically. Reset after a completed sweep so changes behind the cursor are revisited. Never retrieve every use underneath one appointment page. Use a bounded source count, template/task fan-out guard and transaction timeout; exceedance records an explicit unresolved outcome without falsely claiming a complete sweep. Final caps follow measured native fixtures rather than unapproved practice defaults.

The current materializer processes all matching rules and task heads for one source. Measure and bound that fan-out before claiming a batch bounded. Preserve frozen rules and completed history. Reconciliation while new generation is off still repairs existing safety obligations, but creates no new ordinary enrollment. Use the reviewed activation interval to prevent silent historical backfill.

If a subtransaction fails, roll back its task/cursor changes before recording a terminal safe failure. Unknown acknowledgments recover or retry the same run unchanged; never create a second run to hide an unresolved original. Scheduler HTTP acknowledgement remains distinct from committed run outcome. A stopped sweep exposes a recoverable checkpoint, not a “done” label.

## Staff visibility

Operations displays run ID, effective limits/window, checkpoint, examined/generated/revised/unresolved counts, timestamp and committed outcome. Missing or unconfirmed results retain unknown counts. Include the job’s actual cadence. No source snapshots, patient/contact names or checklist text in worker responses or scheduler payloads. Existing authenticated task screens remain the detailed operational view.

## Required proof

- Default-off handler makes no database/provider request; wrong environment/key/body/method fails. An explicitly bad API key cannot use bearer fallback.
- Direct table/helper writes remain denied. Service cannot use staff room-use/completion APIs; staff/anon cannot invoke service reconciliation.
- Old appointments with current actual-use evidence are examined. A use behind a completed cursor is revisited on the next sweep. Cross-day/DST facts retain original reviewed rules.
- Repeat start/execute/recover and lost committed acknowledgments yield one result and one checkpoint. Reused UUID with changed parameters fails. Failure rolls back work before its failure receipt.
- Observe real locks for schedule/care/policy races. Pause or role/eligibility changes after waiting obey current state. Reconciliation cannot reopen completed work or erase correction obligations.
- Bound total sources, actual-use processing, fan-out and transaction duration. Prove large-backlog pagination and explicit partial/failure state.
- Keep stock movements, source clinical records and outbox/provider baselines unchanged. Restore populated policy/cursor/requests/results alongside all184 task relations and prove ACL/recovery.
- Run relevant Zod/handler units, real Auth/PostgREST/browser tests, canonical SQL, `npm run check` and exact-head CI. Apply to staging first, run genuine bounded acceptance and canonical cleanup, then primary rollback-only acceptance. Deploy only the new Edge function, with gates disabled, before merge-triggered UI rollout. Verify exact production merge/domain and package gates.

Continue supplier/barcode/controlled-drug, billing/production/financing, reviewed clinical assistance and actual vendor/device integration packages afterward. All45 requirements and Susan’s acceptance remain required.
