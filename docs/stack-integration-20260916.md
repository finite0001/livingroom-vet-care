# Standalone stack integration — September 16, 2026

This integration candidate combines the frozen clinical and communications sources below and is ready for its integration merge commit. It is not deployment or combined-runtime acceptance. No source branch was modified, no migration was applied to either hosted project, and no provider calls were made.

## Exact source freeze

- Clinical / estimate drafts: PR155, `02f5fa755f6443e757d2a49f25397db066b1aca5` (127 migrations).
- Communications / attachments: PR156, `9b46cc67837dac66d330921a5604b46133c1fa4a` (118 migrations on its own base).
- Integration branch: `codex/standalone-stack-integration`, worktree `/Users/davidedler/livingroom-vet-standalone-integration`.
- Merge began with `--no-commit`; the reviewed conflicts are resolved and the candidate is ready to record as a merge commit. Further commits on either source branch require an explicit follow-up integration review.
- The separate estimate-publication worktree/branch and its publication migration, HTTP handlers, UI and tests are **not included**. Client decisions and accepted-line execution also remain separate work. Do not count publication acceptance as part of this candidate.

## Migration reconciliation

The actual union is **131 migrations**, not 130: the clinical source has 127 and communications contributes four additional files (uploads, email preparation, inbound capture and abandoned cleanup).

| Communications source filename | Integration filename |
| --- | --- |
| `20260916100000_conversation_attachment_uploads.sql` | `20260916100001_conversation_attachment_uploads.sql` |
| `20260916110000_conversation_email_preparation.sql` | `20260916110001_conversation_email_preparation.sql` |

Only these two communications filenames change. Their SQL bytes remain identical to the frozen PR156 source. The clinical `20260916100000_native_return_reconciliation_releases.sql` and `20260916110000_native_dispense_finance.sql` remain unchanged. Communications inbound capture (`20260916120000`) and cleanup (`20260916130000`) keep their original names. The new unique second suffixes preserve upload→email→inbound→cleanup order; these are unapplied-file renames, not generated new schema or migration-history repair.

[Hosted inventory snapshot](evidence/hosted-migration-inventory-20260916.json), observed at `2026-09-16 12:50:04 UTC`, records 113 versions for both `mgadheotkdnrsatfivjy` and `kothoqicubowyhwfsrte`, each ending at `20260916020000`. Both colliding old versions and both proposed renamed versions are absent from both inventories. This supports renaming these unapplied files; inventory is not proof of schema equality. No historical receipt or recorded branch evidence was rewritten to claim these new filenames existed during previous runs.

Executable inventory gates now require all 131 unique versions in `scripts/restore-rehearsal/run.py`, `tests/ezyvet/attachment-metadata-disposable.py`, and `tests/prescriptions/native-disposable.py`. The restore script's exact upgrade list includes finance, estimate drafts and all four communications migrations, which were missing from the clinical branch's older upgrade list. Historical source-branch counts and filenames in retained plans/evidence remain historical; this document defines the integrated candidate inventory.

## Shared-file conflicts

- `.github/workflows/ci.yml`: preserved all ten clinical/finance/draft contention steps and both communications contention steps. Existing attachment timing regression checks, actual Auth/Storage paths, shared payment/clinical checks and cleanup remain.
- `scripts/restore-rehearsal/run.py`: kept the clinical prerequisite versions, added communications prerequisites, and replaced conflicting 127/118 counts with the verified 131-file union. Frozen staging and hosted-gap upgrade lists now match the combined tree exactly.
- `tests/ezyvet/attachment-metadata-disposable.py`: preserved clinical prerequisites and alternate-stack exclusion, added all communications versions, and requires 131 versions.

Other files merged without textual conflicts. This includes generated Supabase types/configuration and the incoming-message, conversation UI and outbox-dispatch changes from PR156. A clean textual merge does not prove shared SQL, RLS, worker or browser behavior. No product logic was changed as part of conflict resolution.

## Static verification performed

- No unresolved index entries or conflict markers remain in the three conflicted files.
- Exactly 131 SQL filenames and 131 unique versions; both renamed SQL files byte-match PR156.
- Four added communications migration files parse with PostgreSQL syntax tooling.
- Exact 84→131 staging and 51→131 historical hosted-gap upgrade inventories match local filenames.
- All three changed Python harnesses compile; staged and unstaged whitespace checks pass.

## Required combined acceptance

Run the combined CI frontend/typecheck/unit/build, Edge frozen dependency/typecheck, database migration/SQL and all retained observed-contention jobs against this exact integrated tree. Run the communications browser/actual Auth/Storage upload, reviewed queue/history, inbound claim/capture/read/revoke and abandoned-cleanup replay checks together with clinical/dispense/return/finance/draft acceptance. Rehearse populated native and communications schema/data restore, retained attachment byte recovery and exact security boundaries against the combined inventory. Standalone prior-branch CI is evidence for those sources, not a substitute for this combined run.

Fresh-hosted-baseline reconciliation must distinguish the observed 113-migration hosted inventory from the older 84/51 rehearsal baselines. A deployment decision requires a reviewed ordered migration diff and explicit provider/launch gates; none is claimed here. No test servers, hosted mutations, pushes or deployments were run during this conflict-resolution checkpoint. Recording the integration merge commit does not change the pending combined acceptance above.
