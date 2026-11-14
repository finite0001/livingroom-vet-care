# Living Room Vet staff and clinical feature rollout

Owner direction: November 14, 2026. Living Room Vet only. Time clock/PTO comes first.
Dave and Susan approve time/leave and may receive private pay permissions. Kennel rotation means staff duties.
Pay/leave policies are not yet supplied; do not infer them. Backups use Dave's existing Synology and Google Drive.

## What this release adds

- `/hub/team/time-off`: leave requests/approvals/cancellation, private reasons, ledger balances,
  monthly accrual policies/enrollment/adjustments, approved who's-off dates, holidays, staff shifts,
  lateness review, time correction requests, missed shifts, period submission/approval/finalization,
  estimated automatic clock-out review and overtime previews.
- `/hub/team`: staff board/pins/acknowledgments, quick tasks, kennel-duty roster generation,
  task coverage reassignment, events/parties, capacity/waitlist handling and opt-in annual milestone pop-ups.
  Quick tasks also appear in the existing daily tasks destination.
- `/hub/team/people`: effective-dated rates/raises, bonuses, frozen payroll CSV summaries,
  provider-approved SIMPLE IRA/benefit form assignments/private PDFs and grouped anonymous peer reviews.
  Assigned pay managers can view backup receipts.
- `/hub/tools/clinical`: fluid, shock bolus, chocolate exposure and gestation worksheets;
  source-cited discharge/bloodwork drafts and verified-catalog pill candidate assistance.
  Patient medical records display saved worksheets and veterinarian-approved draft artifacts.
- Existing time clock/timesheets and dental chart remain in place. Dental browser regressions are included in validation.

## Deliberate boundaries

- All new private schemas deny direct access to anonymous, authenticated and service roles. Public RPCs
  derive staff identity from the session and apply explicit manager or DVM checks.
- Create forms retain an ID-only request pointer through unconfirmed retries; durable server receipts prevent repeated adjustments, bonuses and other new records. Edited content cannot reuse an already committed request ID.
- New time finalization does not alter the metadata of existing medication-bound tables/routines.
  A closed period retains exact approved time and policy snapshots. Existing trusted administrator clock
  corrections remain available; differences from submitted/finalized time are flagged, and frozen payroll
  exports do not change. New correction requests cannot rewrite finalized periods.
- Overtime previews use configured daily/weekly rules and require complete workweeks. Payroll exports
  use server calculations over captured time, including earlier workweek hours; daily overtime is not counted twice.
  This is a payroll input summary, not a wages/tax/withholding or retirement-remittance engine.
- Initial accrual implementation is completed-full-calendar-month accrual with caps, effective-dated history,
  enrollment and reviewed adjustments. Proration/opening balances use explicit adjustments. Different accrual
  bases, carryover/expiry rules and employee exemptions must be specified before configuring actual clinic policies.
- Approved leave crossing pay periods must be split before finalization, because requests contain total hours,
  not a guessed per-day allocation. Pending time corrections/leave must be resolved before finalization.
- Peer responses have no author ID, client response ID or submission timestamp. Eligibility is separate;
  results release only after closure and at least three responses. Comments and infrastructure timing can
  still identify a respondent in a small team; the UI explains this limitation.
- Clinical protocols start unapproved. Only active DVM accounts may approve protocols, save reviewed
  worksheets or approve AI artifacts. These artifacts do not automatically sign an encounter or send a message.
- AI requires existing `OPENAI_API_KEY`, explicit `CLINICAL_HELPER_MODEL` and `CLINICAL_HELPER_ENABLED=true`.
  No provider/model is silently selected. Configure a compatible structured-output model after clinical evaluation.
  Every saved generated claim must cite an exact selected source quote. Citation matching is not a guarantee
  of semantic correctness; veterinarian review remains required.
- Bloodwork uses a selected patient lab record plus staff-verified values, units and source ranges.
  Pill assistance needs exact imprint matches in a veterinarian-verified catalog; no match means abstention.
  Neither a generic image guess nor an unverified internet result authorizes dispensing.
- The new worksheet/draft artifacts appear in the patient medical workspace. Existing record-release package
  builders have not been extended to include these new artifact types; approved text can be explicitly copied
  into the existing message composer. Do not represent this as automatic communication or release integration.

## Backend order

Source inventory before this release: 214 migrations, latest `20261112210000`. Production inventory was
read-only verified against that boundary on November 14. No new backend was deployed by the initial coding pass.

Apply these five additive migrations through the repository's normal verified CLI rollout:

1. `20261114215340_workforce_time_and_leave.sql`
2. `20261114220407_workforce_team.sql`
3. `20261114220830_workforce_people.sql`
4. `20261114221516_staff_clinical_tools.sql`
5. `20261114222530_staff_backup_health.sql`

Staging: `kothoqicubowyhwfsrte`. Primary: `mgadheotkdnrsatfivjy`.
Legacy Lovable `ugpyjacqganaqtsiekay` is not the target.

1. Verify target and current ledger/definitions; rehearse on disposable/staging data.
2. Apply all migrations before the dependent frontend. Verify public RPC grants, private-schema denial and Storage policies.
3. Deploy `clinical-helper` with its committed lock/config; leave it disabled until provider and clinical acceptance.
4. Verify the hourly workforce cron (`workforce-hourly`) exists, starts paused and invokes the private SQL job. The assigned approver enables configured automation on Policies & setup. No configured policy means no accrual/automatic clock-out.
5. Publish the reviewed frontend release. GitHub merge, database migration and function deployment are distinct steps.
6. An existing administrator assigns Dave/Susan by their verified staff accounts on Approvers.
   Set time-manager and pay-manager permissions explicitly; generic ADMIN/DVM roles do not grant private pay access.
7. Enter approved policies, reconcile opening balances and run the configured job once before staff use.
8. Confirm direct permission denials with employee, manager and DVM identities. Reconcile the first full payroll/leave cycle.

Historical medication proofs remain historical. The named 215–219 source framings and current candidate
closure admit these source files without relabeling old 206/208/209 acceptance as current runtime acceptance.
The complete current medication rehearsal and staging checks remain separate evidence gates.

## NAS and Google Drive backups

An existing Synology Drive connection named CAMPSEQUOIALAKE maps `~/SynologyDrive` to the NAS's
`home/SynologyDrive` share. It has bidirectional sync enabled without selective-folder filtering.
This release uses a separate `LivingRoomVetBackups` directory under that configured root.
Google Drive has a dedicated private `Living Room Vet Encrypted Backups` folder in Dave's finite01 account.
The actual folder ID belongs in private local configuration, not application source. The self-contained local runner and inactive 01:41 LaunchAgent have been installed; all three required Keychain credentials are currently absent. No production data was exported.

`node scripts/backups/install-local.mjs NAS_ROOT NAS_MODE DRIVE_FOLDER_ID` builds a self-contained runner
under `~/Library/Application Support/LivingRoomVetBackups` and writes an inactive LaunchAgent.
It refuses to overwrite an existing runner, configuration or schedule. Use `synology-drive` for the configured
sync root, or `mounted` for an actual mounted NAS share. Mounted mode refuses an unmounted local fallback directory.

The runtime reads three macOS Keychain items, without logging their values:

- `lrv-backup-database-url`: a protected primary-database connection usable by `pg_dump`.
- `lrv-backup-service-role`: the primary service-role key for complete Storage export and backup receipts.
- `lrv-backup-encryption-key`: a randomly generated 32-byte key encoded as 64 hexadecimal characters.

Keep an independent protected recovery copy of the encryption key. It is not included in either backup.
The runner also needs PostgreSQL 17 `pg_dump`/`tar` and the existing `gog` Drive authorization for finite01@gmail.com.
Secrets are never stored in the plist, source repository or Drive archive manifest.

Before enabling the schedule, run the installed runner manually and verify both destinations.
Then activate the generated LaunchAgent with the current user's `launchctl bootstrap` workflow.
The schedule runs daily at 01:41 local time while the user LaunchAgent is available; a sleeping/offline Mac
is not an always-on server. Backup retention/deletion is intentionally not configured without an owner policy.

The job dumps the database, exports physical Storage objects, compares pre/post object inventories,
creates a manifest with exact hashes, then encrypts the complete archive using AES-256-GCM.
Only encrypted files go to either destination. A Google Drive download is hashed back against the upload.
NAS local-copy hashes are checked. `NAS_PENDING` means Drive is verified and the Synology copy is staged;
it does not claim that remote Synology sync completed. Mounted-share copies can record `SUCCEEDED`.
Failures remain visible and receipts older than 36 hours are flagged overdue.

To recover: fetch the selected encrypted archive, authenticate/decrypt with
`node scripts/backups/decrypt.mjs SOURCE.lrv NEW_PRIVATE_ARCHIVE.tar.gz`, verify the manifest and follow
[the isolated restore runbook](restore-runbook.md). Never restore a database dump directly into a running practice.
Current hosted backup/PITR settings, full populated restore acceptance and remote NAS completion need
separate verification; an encrypted transport test does not establish them.

## Validation entry points

- `npm run check`: lint, TypeScript, application tests and build.
- `python3 scripts/workforce/verify.py`: owned disposable PostgreSQL; permissions, accruals, concurrent
  approvals/RSVPs, frozen payroll, private documents, peer-review aggregation and clinical boundaries.
- `node --test tests/backups/archive.test.mjs`: authenticated encryption, tamper/wrong-key rejection and no-clobber recovery.
- `npx playwright test e2e/staff-features.spec.ts e2e/dental.spec.ts --project=chromium --workers=2`:
  new staff flows at four widths, patient context, clinical unsaved navigation and existing dental behavior.
- `node scripts/workforce/frame-migrations.mjs --check`: exact official CLI source framing.
- `python3 -I -B scripts/narcotics-log/beta_rehearsal.py --check-source`: complete current candidate closure.

## Remaining owner/configuration inputs

Payroll provider/export contract, workweek, employee eligibility/break/overtime rules; leave entitlement,
carryover/expiry and opening balances; auto clock-out/grace; benefits provider/forms; clinician acceptance,
AI model/activation and pill references; backup credentials, recovery-key custody, retention and schedule activation.
Dave must approve each PR merge; agents do not merge.
