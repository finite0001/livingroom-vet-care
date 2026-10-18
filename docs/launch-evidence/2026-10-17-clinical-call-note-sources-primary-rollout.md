# PR 272 primary rollout

PR 272 passed all required checks at `f41f789cf7e660cef1cc1bcc413fa1da9f574155` in [CI run 39070363831](https://github.com/finite0001/livingroom-vet-care/actions/runs/39070363831). Dave specifically authorized merge and deployment. It merged as `4be7133172273eefab3e16a8cc806d20438a23fa` on 2026-10-17. The [sanitized receipt](2026-10-17-clinical-call-note-sources-primary-rollout.json) records the deployment and private evidence hashes.

## Database and gates

Primary `mgadheotkdnrsatfivjy` now has 202 migrations, latest `20261017135245`. The dry run selected exactly the approved migration; Vault updates were skipped. Its bytes match the reviewed source and prior staging proof.

All 395 original public table fingerprints were preserved; three autonomous scheduler-run appends preserved the original ledger prefix. All existing routine owners and effective permissions were preserved. The 16 planned replacement bodies and nine new private routine bodies match source; 1,306 unrelated routines are unchanged. Existing table metadata and the precise job CHECK/constraint-trigger changes match the tested migration. Both new private tables deny direct client access; all four new foreign-key indexes exist.

All 55 Edge Functions and secret metadata are unchanged. Capture and call-generation flags remain absent/default-off. The new generation policy is v1 draft, with zero bindings. Existing audio policy is unchanged. No clinical row or real provider request was created for this rollout. No new call admission, generation or acceptance API/UI is part of PR 272.

## Security advisor review

The current advisor baseline contains 572 WARN findings. Every original finding is unchanged. One new generic `authenticated_security_definer_function_executable` WARN applies to the intentionally granted `read_clinical_call_note_job_v1` RPC. This is recorded rather than suppressed; see [the advisor's explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The RPC's deployed definition, fixed search path, owner and grants match the tested source. It requires the hardened current ADMIN, unbanned user, live Auth session and canonical source association, repeating actor validation after source-lock waits. Anonymous and service-role execution are denied. The CI access/compatibility proof covers the relevant refusal and observed-wait cases; production verification checks the deployed definitions and permissions, not a new authenticated clinical test. No other advisor finding was added, removed or changed. Earlier staging advisor receipts describe their original tool output and remain preserved.

## Frontend

Vercel production deployment `dpl_8auNQ1jfwzczuRpQdnVue6eyAGHm` is READY for the merge commit. The exact-commit GitHub Vercel success status links the same deployment ID served by `thelivingroom.vet` and `www.thelivingroom.vet`. Project/team: `livingroom-vet-care` / `daves-projects-e0da43ba`. The CLI was used after the connector could not resolve this team's project.

Actual production login checks at 1440px and 390px returned HTTP 200, rendered both fields and Sign in, showed no horizontal overflow or page errors, and redirected an unauthenticated Patient 360 request to login. Both screenshots were visually inspected. This is public-layout/protected-route verification; authenticated clinical workflow and physical iPhone/Safari acceptance are not claimed.

## Next increment

The 3B.1 release dependency is complete. Continue segment-supported OpenAI request/response validation and then the guarded admission/generation/private-review increment. Susan's call-processing/retention approval, bounded clinical fidelity evaluation and explicit provider commissioning remain separate from this deployment.
