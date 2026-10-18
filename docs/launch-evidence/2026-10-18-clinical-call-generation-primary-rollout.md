# PR 274 — approved default-off production rollout

PR [274](https://github.com/finite0001/livingroom-vet-care/pull/274) is merged at `2a21c4591ff7ac753cbd0c944ea28444b98954c8` and deployed. Staging and primary database/Edge verification preceded the frontend merge. Call capture and generation remain off; both policies remain draft. No real provider requests, clinical writes, signing, delivery or policy approval occurred during this rollout.

## Exact revision and CI

All four jobs in [run 39097285696](https://github.com/finite0001/livingroom-vet-care/actions/runs/39097285696) passed at reviewed head `034ee3c8b7fc49e76d5079667121b1d5ae60e5ef`: frontend, Edge, database and diagnostic renderer.

The preceding run failed because four existing current-runtime harnesses still expected migration 202. The invoice-reminder, dictation, audio and note guards now expect 203. Historical upgrade fixtures were preserved. A TypeScript AST preflight now catches multiline ledger-count assertions. All four corrected owned local workflows passed Auth/API/browser/restore checks and removed their runtimes; then the complete exact-head CI passed. The earlier failure is retained, not represented as a successful run. The feature's existing 230-file end-to-end and 214-file compatibility proof inputs remained unchanged.

## Backend preservation and access

| Verification | Staging | Primary |
| --- | --- | --- |
| Project | `kothoqicubowyhwfsrte` | `mgadheotkdnrsatfivjy` |
| Migration ledger | 203, exact source parity | 203, exact source parity |
| Existing tables/routines preserved | 397 / 1,331 | 397 / 1,331 |
| New routines verified | 24: 13 authenticated, three service, eight private | Same |
| Prior Edge Functions unchanged | 54 | 55 |
| New worker | `clinical-call-note-process`, ACTIVE v1, JWT required | Same |
| Downloaded worker/import sources | All ten exact reviewed files | All ten exact reviewed files |
| Anonymous / invalid-token requests | 401 / 401 | 401 / 401 |
| Authenticated role without live session | Private read denied | Private read denied |
| Call capture/generation flags | Absent | Absent |
| Call policies / bindings / actions | Draft / zero / zero | Same |

Migration `20261018032610` has SHA256 `ccb3c9460a20da848fd0fd262facf58ae8249b3ce6b4d869f2d41963bf71eb72`. It adds one private immutable action journal, 24 routines and two foreign-key indexes. Existing routine definitions, owners, effective grants, table security/catalog metadata and clinical row fingerprints were preserved. Primary comparison uses a fresh immediate preinstall baseline, so the CI wait is excluded from its data-comparison window. No existing routine was replaced.

Secret names/digests and custom-secret metadata were unchanged. Supabase refreshed built-in secret timestamps during deployment; those digests stayed unchanged. Unrelated existing processing and delivery configuration was preserved.

Hosted security advisors changed from 573 to 586 on each target. All prior findings were unchanged. The 13 additions are the generic warning for intentionally authenticated `SECURITY DEFINER` entrypoints, reviewed against their exact source, active staff/session/administrator guards and effective grants. The separate local proof observes authorization changes under real lock waits. No warnings were suppressed. See the [advisor definition](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Frontend verification

GitHub's successful Vercel status for the exact merge identifies deployment `dpl_GZZKzWcKY3A8gAQFDDtSgmQdKdFp`. Native Vercel inspection verified **READY**, **production**, and aliases `thelivingroom.vet`, `www.thelivingroom.vet` and `livingroom-vet-care.vercel.app`.

Public Chromium checks at 1440px and 390px returned HTTP 200, rendered both login fields and Sign in, redirected unauthenticated protected navigation to login, and found no page errors or horizontal overflow. Both screenshots were inspected. These checks do not claim authenticated clinical acceptance or physical iPhone/Safari acceptance.

The [machine-readable receipt](2026-10-18-clinical-call-generation-primary-rollout.json) retains source/proof hashes, project results, advisor names, deployment identity and browser evidence. Private snapshots and screenshots remain outside Git.

## Remaining

[Phase 3B.3 preparation](2026-10-18-clinical-call-fidelity-preparation.md) freezes ten fictional cases and provides offline review and protected-transport safeguards. Actual provider execution, independent clinical adjudication, Susan's call-processing/retention approval, authorized provider commissioning and physical device acceptance remain separate. This deployment activates none of them.
