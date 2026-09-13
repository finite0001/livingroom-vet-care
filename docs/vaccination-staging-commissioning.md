# Vaccination intake staging commissioning — September 13, 2026

Target: `kothoqicubowyhwfsrte` / Living Room Vet staging. Source: PR109 commit `22bdbf307622fb6ea45b21d10c7fe544da621432`, subsequently merged into `codex/ezyvet-reviewed-history` as `c7687819dc02dd16bc71c0457e19cfc0c360af72`. This was not a main merge or public cutover.

## Deployment and verification

All three CI jobs passed in [run34774630744](https://github.com/finite0001/livingroom-vet-care/actions/runs/34774630744): frontend, Edge and database. Local evidence includes 43 actual Auth/HTTP checks and exact source/receipt preservation through the 51→72 migration upgrade/restore; see [runtime evidence](vaccination-runtime-evidence.md).

The explicit-project CLI dry run identified only migration `20260913520000_consult_scoped_vaccination_import.sql`. It was then applied through the CLI with `--skip-vault`; no seeds or roles were applied. Hosted history now has exactly72 migrations and one5200 receipt. Migration SHA256: `f5e52dffeb5e074d8f09496e968cb4392d098d27cad983600b88746115d11238`.

Only `ezyvet-import` was deployed from this source revision, using the explicit staging project reference and server-side bundling. It is ACTIVE, version3, with JWT verification true and bundle SHA256 `a0b3a0a70358d9889a3eb99f4263edcaaea513191e195185664812aba6c5fbad`. Anonymous POST returned401. The optional-partner correction is now in hosted staging, not only local code. The refreshed [function manifest](staging-edge-manifest.json) records current platform versions; all other function bundle hashes remain the previously recorded values.

Hosted verification confirms the three new tables have RLS enabled; anon SELECT, authenticated INSERT and service-role INSERT are denied. The claim RPC is service-only. Projection and validation helpers are private. Candidate/run/recovery RPCs are authenticated-only and enforce active ADMIN in their bodies. No anonymous execution was granted.

After deployment, Auth users, clients, pets, import runs and vaccination runs are all zero. No provider request, patient import, staff creation, secret change, policy activation or client delivery was performed during this commissioning. Existing source read-only authentication proof remains separate from live vaccination sample acceptance.

## Advisor triage

The three new RLS-without-policy notices are intentional: direct table access is denied and access goes through validated RPCs. The three new authenticated SECURITY DEFINER notices describe intended ADMIN-gated read/recovery RPCs, covered by direct permission inspection and local denial tests. See Supabase's [RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [function-execution notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Existing baseline findings remain: one mutable-search-path warning for `payment_immutable`, seven anonymous SECURITY DEFINER findings and other authenticated RPC findings. This deployment does not claim those baseline findings are resolved or that all hosted security review is complete. The [search-path remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) belongs in the separate security-hardening review.

## Remaining commissioning

Protected frontend URL, staff access, production-source resource activation, authorized vaccination samples and Dr. Edler's interpretation review remain pending. Imports remain disabled/unset; delivery and scheduling gates were not changed. The next planned clinical increment is [reviewed outside vaccination history](../plans/20260913-ezyvet-clinical-import/phase-03b-reviewed-vaccination-history.md), followed by explicit due-plan adoption. Staging deployment does not complete that clinical work or the commercial launch.
