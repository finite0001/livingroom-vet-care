# Resume here — Living Room Vet staff features

Updated November 14, 2026. Owner requested saving follow-up notes after committing/pushing.

## Saved work

- PR: https://github.com/finite0001/livingroom-vet-care/pull/326
- Implementation commit: `2177f7c6`; branch `docs/staff-feature-rollout-20261114`.
- Worktree: `~/Developer/livingroom-staff-feature-plan-20261114`.
- Target is **Living Room Vet only**, despite the initial Vet Connect Hub wording. First priority: time clock/PTO. Kennel rotation means rotating staff duties.
- Dave and Susan approve time/leave; assign verified accounts and explicit private-pay permissions during rollout.
- Source implementation is committed/pushed. No production migrations/functions deployed by this work. PR remains open; no merge performed.
- Last observed checks: Edge and Vercel preview passed; remaining GitHub checks running. Recheck before any release.

## Next session

1. Check PR #326 CI/review results; address failures. Confirm specific merge authorization before merging.
2. Follow [the rollout runbook](../../docs/staff-feature-rollout-2026-11.md): verify target, staging/rehearsal, five migrations, Edge Function, then frontend. Primary `mgadheotkdnrsatfivjy`; staging `kothoqicubowyhwfsrte`; legacy Lovable is not the target.
3. Collect payroll provider/pay cycle, workweek, overtime/break/eligibility rules, auto clock-out/grace, PTO/sick accrual/carryover/expiry and opening balances. Dave deferred these; never invent them. Initial accrual supports completed calendar months plus reviewed adjustments.
4. Assign Dave/Susan permissions, configure approved policies, reconcile balances/time, then enable configured workforce jobs. Jobs start paused.
5. Obtain DVM protocol acceptance, current SIMPLE IRA/provider documents, explicit AI model/provider activation and verified pill catalogue. Helpers remain reviewed drafts; no automatic sending/signing. New clinical artifacts are not yet included in record-release packages.
6. Finish backup credentials, populated recovery drill, destination verification and schedule activation below.

## Backups — prepared, inactive

- Same Synology NAS setup as Camp Central Station: local `~/SynologyDrive`, remote `home/SynologyDrive`, dedicated `LivingRoomVetBackups` subfolder. No mounted NAS volume was present. Synology staging is **NAS_PENDING**, not remote-NAS verification.
- Private Drive folder: [Living Room Vet Encrypted Backups](https://drive.google.com/drive/folders/1V9dj0EwfK_Oai91HpUSXjUYsKm3Cy0xA).
- Installed runner/config: `~/Library/Application Support/LivingRoomVetBackups/`.
- Installed inactive schedule: `~/Library/LaunchAgents/vet.livingroom.encrypted-backup.plist`, 01:41 local. Not loaded.
- All three Keychain entries were absent: `lrv-backup-database-url`, `lrv-backup-service-role`, `lrv-backup-encryption-key`. Keep key custody independent of backups; never commit credentials.
- Synthetic encrypted Drive upload/download/decrypt passed and temporary cloud test was trashed. No production data exported. Run manually and verify recovery/destinations before loading schedule. Retention policy remains unspecified.
- Installer refuses overwriting existing config/runner/plist; inspect before updating.

## Evidence already saved

[Feature-by-feature implementation and validation](implementation-evidence.md), [baseline photo matrix](feature-matrix.md), and [release runbook](../../docs/staff-feature-rollout-2026-11.md).
Local checks passed: 2,819 application tests; 13 staff/dental browser tests plus one retry test; 150 source guards; disposable workforce SQL checks; encryption tests; Deno check; complete owned 219-migration `ordinary_none` rehearsal preserving controlled-drug metadata/rows/sequences, with zero hosted writes/provider requests. Other runtime profiles remain separate CI gates.
