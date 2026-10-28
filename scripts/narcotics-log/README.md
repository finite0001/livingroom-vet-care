# Narcotics log verification

This package belongs to **Living Room Vet**. GreenTree, VetConnect Hub and ezyVet
are separate work.

The two new migrations contain the staff record-review backend and the count,
stock-entry, witnessing, administration and correction backend. They follow the
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
208-file application.

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
