# Approved #244 hosted rollout

Approved head `515fa21a19bd659423874b310f6d9c70c7c6974f` was merged as `8bb1592bb49c8084d47b026cb20ba2c6f2c4e70b`. All four required checks passed on that exact head. [CI receipt](2026-10-12-diagnostic-pdf-release-scope-ci.json).

Migration178 (`20261012210016_diagnostic_pdf_release_scope.sql`, SHA256 `bfb99625e39205307918aea1647d1d6548f5324f9bcdf10f98a9d8ab6e24a516`) was applied staging-first, with protected pre-install function/ACL backups, exact177 history checks, canonical-only dry-run and `--skip-vault`. Both staging and primary now have178 migrations and no pending approved migrations. Migration179 was not included. No Edge Function deployment was needed for this SQL/metadata UI package.

Staging (`kothoqicubowyhwfsrte`) passed59 genuine Auth/native PDF/private Storage/deployed Edge/desktop/mobile checks. The actual32,740-byte PDF contained two diagnostic panels; the preview disclosed both and required broader-scope review. Current correction denied stale scope; explicit historical metadata and bytes remained available. Actual download expiry/offboarding/policy/object-loss tests passed without regeneration. Exact-owned objects, active patients/profiles/sessions and temporary policies were removed/offboarded. Immutable synthetic ledgers remain as audit evidence.

Both backends passed26 fresh-UUID, rollback-only authorization/binding assertions, canonical function/search-path/ACL/RLS checks, and unchanged baseline content/row digests. Primary (`mgadheotkdnrsatfivjy`) retained its3 outbox rows and0 payment profiles; staging retained0 outbox rows and1 payment profile. No provider requests, new financial profiles, scheduler/Vault changes or legacy database writes occurred.

The Git-triggered production deployment (`dpl_EiVhDZxgY3KD2DssfKXpEM1xoWhg`) is READY at the merge commit. A fresh `/hub/login` browser smoke on `https://thelivingroom.vet` returned200, served `/assets/index-BG8A0gxW.js` with the primary backend and had0 page errors. Anonymous diagnostic Edge download remained401. No primary staff session or synthetic PDF/patient was created outside the rollback probe.

All3 exact-image staging VMs were independently verified stopped/nonpersistent/deny-all with no snapshots. Security advisors showed465 warnings and0 errors on each backend; the single new warning is the intentionally authenticated `read_diagnostic_pdf_release_scope` endpoint, covered by staff-guard, active-reader recheck and private-path projection tests. [Rollout receipt](2026-10-12-diagnostic-pdf-release-scope-rollout.json) / [VM audit](2026-10-12-diagnostic-pdf-release-scope-rollout-vm-audit.json).

Permanent worker/runtime/staff-disclosure/record-release/recipient-disclosure policies remain empty/off. All45 requirements, Susan's acceptance and separately approved clinical/provider commissioning remain outstanding launch gates. Numbered schema14 export is the separate3A2b package.
