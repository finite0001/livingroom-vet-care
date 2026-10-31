# Narcotics log verification

This package belongs to **Living Room Vet**. GreenTree, VetConnect Hub and ezyVet
are separate work.

The first two new migrations contain the staff record-review backend and the count,
stock-entry, witnessing, administration and correction backend. A third adds
register exports, preserved original files and recovery controls. They follow the
existing controlled-stock and private-review migrations. The official CLI owns
each migration's transaction and ledger insertion; the standalone install
programs' outer transaction wrappers have been removed.
Historical ledger and descriptor values remain the original frozen values.
Three reviewed native-prescription fixes are installed explicitly in the second
forward migration, after checking their original source; their existence in an
experimental database is not assumed.

`release-candidate.json` deliberately says that deployment is not ready. The
authenticated count, all ten ordinary writers, staff browser, forward ledger and
release checks must pass before requesting approval for the final PR.

## Historical source boundary

The old 206-file proofs remain unchanged. `prefix_view.py` verifies all original
migration hashes, checks the exact named forward files, and copies the historical
proof dependencies into a private 206-file view. Each old proof runs in that view.
Those results apply to the historical prefix; they do not certify the current
208-file count application or the subsequent 209-file operational application.

The retained database, controlled-stock and renderer CI jobs use a separate Git
worktree. Its original 206 files are verified before and after excluding only
the two explicitly pinned forward files. Existing proof programs, budgets and
assertions stay unchanged. Current frontend checks run in the complete checkout;
the dedicated narcotics jobs install and exercise the complete 208 release.

Source-only checks:

```sh
python3 -B scripts/narcotics-log/prefix_view.py --check-only
python3 -B scripts/narcotics-log/prefix_view.py --proof artifacts
python3 -B -m unittest discover -s scripts/narcotics-log -p 'test_*.py'
node --test scripts/narcotics-log/frame-cli.test.mjs
```

## Current installation rehearsal

The dedicated GitHub workflow runs on an isolated runner. It derives statement
hashes from the pinned official CLI parser and TypeScript implementation before
constructing a database. No observed database values become expected metadata.
The literal golden is supplemented by independently created, empty source
reference schemas. Their complete expected metadata is checked against the
installed metadata; unrelated golden values cannot change through that join.

The rehearsal creates a fresh local project, pauses and drains its scheduler
before applying the original 206 migrations, and applies the two forward
migrations through the real CLI. It checks the complete source-derived ledger,
source properties, preserved original rows, the ten declared writer-manifest
appends, and initially empty count/workflow tables. It then removes only its
verified owned containers, volumes and network.

```sh
node scripts/narcotics-log/frame-cli.mjs --write-candidate
python3 -I -B scripts/narcotics-log/install_rehearsal.py --check-source
python3 -I -B scripts/narcotics-log/install_rehearsal.py --run-synthetic-local
```

Use Python 3.11+ and the pinned Supabase CLI 2.118.0. The original total600,
work540, cleanup55, owner30, application8 and lock5 second contracts remain.
The process/metadata channel is bounded separately from source files, physical
boundaries and HTTP responses. Overflow, invalid encoding, incomplete input,
late completion, source changes and cleanup failures refuse success.

This installation rehearsal creates no staff account, signs no record and
certifies no physical stock. Authenticated business and browser verification
remain separate requirements. Production staff must supply the real clinic's
medication classifications, permissions, opening stock and physical observations.

The separate genuine-business jobs create two real local GoTrue users and sign
in with their passwords. Only their initial synthetic staff permissions use an
owner bootstrap. Medication setup, opening stock, review policies and physical
counts use the real application APIs. Each profile gets a fresh database and
the same original time limits. These jobs retain full private transport evidence
locally; uploaded diagnostics omit passwords, tokens and raw Auth responses.

## Existing hosted history

Some original migrations were recorded as their complete authored SQL rather
than the CLI's statement vector. `hosted_history.py` derives those finite forms
from the unchanged original source. The separate 206 source variant and the
forward 207 gates accept those exact forms. Their complete inverses recover the
original SQL, and every original quoted canonical ledger row stays unchanged.
No existing ledger row is updated, deleted or replaced.

The client-contact CHECK may already have been validated by an owner in a
hosted database. `validated_client_constraint.py` admits the exact original
expression in either validation state by canonicalizing only the named
`public.clients.clients_required_contacts_check` catalog rendering. It does
not alter the constraint or client data. A whole migration inverse recovers
the PR315 source, including every other function, permission and time limit.
The canonical installation still covers the unvalidated form; the authored
history rehearsal validates the existing CHECK before installing and runs
seven rollback-only catalog controls. Changed expressions, missing/renamed
checks and similarly named checks on other tables remain distinguishable.
Mismatch reporting prunes equal object subtrees without changing refusal.

`compact_source_guard.py` stores the frozen installation snapshot once in a
local JSONB constant. Three repeated copies of its review snapshot use that
same constant's `original269` value. This reduces the large verification
statement from 22.3 MB to 9.1 MB without changing its expected values or
comparison. Its complete inverse recovers every PR316 migration byte before
the existing PR315 inverse runs. No installed function, database constraint,
permission, historical receipt or time limit changes through this compaction.

The following descriptor statement also uses local constants through
`compact_descriptor.py`. Its initial frozen `properties` value was completely
replaced by the existing JSONB overlay; omitting that unused copy and reusing
the overlay's frozen snapshots reduces this statement below 10 MB. The complete
inverse restores every PR317 byte using the independently pinned
`module-expected.json`. The stored descriptor and its hash remain unchanged.

The authored-history rehearsal starts with the unchanged zero-project bootstrap,
pauses the scheduler, and constructs original204 history once in its fresh local
database. The official CLI then applies original205, the reviewed206 source
variant and both forward migrations. It uses the same downstream complete
metadata, ledger, original-row preservation and cleanup checks as the clean CLI
rehearsal, with the same time limits. This is installation evidence only.

```sh
python3 -I -B scripts/narcotics-log/hosted_history.py --check-source
node scripts/narcotics-log/frame-hosted-history.mjs --write-candidate
node scripts/narcotics-log/frame-cli.mjs --write-candidate
python3 -I -B scripts/narcotics-log/hosted_rehearsal.py --run-synthetic-local
```

The authenticated browser proof binds all 146 frontend source files. Its V3
binding includes the clinical-alert rejection fix; a source inverse recovers the
complete previous binding and the original operative browser workflow. The
mocked legacy screen suite uses a separate Vite transport fixture, without
changing the production connection rules or the genuine Auth proof.

## Draft operational completion

The candidate includes staff routes for recovery, register exports and original
supporting files. `operational_browser.py` adds a separate Linux real-SDK-login
job for these workspaces. It preserves the frozen 146-file count proof, binds
the operational frontend source, reloads after deliberately lost arm/form
responses, and verifies ID-only recovery without another save. Its original
120-second browser limit includes browser cleanup and final parent admission;
the owning database retains the original 600/540/55-second limits.

`receiver_rehearsal.py` restores an untouched native archive into a separate
empty owned database. Before restore it removes only empty-receiver schema-local
creator defaults; archived permissions then replay normally. With ingress still
closed, `restore-witness-check.sql` accepts only the exact original witness CHECK
or PostgreSQL 17's known flattened BETWEEN spelling, and recreates that one
constraint using its frozen original source. The unchanged metadata seals and
complete original rows, sequences and Auth comparisons must then pass.

The operational rehearsals first finish the original populated 208 count and Auth
checks. With only their captured ingress services stopped and drained, the real
CLI then installs the exact source-framed 209 migration. The full source-derived
ledger, original rows, Auth data, sequences and both source-property checks must
pass before ingress reopens. The restored archive's complete 209 ledger is checked
against that same source expectation before opening its receiver.

The rehearsal also restarts only its captured receiver database, requires a new
recovery epoch and independent acknowledgment, and rejects earlier sessions and
the earlier acknowledgment. After the unchanged six-login proof, it signs the
second reviewer out through GoTrue, verifies the exact session/token/AMR deletions
and logout audit, and validates a seventh password login. Counts use that new
session. Release must reject the signed-out session's retained acknowledgment
and accept its independently recorded replacement in the same recovery epoch.
Transport unit controls use OS-assigned ports, never the genuine rehearsal port.
Complete discrepancy closure and operational browser
acceptance remain release requirements. These source changes and partial proofs do not
authorize production installation or certify stock. The production SQL source omits engineering probes and masks internal errors;
it remains uninstalled until the complete genuine workflows and operational
browser pass.
