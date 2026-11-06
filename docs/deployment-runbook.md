# Living Room Vet deployment runbook

Current procedure reviewed against repository baseline `b8767ff2e560f23d884194b5e9f875c0c647532a` on November 6, 2026. This is a release procedure, not evidence that a release has passed. For feature coverage and outstanding acceptance, see the [beta documentation map](beta-readiness-documentation-2026-11-06.md).

## Targets and prerequisites

| Target | Identity | Use |
| --- | --- | --- |
| Production | Supabase `mgadheotkdnrsatfivjy`; Vercel `livingroom-vet-care`; `thelivingroom.vet` | Approved production release only |
| Staging | Supabase `kothoqicubowyhwfsrte` | Candidate verification before production |
| Legacy Lovable | `ugpyjacqganaqtsiekay` | Retained history; not a deployment target |
| Local disposable | Explicitly owned local database and synthetic values | Tests, restore rehearsal and failure/recovery checks |

Use the npm lockfile and Node 22.12 or newer. Work from an isolated checkout of the exact release SHA; fetch before choosing it, then keep it pinned while verifying and deploying. Preserve ignored configuration and secrets. Staff/browser configuration contains only the public allowlisted values in [deployment-environment.md](deployment-environment.md). Provider and service credentials belong in the selected Supabase secret store.

Agents prepare and verify reviewed PRs; Dave authorizes merging a specific PR. Source merge, database installation, Edge deployment, frontend publication and provider activation are separate events. Record each with its SHA, target, operator and UTC time.

## 1. Establish the actual target state

Before planning writes, capture the current migration ledger, relevant schema/grants, deployed Edge source and JWT settings, frontend deployment SHA/backend, scheduler receipts and configuration presence. Inspect secret names or safe digests, never secret values. Compare both staging and production to the release candidate; an ACTIVE function listing alone does not prove matching behavior.

The source baseline has 209 migrations and 56 Edge `index.ts` entrypoints. The [October 30 hosted receipt](controlled-drugs/narcotics-hosted-ledger-audit-columns-20261030.md) records original migration 205 installed, migration 206 rolled back, and 207–209 not run. The [November 6 hosted metadata](evidence/beta-hosted-metadata-2026-11-06.json) supersedes that prefix observation: production lists all 209 repository versions and 56 active function slugs; staging lists 204 versions and 55 slugs, missing migrations 205–209 and `invite-staff`. Matching version/slug/JWT metadata does not establish SQL/bundle equality or business-workflow success. Neither old counts nor a successful frontend deploy establishes full parity.

The [November 6 runtime metadata](evidence/beta-backend-runtime-metadata-2026-11-06.json) found staging missing both scheduler Vault names, with settled workers reporting `configuration_missing`; production attachment cleanup had four HTTP 503 outcomes in the observed two-hour window, explicitly saying “Attachment cleanup is disabled.” This is an intentional feature gate, not evidence of an unexplained worker outage. Operational-task reconciliation and invoice-reminder cron jobs were inactive on both projects. Resolve or explicitly exclude the affected beta workflows, then verify fresh outcomes. Successful HTTP transport for other workers is not proof of completed business work.

**Narcotics release boundary:** follow the [narcotics release sequence](controlled-drugs/narcotics-release-sequence-20261028.md) and reviewed hosted-source assembly. Do not substitute a generic `supabase db push` from the normal migration directory, rewrite migration receipts, or reinstall 205. The specialized 206/207 source and receipt checks are part of the release contract.

For general inventory, the `supabase:migration-drift`, `supabase:functions-inventory`, `supabase:functions-review`, and `supabase:schema-inventory` package scripts document existing inspection paths. Inspect their selected target/output before execution. A generic migration dry run does not validate the specialized narcotics release directory.

## 2. Verify the candidate locally and in CI

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` includes lint, application/config/renderer TypeScript, Node tests and a production build. The browser suite uses synthetic backend responses; it is not real hosted staff or provider acceptance. Check the Playwright server configuration and use a free port so an existing server cannot supply the wrong app.

Read `.github/workflows/ci.yml` for the exact checks. At this baseline the database job is named **Historical 206 database regressions** and prepares an archived canonical-206 checkout. Its success does not prove migration 207–209 business workflows on the current candidate. Include the current narcotics installation, real-Auth, browser, contention and restore proof required by its release sequence. Edge typechecking and isolated dependency tests are separate from frontend TypeScript.

Capture failures and unresolved skips; do not replace a failing workload with a diagnostic-only run and report it as acceptance. Use isolated synthetic databases for write tests. A hosted production audit should remain read-only unless a separately authorized rehearsal/release specifies the exact records and cleanup.

## 3. Stage and verify backend changes

Confirm backup/recovery access and rehearse the exact candidate installation before hosted writes. Apply reviewed migrations in dependency order on staging first. Preserve historical clinical data, private files, grants and original ledger receipts. Deploy only the matching changed Edge functions, with the `verify_jwt` settings from `supabase/config.toml` and the relevant worker authentication contract.

Before advancing, exercise the candidate's authenticated staff calls, denial paths, stale/replayed requests, lost-response recovery, files and scheduler outcomes. Missing provider configuration must produce the intended unavailable/disabled state. Do not enable provider flags, clinical processing or narcotics opening stock as a side effect of installation.

The [environment manifest](environment-manifest.md), [scheduler verification](scheduler.md), [service-worker authentication](service-worker-authentication.md) and each feature's rollout receipt describe separate prerequisites. Delete obsolete hosted functions only after confirming their retirement and absence of callers; do not redeploy deleted `send-email`, `send-sms`, `send-provider-email` or `suggest-replies` source from old snapshots.

## 4. Release and verify the frontend

Vercel uses `npm ci --ignore-scripts`, `npm run build:deployment` and `dist`. Production must select `mgadheotkdnrsatfivjy`; previews must use separately verified staging. Preserve the six reviewed public variables and the guarded build described in [deployment-environment.md](deployment-environment.md).

Once the required backend is verified and the specific PR merge is authorized, verify the resulting Vercel deployment against that exact merged SHA. Test public pages, `/hub/login`, password recovery, protected-route denial, authenticated feature entry points, account switching and mobile layouts. Check schema-dependent panels and explicit unavailable states. A public HTTP 200 does not prove an authenticated workflow.

Record frontend revision, database prefix, Edge source and configuration together. If a frontend regression requires rollback, select the previous compatible frontend deployment; preserve clinical history and migration receipts. Follow feature-specific recovery procedures for backend failures rather than deleting rows or reversing append-only clinical history.

## 5. Beta and provider acceptance

Use synthetic/local or explicitly bounded staging records for engineering beta scenarios. Record the tested role, environment, revision, feature flag, steps, expected result, actual result and recovery outcome. Complete the [clinical/staff register](clinical-staff-acceptance-register.json) with actual reviewer decisions; no automated check can supply them. The [beta feature map](beta-readiness-documentation-2026-11-06.md) extends coverage to newer features.

CloudTalk is the selected SMS provider; Resend sends email, AgentMail receives client replies, and Fastmail remains staff mail. Ongoing ezyVet integration is not a standalone launch requirement. Antech/other automatic diagnostics, clinical AI/audio processing, Stripe live payments and narcotics clinic operation each require their own commissioning evidence. Preserve disabled/test gates until their explicit activation criteria are met.

Before real practice use, resolve emergency-contact guidance and the elapsed housecall target, staff/clinical acceptance, current provider round trips, backup restoration and alert ownership. See the [owner action checklist](launch-owner-action-checklist.md).

## Monitoring and evidence

The `health` Edge Function is a public liveness probe:

```text
https://<project-ref>.supabase.co/functions/v1/health
```

GET/HEAD return 200 with an `ok` status when the function can query the database, or 503 with an `unavailable` status; other methods return 405. It intentionally reveals no internal failure reason. Its 200 does not prove provider, scheduler or staff-workflow health. Review those in `/hub/admin/operations` and the [read-only scheduler check](scheduler.md#verify-read-only).

Store dated sanitized release receipts under `docs/launch-evidence/`. Preserve older receipts as history. The [September go-live archive](go-live-runbook-2026-09.md), [September 26 repair receipt](launch-evidence/2026-09-26-hosted-repair-deployment.md) and [October 1 linkage rollout](launch-evidence/2026-10-01-linkage-audit-rollout.md) explain prior releases; they are not fresh target-state observations.
