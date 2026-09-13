# Prescription intake — staging rollout

September 13, 2026. Target `kothoqicubowyhwfsrte`. PR118 passed frontend, database and Edge CI at `0041468399ba4753c4f5f5f593bb2437f573eedf` in run34782248989 and merged into the release integration branch. This rollout uses merge2ae935b, whose application files match that tested head.

## Installed and verified

The explicit-project CLI dry run identified only migrations5500 and5600. Both were applied using `--include-all --skip-vault`; the existing later9000 receipt was preserved. Staging now has77 canonical migration versions. All six prescription header/item tables have RLS and deny anonymous reads and authenticated/service-role direct inserts. Six immutable triggers are enabled.

Claim/stage RPCs permit service-role execution only. Internal projections, parent validation and renamed staging implementations have no API-role execution. The six administrator discovery/recovery/candidate RPCs allow authenticated execution but enforce administrator identity internally. Actual authenticated-role calls without a staff identity rejected all six with42501 in a rolled-back transaction.

Only `ezyvet-import` was deployed. Its preflight version4 had the previously recorded version3 bundle hash; the source was unchanged. The new function is ACTIVE version5 with JWT verification enabled. All three downloaded runtime files match the tested source exactly. Anonymous POST returns401. The manifest and [sanitized evidence](evidence/prescription-intake-staging-20260913.json) record the bundle and migration hashes.

Auth users, clients, pets, import runs, Storage objects and outgoing messages remain zero. No source request, secret update, import-mode activation, read-scope expansion, scheduler activation or policy acceptance occurred. The existing protected frontend was not replaced in this increment.

## Security advisor review

The advisor reports60 private RLS tables without policies,7 existing anonymous security-definer findings and215 authenticated security-definer findings. The six new private ledger tables intentionally expose no direct API privileges; their [RLS policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) do not justify adding access policies. The six new [authenticated RPC notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) were checked against effective grants, internal administrator checks and the hosted rejection probes above. This is targeted deployment review, not a claim that all baseline advisories are resolved.

## Remaining work

Local intake evidence includes43 actual synthetic Auth/HTTP checks,53 contention checks and25 focused browser cases. Hosted boundary checks do not establish signed-in staff or live provider acceptance. Whole-prescription reconciliation and veterinarian review, chart history, record-release inclusion, populated prescription backup/restore evidence, source sample acceptance and Dr. Edler's review remain required. Intake creates no local prescribing, refill, dispensing, inventory, billing or communication action.
