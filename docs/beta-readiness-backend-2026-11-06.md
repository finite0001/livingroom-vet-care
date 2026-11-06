# Backend beta audit — 6 November 2026

Audited base: `b8767ff2e560f23d884194b5e9f875c0c647532a` from freshly fetched `origin/main`. Hosted observations were read-only; this audit did not deploy functions, change database objects, enable jobs, invoke sending/payment/cleanup workers, or read secret values.

## Findings that affect beta scope

| Finding | Evidence | Beta consequence |
| --- | --- | --- |
| Production migration **version inventory** matches all 209 repository files; all 56 local Edge entrypoints are ACTIVE with matching JWT configuration | [Hosted inventory](evidence/beta-hosted-metadata-2026-11-06.json) | The old assumption that the three forward narcotics migrations are absent is no longer valid. Version presence does not prove stored SQL equality or clinical acceptance. |
| Staging contains 204 migrations and 55 functions | Same inventory | Staging lacks `20261020151157`, `20261022010000`, `20261027223535`, `20261027223544`, `20261028170038`, and `invite-staff`. It cannot reproduce the current controlled-stock/review/count/register workflows or staff invitation flow. |
| Staging scheduler cannot dispatch | [Runtime metadata](evidence/beta-backend-runtime-metadata-2026-11-06.json) | All five original scheduled workers report `configuration_missing`; a names-only query confirms both `project_url` and `scheduler_worker_key` are absent from Vault. Do not claim automated staging round trips passed. |
| Invoice-reminder and operational-task-reconciliation cron jobs are inactive in both projects | Runtime metadata, `cron.job` flags | These automations are implemented but not running on their schedules. Either exclude them from beta promises or commission and verify them explicitly. |
| Production attachment cleanup is deliberately disabled | Four retained scheduler responses in the two-hour window returned HTTP 503 and the exact whitelisted error `Attachment cleanup is disabled` | Automatic abandoned-upload housekeeping is unavailable. This is a feature gate, not evidence of an outage or deletion failure. |
| Existing production scheduler transport is working for other original workers | Settled two-hour sample: outbox, inbound and Stripe 118 HTTP 200 receipts each; reminder queue 7 HTTP 200 receipts | HTTP 200 can mean disabled/no-op or empty work. It does not establish delivery, Stripe live readiness, or enabled reminder policies. |

The observation artifacts record UTC capture times and exact scopes. No schema or provider state was inferred from old memory notes.

## Security and wiring checks

- Current production and staging catalogs show no ordinary public table with RLS disabled and no public `SECURITY DEFINER` function without an explicit `search_path`. This verifies presence of those controls, not correctness of every RLS predicate or RPC permission.
- Neither catalog contains a public function with a literal `errcode = '40001'` or `errcode = '40P01'` raise. The earlier permanent-condition retry-loop fix remains present for this scan. Dynamic SQL and nonliteral error paths are outside this check.
- All **182 distinct literal `.rpc("name", …)` names** discovered in frontend and Edge source exist in production's public function inventory. Typed/dynamic wrappers and runtime argument semantics still require their behavioral tests.
- Staff bootstrap was traced to `20260919120000_new_auth_users_inactive.sql`: new Auth users receive an inactive profile and no `user_roles` row. Invitation access checks the live user plus active administrator status; invitation alone does not grant active staff access.
- Worker entrypoints use `_shared/worker-auth.ts`, checking an exact configured managed secret key (or configured legacy credential), rather than trusting a decoded JWT role. Explicit invalid `apikey` input cannot fall back to another credential.
- Reminder automation uses `queue-reminders` → durable run receipt → `queue_due_reminders` → `communication_outbox` → `dispatch-outbox`; final provider-attempt preflight rechecks source/actor/consent/policy eligibility. The old `outbound_deliveries` appointment path is retired, so absence of a schedule for `dispatch-outbound-deliveries` is not a missing canonical reminder link.
- Payment runtime keeps collection, refund, webhook and event-processing gates separate. Outbound delivery keeps environment, mode, recipient allowlist, and consent checks separate. This audit did not enable or exercise live providers.
- Supabase function deployment configuration matched `supabase/config.toml` for every deployed function in both environments; the legacy retired send functions were absent.

## Verification

| Check | Result and scope |
| --- | --- |
| `deno check --frozen supabase/functions/*/index.ts` plus the four additional CI entrypoints | Passed using Deno 2.9.7 and committed dependency lock; CI currently pins 2.9.6. |
| Seven `scripts/verify-*-edge-isolation.py` programs from CI | Passed: invoice, all eight diagnostic-record consumers, patient photos, diagnostic PDF, operational reconciliation, invoice reminders, and clinical audio/template/recap/call consumers. These bundle with isolated function dependencies rather than relying on root `node_modules`. |
| `python3 -B -m unittest discover -s scripts/narcotics-log -p 'test_*.py'` | 116 tests passed. |
| `node --test scripts/narcotics-log/frame-cli.test.mjs` | 2 tests passed. |
| Official CLI framing and `install_rehearsal.py --check-source` | Passed; exact 28-source admission, no database operation for source check. |
| Fresh owned local 206→208 installation rehearsal | **Not passed:** the official CLI command exceeded the unchanged 30-second owner deadline during `20261027223544`. Its output reported the migration applied, but timely completion and final proof checks were not established. Total run 311.34 seconds; normal owned cleanup and source rechecks passed. [Sanitized result](evidence/beta-local-installation-2026-11-06.json). No budget was relaxed. |
| Schema inventory project-selection regression tests | 3 passed: configured application target, explicit staging target, invalid-target refusal. |
| General GitHub CI at exact audited main | [Run 41225168240](https://github.com/finite0001/livingroom-vet-care/actions/runs/41225168240) passed. Its database, controlled-stock and renderer jobs deliberately materialize historical application commit `217a8e97bb32bdaafc555b16a196450a57a5d1bd` with 206 migrations. These are historical regression evidence, not current-209 acceptance. |
| Dedicated forward workflow for merged parent `0da567533c8877b21cf4fbe141b6c1bf3f20492c` | [Run 41219936379](https://github.com/finite0001/livingroom-vet-care/actions/runs/41219936379) passed all 19 jobs, including the 12 genuine-business profiles, forward and authored-history installation, authenticated operational browser, populated recovery, and rollback proof. No failed job steps were hidden by `continue-on-error` in that run. This evidence applies to the merged base, not untested changes made later in this audit. |

A direct attempt to run the historical `supabase/tests/test_*_harness.py` collection in the current 209-file checkout produced 23 failures and 10 errors among 380 tests, principally exact historical-source inventory refusals. It was not treated as an application regression or as passing evidence. CI's pinned historical view is the correct context for that collection; changing its assertions merely to accept current files would invalidate its proof boundary.

## Corrected audit tooling

`scripts/supabase-schema-inventory.mjs` previously ran an unqualified `--linked` dump and emitted no inspected project reference. A developer's local Supabase link could therefore be used as evidence for the wrong environment. It now selects a validated `SUPABASE_PROJECT_REF` override or the application `project_id` from `supabase/config.toml`, passes that exact reference to `db dump`, and writes `projectRef` into the artifact. Three subprocess regression tests verify the actual CLI arguments, including a deliberately conflicting legacy local link. No hosted dump was needed for the regression tests.

## Independently verified time-clock race and beta mitigation

The old administrator hook committed an open `time_entries` close/delete before a separate `profiles.is_on_duty=false` PATCH. A staff member could clock in between those requests. The delayed administrator PATCH then overwrote the new shift's duty flag. Failure between the requests could also leave inconsistent state.

Fresh production catalog inspection found only the self-scoped `clock_in()` and `clock_out()` RPCs, no administrator time-entry/shift RPC, and an audit-only trigger on `time_entries`. `protect_profile_privileges()` returns early for administrators. `time_entries` has no `updated_at` column. An isolated PostgreSQL 17 reproduction used the exact inspected function definitions with minimal synthetic tables and auth/role helpers; the ordered sequence **admin closes old entry → staff clocks in → admin duty PATCH** produced `{"open_shifts":1,"is_on_duty":false}`. The owned container was removed. This is a deterministic database reproduction, not a full application/Auth/RLS acceptance run; the production catalog separately confirms administrator UPDATE/DELETE policies.

The beta mitigation in `src/hub/features/time-clock/admin-time-entry.ts` restricts corrections and deletion to already-closed entries. Each request matches the original entry ID, staff ID, clock-in, clock-out and note, with an explicit database-side non-null clock-out predicate. It rejects stale/no-op responses and never patches duty status. The administrator UI tells staff to clock out first and disables open-shift correction/deletion. Independent review found this sufficient to remove the two-request race from the updated UI.

**Remaining backend boundary:** administrator RLS still permits direct entry edits and the profile trigger still exempts administrators. Older or custom clients can therefore bypass the new UI restriction. A complete repair requires transactional administrator RPCs, expected-row checks, consistent per-staff locking shared with self clock-in/out, and appropriate direct-write restrictions. No migration or permission change was made in this audit.

## Remaining acceptance boundary

For the beta environment, reconcile staging migrations and function inventory, commission the staging scheduler only with the intended provider gates, and record actual authenticated end-to-end results. Explicitly decide whether disabled automations and cleanup are included. Verify deployed bundle/source equivalence, role-specific negative paths, real device audio/scanning, external providers and clinical sign-offs separately. A repository test pass or an ACTIVE function listing cannot substitute for those observations.
