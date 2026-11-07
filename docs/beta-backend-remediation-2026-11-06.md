# Backend beta remediation — November 6, 2026

Staging (`kothoqicubowyhwfsrte`) now has the missing `invite-staff` function,
working Vault-backed worker authentication, and active task/invoice schedules.
Production (`mgadheotkdnrsatfivjy`) received two explicitly reviewed repairs:
`password_hibp_enabled=false → true` and the authenticated cleanup preview.
Every other Auth setting was unchanged. Cleanup remains disabled; the previously
absent gate was made explicitly false and its preview grace set to 168 hours.
Production schema, provider delivery gates, schedulers and stored clinical
records were not changed.
The retained legacy project was not used. No provider message, payment, or
cleanup attachment deletion was executed. Owned synthetic renderer objects were
removed during their bounded staging acceptance cleanup.

The [sanitized staging receipt](evidence/beta-staging-automation-2026-11-06.json)
records UTC observation times, exact bounded run identities, configuration gates,
and successful/limited outcomes. This supplements the earlier
[backend audit](beta-readiness-backend-2026-11-06.md); it does not replace historical
installation evidence or clinical staff sign-off.

## Completed staging remediation

- Deployed `invite-staff`, version 1, ACTIVE, JWT verification enabled. The
  unauthenticated request returns 401. No staff invitation was sent.
- Compared the seven downloaded scheduler bundles against source: all 54
  TypeScript files matched; three Deno configuration files reflected the
  separately reviewed dependency update. Downloading used an isolated directory.
- Created the previously absent Vault `project_url` and `scheduler_worker_key`
  at **22:07:25 UTC** using the existing staging managed secret key. Existing
  keys were not rotated, production keys were not copied, and secret values were
  never included in evidence. The transaction refused existing Vault names.
- Confirmed `APP_ENV=staging`, outbound delivery disabled, Stripe live mode false,
  general reminders disabled, and cleanup disabled. Paused Stripe event
  processing while commissioning. Sandbox payment configuration was preserved.
- Activated `OPERATIONAL_RECONCILIATION_ENABLED` and `INVOICE_REMINDERS_ENABLED`
  after the bounded synthetic acceptance below; enabled their existing cron
  jobs (five-minute and hourly schedules respectively).
- Verified actual Vault → `pg_net` → Edge → database execution. Outbox, inbound,
  and Stripe jobs have settled HTTP 200 receipts; task reconciliation has a
  settled HTTP 200 transport receipt and a terminal database run. The invoice
  scheduler's exact SQL produced a new immutable zero-queue run at 22:12:51 UTC.
  Its wrapper uses separate feature receipts, not `scheduler_job_results`.

## Authenticated synthetic acceptance

A dedicated, clearly labelled synthetic account was created through Auth with
email already confirmed; no invitation or message was sent. A real password
sign-in supplied the user token for normal RPCs. No existing staff identity or
approval was impersonated.

**Invoice reminders:** native client/catalog/invoice RPCs created a synthetic
$100 invoice. The synthetic due-date/enrollment and test policy queued exactly
one reminder. Replaying the same run UUID returned the identical receipt; a new
run queued zero. The outbox worker returned `disabled:true`, with zero processed
items. After acceptance, the invoice terms were paused and disabled, the
synthetic catalog product was retired through an authenticated RPC, and test
accounts were deactivated with sessions revoked. Immutable test evidence is
retained, not presented as clinic financial activity. After the renderer acceptance
window finished, the one owned reminder was suppressed through the authenticated
`suppress_communication` RPC. It is now `failed` with `recipient_suppressed`; no
provider request occurred. See the [queue cleanup receipt](evidence/beta-staging-synthetic-queue-cleanup-2026-11-06.json).

**Task reconciliation:** the initial bounded replay examined five existing uses
without changes. A separate positive test then created unique synthetic catalog
identities and a new appointment, saved/published a matching preparation template,
and enabled a one-day future generation window. Before the worker call there
were zero tasks for that appointment. The worker examined six sources, generated
exactly one pending task, and returned the identical receipt on same-UUID replay.
The appointment was subsequently cancelled through the normal RPC; its task
became superseded. The template/catalog entries were retired, prior generation
policy restored, and test accounts deactivated. Staging's synthetic reconciliation
window (January 1–2, 2099) remains an engineering fixture, not a reviewed clinical
operating window. The real administrator workflow must replace it for staff
acceptance.

Cleanup exposed a separate cancellation defect: an active administrator cannot
cancel a visit assigned to inactive staff because the shared appointment guard
rejects the historical assignment. The fixture was safely retired by temporarily
reactivating only its owned synthetic assignee, cancelling normally, and
immediately deactivating again. The forward guard correction is now migration 211,
`20261106173000_terminal_appointment_clinician.sql`. Eleven minimal PostgreSQL
regression groups passed, preserving assignment/audit and rejecting inactive
new bookings, reassignment, reopening and stale writes. The exact draft was
independently reviewed and source-framed; full hosted installation/controlled
metadata acceptance remains pending. This workaround is not the product fix.

## Cleanup preview

Added `{"dry_run":true}` to the authenticated cleanup worker. Preview works while
the destructive gate remains disabled, validates the configured 24–720 hour
grace, and calls candidate discovery only. It never claims uploads or accesses
Storage. The response reports a count capped at 25, not an uncapped total.

Staging uses a **168-hour** grace; its authenticated preview returned zero
candidates. Ordinary cleanup remains disabled. All **25 cleanup tests passed**,
including invalid authentication/grace, malformed discovery, no mutation in
preview, object identity/revalidation, and uncertain deletion recovery. The
frozen Deno check passed. After root review, the identical preview was also
deployed to production as version 23, with JWT settings preserved. All eight
downloaded runtime files matched the reviewed candidate. Authenticated preview
returned HTTP 200 with zero candidates at 168 hours; unauthenticated preview
returned 401 and ordinary authenticated cleanup returned 503, disabled.

Both production cleanup configuration fields were absent; adding explicit false
and 168 preserved all 39 existing secret digests. Supabase advanced the other
55 function revision numbers by one for that configuration update, while every
other bundle hash, JWT setting and active status remained unchanged. No upload
claim, Storage access, deletion or cron activation occurred. See the
[production preview receipt](evidence/beta-production-cleanup-preview-2026-11-06.json).

Eligibility excludes non-abandoned uploads and any upload referenced by a
frozen email artifact. New cleanup requires both upload and matching object to
exceed the grace. Expired claims recover only the same path/object identity.
Actual deletion still requires claim, revalidation, removal, and confirmed
absence before finalization.

## Migration reconciliation

Initial staging prefix: **204** versions, ending `20261018150000`. Every recorded
name/statement count/array byte length/array digest matched a finite encoding
independently derived from source: 200 canonical CLI receipts, three complete
original-source receipts, and one original command receipt.

An isolated 209-migration CLI release directory was assembled with original
205, the reviewed hosted-receipt variant of 206, and original 207–209. No history
row was rewritten. The five tail SHA-256 values are:

| Version | Source SHA-256 |
| --- | --- |
| 205 | `9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3` |
| 206 hosted | `963ce258658d0100f4c8b6e64918d03efc29e743d3c9982fd16b2ba7c2dadc83` |
| 207 | `3d55b744e459e9c6b69199ba9b22195351f19e9ac7cad50e4497c71ab9094e5e` |
| 208 | `889383a61aeb5cc008ce0df10e92725ac4c242d9f0fcf8f75c462ff9126e1dbe` |
| 209 | `68ea722271b2c7ddee528f7a8ec66fed7a57e3aa6f349a0d8eb8eeee5fbb813f` |

The exact five-tail specialized CLI dry-run passed. Private schema/data logical
backups completed with mode 0600; the latest completed physical backup is
November 6 at 08:04:06 UTC (PITR is disabled). A logical backup does not include
Storage object bytes. Sanitized hashes and dry-run results are in the
[migration preflight receipt](evidence/beta-staging-migration-preflight-2026-11-06.json).

Fresh native CI at the unchanged 209-migration source passed authored-history,
forward installation, authenticated staff/browser flows, pending rollback,
register engineering and populated recovery. The [CI receipt](evidence/beta-retained209-native-ci-2026-11-06.json)
does not establish current 211-migration acceptance.

The first official CLI attempt installed 205; 206 rolled back on its unchanged
original-row/catalog preservation guard. Its transaction before-image is gone,
so overlapping scheduler/renderer writes are a plausible cause, not a proven
exact diff. An exclusive staging window paused the exact nine prior cron flags.
Two fresh snapshots matched all 457 retained tables and every catalog object,
with no active clients, running cron or queued network work. The native
rollback-only 206 diagnostic then passed the original preservation guard and
verified no persistent 206 schema or ledger entry. The unchanged CLI retry
installed 206 and 207 successfully. All nine cron flags were restored and verified
on every completed diagnostic/install window. See the [quiescence receipt](evidence/beta-staging-migration-quiescence-2026-11-06.json).

**Current staging prefix is 207.** All 207 stored receipts match independently
derived source framing; the original 204 receipts are unchanged. Migration 208
rolled back because its installer requires a natural `postgres` session and
`role=none`, while the available CLI temporary login is `cli_login_postgres`
with `role=postgres`. Every other 208 state predicate passes. No guard, source
migration or historical ledger was changed to bypass this requirement.

Completing 208/209 requires the existing staging native Postgres password or an
already approved equivalent transport. No password was reset or rotated. The
current [Management API migration contract](https://supabase.com/docs/reference/api/v1-apply-a-migration)
exposes no explicit version parameter; its server-generated timestamps cannot
satisfy this exact CLI receipt chain without prohibited reconciliation. The
[transport receipt](evidence/beta-staging-migration-transport-2026-11-06.json) records
the confirmed predicates and safe recovery point. Atomic clock 210 and appointment
guard 211 require their separate new native proof and remain unapplied.

## Concrete production activation plan

Read-only production scope at approximately 22:10 UTC: zero appointments, zero
invoice terms/invoices, an enabled invoice-reminder practice policy, no
operational-reconciliation policy, zero abandoned attachment uploads, and zero
eligible cleanup candidates at 168 hours. Recheck these counts immediately
before any later approved activation.

1. **Completed:** deployed the tested cleanup preview with a 168-hour grace;
   destructive cleanup remains disabled. Authenticated preview and rejection passed.
2. After staging acceptance/review, enable the invoice worker gate and existing
   cron. Preserve disabled provider delivery. Require real wording/policy
   sign-off before enrolling actual invoices or enabling sends.
3. Enable task transport only after a real administrator reviews the intended
   bounded operating window through the application; there is no production
   policy to infer. Confirm a terminal receipt and actual task behavior under
   the reviewed policy.
4. Enable destructive cleanup only after explicit scoped retention approval and
   a fresh preview. No production deletion was performed by this work.

No human clinical workflow sign-off has been fabricated. Safe synthetic
engineering acceptance and staff acceptance are separate evidence.

## Auth security and isolated preview

Leaked-password protection was enabled on staging and tested with a genuine
synthetic Auth sign-in: a known breached password was rejected with HTTP 422
and reason `pwned`. The account was banned/deactivated and sessions revoked.
The existing Pro plan supported the setting; no billing or signup settings
changed. The same single-field change was explicitly reviewed and applied to
production at 22:30:33 UTC. See [staging receipt](evidence/beta-staging-auth-security-2026-11-06.json)
and [production receipt](evidence/beta-production-auth-security-2026-11-06.json).

An isolated [interim staging preview](https://livingroom-vet-care-etuoflidw-daves-projects-e0da43ba.vercel.app)
is READY. Its remote build guard passed, and authenticated retrieval of compiled
assets found only the staging backend reference. Deployment protection remains
enabled; no production alias command was issued. The public source snapshot,
contact-intake/CloudTalk-disabled settings and deployment identity are in the
[preview receipt](evidence/beta-staging-preview-2026-11-06.json). This snapshot
predates the final PostgreSQL UUID compatibility correction and is not the final
human-acceptance candidate. Rebuild after source stabilizes and 210/211 are deployed.

Fresh staging-only HMAC document-link keys were created after confirming that all
four configuration fields were absent. The origin points at the verified interim
preview; no existing key was rotated or production key copied. The
[document-link receipt](evidence/beta-staging-document-links-2026-11-06.json) records
the successful bounded synthetic invoice preparation/replay/review/retrieval/
revocation result, including the actual deployed browser opening a sandboxed
report and clearing access on close. Invalid tokens/selectors and unreviewed or
revoked grants returned 404. All synthetic accounts were deactivated, grants
revoked and products retired; communication attempts remained zero.
Outbound delivery stays disabled. Final preview origin changes must preserve
previously captured grant origins rather than silently invalidate their links.

The first 23-function Zod dependency candidate was deployed to staging with JWT
settings preserved and runtime source parity verified; remote lockfiles were not
returned by the downloader. Subsequent browser testing found stricter UUID domain
behavior, so this is explicitly an intermediate deployment. The corrected successor has now been deployed to all 23 affected functions.
All downloaded runtime source/configuration matched, JWT settings were preserved,
all 23 unauthenticated probes rejected, and three authenticated worker calls plus
identity replay passed. See the [successor deployment receipt](evidence/beta-staging-edge-uuid-2026-11-06.json).
The current-image diagnostic renderer then passed **201 hosted checks**, including
genuine Auth, exact private Storage readback, current and historical packages,
protected-link review in desktop/mobile browsers, and direct staff Storage denial.
All owned accounts, sessions, patients, objects and grants were retired or revoked,
and the temporary policy/outbox snapshots were restored. See the [workflow receipt](evidence/beta-staging-renderer-workflow-2026-11-06.json).

The reviewed staging runtime, worker and staff-disclosure policies are now enabled
for the exact admitted image and bounded operator-invoked one-job entrypoint.
Release and recipient-disclosure policy tables remain empty; no scheduler or
provider delivery was enabled. Existing active-admin attribution records delegated
engineering configuration, not a personal clinical sign-off. The actual operator
CLI accepted a verified-absent PostgreSQL UUID and returned `missing` without a job
write. See the [commissioning receipt](evidence/beta-staging-renderer-commissioning-2026-11-06.json)
and [operator instructions](beta-renderer-operations-2026-11-06.md).

## Release-email preparation configuration

A genuine synthetic diagnostic package test reached private PDF generation,
registration, exact Storage readback and direct-storage denial, then exposed
`prepare-release-email` HTTP 500. Staging lacked `RESEND_FROM`; the payload
builder rejects the empty sender before capture. Added only the previously
absent staging value `Synthetic Beta <no-delivery@example.test>`, with all prior
secret digests unchanged and outbound delivery still disabled. This is a fictional
preparation identity, not a commissioned provider sender. The bounded positive
rerun passed the complete 201-check renderer workflow, including the deployed
preparation and protected-link boundaries; see the
[configuration receipt](evidence/beta-staging-email-preparation-2026-11-06.json).
