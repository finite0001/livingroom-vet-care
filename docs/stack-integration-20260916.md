# Standalone stack integration — September 16, 2026

This integration candidate combines the frozen clinical, communications and estimate-publication sources below at merge commit `4e9bdfd`. Local frontend checks and the native populated workflow/restore run passed on that tree; full combined CI and communications-specific restore acceptance remain pending. It is not deployment acceptance. No source branch was modified, no migration was applied to either hosted project, and no provider calls were made.

## Exact source freeze

- Clinical / estimate drafts: PR155, `02f5fa755f6443e757d2a49f25397db066b1aca5` (127 migrations).
- Communications / attachments: PR156, `9b46cc67837dac66d330921a5604b46133c1fa4a` (118 migrations on its own base).
- Integration branch: `codex/standalone-stack-integration`, worktree `/Users/davidedler/livingroom-vet-standalone-integration`.
- Prior integration merge: `8ecac402e6eb02abc120566139d3fd0317a03091`. Publication source: `9ebfdd8ea7d0d4479ebd33e0ceccc23843f62b31` (128 migrations on its clinical base).
- Publication integration resolved five conflicts and was committed as `4e9bdfd`. Further commits on either source branch require an explicit follow-up integration review.
- Estimate publication is now included: migration `20260916123017_native_estimate_publications.sql`, renderer, staff HTTP handlers/UI, lifecycle and closure workflows, contention tests and populated restore coverage. Publication delivery adapters, client decisions and accepted-line execution remain separate unfinished work; inclusion does not imply combined acceptance.

## Migration reconciliation

The current union is **132 migrations**: clinical source 127, four communications migrations, and one estimate-publication migration. The prior integration had 131 migrations. Publication version `20260916123017` is unique and retains its source filename and SQL bytes.

| Communications source filename | Integration filename |
| --- | --- |
| `20260916100000_conversation_attachment_uploads.sql` | `20260916100001_conversation_attachment_uploads.sql` |
| `20260916110000_conversation_email_preparation.sql` | `20260916110001_conversation_email_preparation.sql` |

Only these two communications filenames change. Their SQL bytes remain identical to the frozen PR156 source. The clinical `20260916100000_native_return_reconciliation_releases.sql` and `20260916110000_native_dispense_finance.sql` remain unchanged. Communications inbound capture (`20260916120000`) and cleanup (`20260916130000`) keep their original names. The new unique second suffixes preserve upload→email→inbound→cleanup order; these are unapplied-file renames, not generated new schema or migration-history repair.

[Hosted inventory snapshot](evidence/hosted-migration-inventory-20260916.json), observed at `2026-09-16 12:50:04 UTC`, records 113 versions for both `mgadheotkdnrsatfivjy` and `kothoqicubowyhwfsrte`, each ending at `20260916020000`. Both colliding old versions and both proposed renamed versions are absent from both inventories. This supports renaming these unapplied files; inventory is not proof of schema equality. No historical receipt or recorded branch evidence was rewritten to claim these new filenames existed during previous runs.

Executable inventory gates now require all 132 unique versions in `scripts/restore-rehearsal/run.py`, `tests/ezyvet/attachment-metadata-disposable.py`, and `tests/prescriptions/native-disposable.py`. The restore script's exact upgrade list includes finance, estimate drafts, estimate publication and all four communications migrations, which were missing from the clinical branch's older upgrade list. Historical source-branch counts and filenames in retained plans/evidence remain historical; this document defines the integrated candidate inventory.

## Shared-file conflicts

- `.github/workflows/ci.yml`: preserved all ten clinical/finance/draft contention steps, both communications contention steps, and added the publication contention step. Existing attachment timing regression checks, actual Auth/Storage paths, shared payment/clinical checks and cleanup remain.
- `scripts/restore-rehearsal/run.py`: kept the clinical prerequisite versions, added communications prerequisites, and replaced the conflicting integration/publication counts with the verified 132-file union. Frozen staging and hosted-gap upgrade lists now match the combined tree exactly.
- `tests/ezyvet/attachment-metadata-disposable.py`: preserved clinical prerequisites and alternate-stack exclusion, added all communications versions, and requires 132 versions, including publication.

- `supabase/config.toml`: preserved communications function JWT settings, server-only cleanup authentication, and all three staff publication function entries.
- `tests/prescriptions/native-disposable.py`: requires the combined 132 versions while preserving both communications and publication prerequisites and the incoming publication Auth/restore harness.

Other files merged without textual conflicts. This includes generated Supabase types/configuration and the incoming-message, conversation UI and outbox-dispatch changes from PR156. A clean textual merge does not prove shared SQL, RLS, worker or browser behavior. No product logic was changed as part of conflict resolution.

## Static verification performed

- No unresolved index entries or conflict markers remain in the five conflicted files.
- Exactly 132 SQL filenames and 132 unique versions; both renamed SQL files byte-match PR156.
- The publication migration and four communications migrations parse with PostgreSQL syntax tooling; publication SQL is byte-identical to the frozen source.
- Exact 84→132 staging and 51→132 historical hosted-gap upgrade inventories match local filenames.
- All three changed Python harnesses compile; merged TOML parses and retains both function families. Conflict-resolution files pass whitespace checks. Full staged whitespace checking reports the publication source’s existing extra blank line at SQL EOF; it is retained to preserve the exact frozen migration bytes.

## Required combined acceptance

CI run `35108875484` targets the prior `8ecac40` integration only. It does not accept this publication-inclusive source, regardless of its eventual result.

Run the combined CI frontend/typecheck/unit/build, Edge frozen dependency/typecheck, database migration/SQL and all retained observed-contention jobs against this exact integrated tree. Run the communications browser/actual Auth/Storage upload, reviewed queue/history, inbound claim/capture/read/revoke and abandoned-cleanup replay checks together with clinical/dispense/return/finance/draft and publication prepare/capture/read/review/publish/replace/withdraw/recovery acceptance. Rehearse populated native and communications schema/data restore, retained attachment and publication byte recovery, frozen publication histories after live source changes, and exact security boundaries against the combined inventory. Standalone prior-branch CI is evidence for those sources, not a substitute for this combined run.

Fresh-hosted-baseline reconciliation must distinguish the observed 113-migration hosted inventory from the older 84/51 rehearsal baselines. A deployment decision requires a reviewed ordered migration diff and explicit provider/launch gates; none is claimed here. No test servers, hosted mutations, pushes or deployments were run during this conflict-resolution checkpoint. Recording the integration merge commit does not change the pending combined acceptance above.

## Combined local evidence at4e9bdfd

[Native runtime evidence](evidence/combined-native-publication-20260916.json) records132 migrations,660 actual local Auth/native workflow checks,50 publication SQL assertions,67 observed publication contention checks,78 quantity replay cases and128 selected populated-restore checks. Owned runtime/container/volume cleanup was verified. Local `npm run check` passed lint, TypeScript,1012 unit tests and build. Existing fast-refresh/chunk-size warnings remain.

These native restore results do not cover populated communications original-byte restore. The broader backup script copies the full database and Storage, but previously did not seed the new conversation/inbound families. Separate communications fixture/restore work must verify original bytes, immutable delivery links and post-restore authorization before commercial backup readiness is claimed. Final combined CI and hosted review remain required.
