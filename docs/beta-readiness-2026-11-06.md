# Living Room Vet beta readiness audit — November 6, 2026

This is the initial audit snapshot. See the [subsequent remediation report](beta-remediation-2026-11-06.md) for fixes, owner decisions and new verification.

## Decision

**Do not treat the entire application as cleared for unrestricted beta.** The repository contains extensive implemented and tested workflows, and production metadata matches the audited source inventory. Staging is not equivalent, several automations are disabled, dependency advisories remain, and clinical/staff acceptance is unrecorded. A bounded beta needs a named environment, explicit feature scope, synthetic/approved records and recorded acceptance for that scope.

Audited baseline: `b8767ff2e560f23d884194b5e9f875c0c647532a`, fetched from `finite0001/livingroom-vet-care` on November 6. Changes are isolated on `audit/lrv-beta-readiness-20261106`. The team audited documentation, clinical integration, backend/deployment, dependencies and nonclinical workspaces, then independently reviewed the repairs. No hosted deployment, migration, provider activation, message, payment, clinical approval or PR merge was performed.

## Required decisions and follow-up

| Priority | Finding | Concrete next action |
| --- | --- | --- |
| Beta environment blocker | Staging has 204 of 209 migrations, lacks `invite-staff`, and scheduled workers lack Vault configuration. | Reconcile using the specialized controlled-drug rollout procedure; commission the intended test configuration and rehearse authenticated flows. Do not use a generic all-migrations push. |
| Acceptance blocker | Register contains 12 Pending clinical decisions and 8 Pending staff steps, with old pre-CloudTalk scope. | Susan/staff record decisions and exact-run evidence; include newer features from the feature map or explicitly exclude them. |
| Scope blocker | Operational-task and invoice-reminder cron jobs are inactive on both targets; production attachment cleanup is intentionally disabled. | Decide whether each is in beta. If included, commission and verify actual outcomes with appropriate provider gates. |
| Security work | npm audit reports 18 advisories (6 high, 12 moderate); omit-dev reports 8 (4 high, 4 moderate). | Review patched dependencies, Zod migration and exact-candidate proof regeneration. The report distinguishes install presence from demonstrated runtime exposure. |
| Evidence gap | Current local controlled installation rehearsal timed out; owned cleanup succeeded. | Repeat on an appropriately resourced owned runtime without weakening the proof bounds. Existing 19-job forward CI success proves the merged baseline, not all audit changes. |
| Operational limitation | Safe admin corrections to open shifts require a transactional RPC sharing the clock-in/out lock. | Beta UI permits conditional edits/deletes of already-closed shifts only; staff must clock out first. Plan atomic open-shift correction separately. |
| Owner copy decision | Public housecall target still says Late October 2026 and emergency contact is unconfigured. | Confirm current opening targets and emergency guidance; no date was invented during this audit. |

## Repairs delivered

- Record sharing refreshes its source lists after confirmed clinical changes across SOAP, problems, dental/anesthesia/care charts, certificates/treatments, patient details and weights. Frozen review evidence remains retained; merely reloading an unchanged note does not revoke review.
- Corrected obsolete diagnostic PDF sharing guidance.
- Corrected Denver dashboard time-window totals and restricted unsafe administrator time corrections. Failed timesheet reads now show an unavailable/retry state and withhold totals and CSV export (see workspace report for exact behavior and tests).
- Contact-page entrance animations no longer create mobile horizontal scrolling; verified at 320, 390, 768 and 1440 CSS pixels before and after scrolling.
- Updated active documentation and added a 25-area feature/scenario map; preserved historical receipts and pending human decisions.
- Repaired Hub readiness checks for the current inquiry, scheduling-editor and daily-communications structure. They now reject old, failed, wrong-project, inactive or incorrectly authenticated hosted evidence, and explicitly disclose their three-workflow static scope.
- Schema inventory selects and records the intended project instead of silently inspecting a developer's local link.
- Browser fixtures use configured origins; separate test ports avoid another local application's port 8080 while retaining external-network blocking.

## Verification ledger

Final command outcomes are recorded in the [verification artifact](evidence/beta-verification-2026-11-06.json), including source hashes and the distinction between full and focused runs. Frontend browser scenarios predominantly use mocked HTTP; they establish UI/adapter behavior, not deployed database/provider acceptance.

- Full final lint/typecheck/unit/build check passed: 2,789 tests passed, zero failed or skipped. Seven existing Fast Refresh warnings and large-chunk build warnings remain.
- Full browser run: 603 passed, one skipped for the disabled CloudTalk UI flag, and one failed because the run loaded an earlier new-test label assertion. Current clinical focused run passed all three scenarios, including that corrected assertion and unchanged-note reload. Three new time-clock scenarios passed separately. The flag-enabled CloudTalk check passed after correcting its outdated GET-only assertion to allow the specific read-only HEAD count. Deduplicating these runs against the current manifest gives 608 of 608 scenarios passed; this was not a single clean full-suite run. Runs used zero retries, 60-second test/15-second assertion bounds, three full-run workers and one focused-run worker.
- Edge checks: all entrypoints and additional CI targets passed with committed Deno lock; seven isolation harnesses passed.
- Controlled installation controls: 116 Python and two CLI framing tests passed. Local full installation rehearsal did not pass its fixed deadline; cleanup passed.
- Scanner: 16 built-worker/simulated-camera checks passed, including local WASM integrity, restricted CSP, cancellation, permission denial and late-track cleanup. This does not prove actual iPhone/supplier-label acceptance.
- Public hosted read-only smoke: homepage, contact, login and protected-route redirect returned 200 at mobile/desktop widths with no page exceptions. GitHub production deployment metadata identifies the audited baseline SHA. No authenticated hosted workflow was executed.
- Documentation: final file-target scan covered README and all 306 docs Markdown files (307 total), with zero broken relative file targets. Code blocks, anchors and external URLs are excluded; this is not a claim that every historical document is current.

## Evidence and detailed workstreams

- [Documentation and 25-area feature map](beta-readiness-documentation-2026-11-06.md)
- [Clinical wiring and regression](beta-readiness-clinical-2026-11-06.md)
- [Backend, staging gaps and test boundaries](beta-readiness-backend-2026-11-06.md)
- [Nonclinical workspace wiring and time-clock fixes](beta-readiness-workspace-2026-11-06.md)
- [Dependencies and repair acceptance](beta-readiness-dependencies-2026-11-06.md)
- [Final verification and source hashes](evidence/beta-verification-2026-11-06.json)
- [Hosted migrations/functions/JWT metadata](evidence/beta-hosted-metadata-2026-11-06.json)
- [Scheduler and catalog metadata](evidence/beta-backend-runtime-metadata-2026-11-06.json)
- [Local installation timeout/cleanup receipt](evidence/beta-local-installation-2026-11-06.json)
- [Public browser and contact layout observations](evidence/beta-public-browser-2026-11-06.json)

Version/name parity does not prove SQL or deployed-bundle equality. Enabled RLS/search_path controls do not prove every permission predicate. Worker HTTP 200 does not establish provider delivery or live-payment readiness. Historical-206 CI and current-209 forward proof are distinct. Physical stock, clinician decisions, device testing, vendor commissioning, restore ownership and live-provider acceptance require their own scoped evidence.
