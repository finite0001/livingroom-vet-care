# Repo cleanup, commit and PR plan

Date: 2026-09-23  
Branch: `codex/patient-documents`  
Baseline: `f23d534` (`feat(records): add private patient documents and retained history`)

## Objective

Convert the current multi-agent dirty tree into reviewable Git history that reconciles the repository with the already-updated hosted Supabase/Vercel state, without hiding the remaining commercial-readiness blocker: owner-approved public phone, email, emergency instructions and hours.

## Current classification

| Bucket | Scope | Commit intent |
| --- | --- | --- |
| Environment and deployment targeting | `.env` deletion, `.gitignore`, `.env.example`, `supabase/config.toml`, `vercel.json`, `package.json`, `scripts/**` | `chore(release): align deployment target and readiness tooling` |
| Historical Supabase migration recovery | Restored migrations from `20260912230000_*` through `20260916020000_*` | `chore(db): restore hosted migration history` |
| New commercial-readiness database layer | `20260922170000_*` through `20260922230000_*`, `supabase/tests/*.test.sql`, generated `src/integrations/supabase/types.ts` | `feat(db): add hosted operating-loop readiness schema` |
| Edge Function runtime | `send-email`, `send-sms`, dispatcher/callback/inbound functions, disabled legacy stubs, delivery handler tests | `feat(functions): queue outbound delivery and verify provider callbacks` |
| Hub operations UI | Hub appointment/contact/delivery pages, hooks, nav, route wiring, auth-context split | `feat(hub): add appointment, contact and delivery operations views` |
| Public launch surface | SEO metadata, route metadata, sitemap, robots, OG image, legal pages, launch-safe public copy | `feat(public): prepare launch-safe public site metadata` |
| Visual brand refresh | `src/index.css` typography swap from Inter/Montserrat to Nunito Sans/Bricolage Grotesque/Libre Baskerville | `style(brand): refresh public typography` |
| Readiness docs and evidence | `docs/**`, `docs/launch-evidence/**`, `plans/**` | `docs(readiness): record launch evidence and remaining owner gates` |

## Commit rules

1. Do not use `git add -A`; stage explicit path groups.
2. Keep the `.env` deletion grouped with `.gitignore` and `.env.example`; never print `.env` contents.
3. Do not commit `package.json` without `scripts/**`, because package scripts reference those files.
4. Keep the 96 restored historical migrations separate from the 10 new `20260922*` migrations.
5. Treat `docs/launch-evidence/*.json` as dated evidence. Before committing, decide whether local absolute path disclosure in migration-recovery artifacts is acceptable for the PR audience.
6. If a commit boundary cannot be made buildable by itself, say so in the commit body and make the final PR validation the merge gate.

## Validation before PR

- `npm run check`
- `npm run test:e2e`
- `node --test tests/delivery/*.test.ts`
- `npm run readiness:summary`
- `npm run supabase:migration-drift`
- Clean/disposable Supabase replay with `npx supabase test db` before merge, because the current long-running local stack is known to lag the new readiness migrations.

## PR strategy

Open one reconciliation PR from `codex/patient-documents` once the commits are created. The PR should explain:

- Hosted Supabase/Vercel were already advanced during the readiness wave, so this branch reconciles Git with hosted state.
- Current aggregate readiness is 4/5 gates passing.
- The remaining launch blocker is owner-approved public contact content in `src/config/practice.ts`.
- CloudTalk/public contact configuration is intentionally deferred.
- Provider dashboards/schedulers are not commissioned for live delivery, even though reviewed worker/webhook functions are deployed.

## Immediate next step

After this cleanup plan lands, stage and commit in the bucket order above, run the validation set, then create the PR. If validation fails, stop before pushing and add a failure note to the PR plan rather than burying it in a large mixed commit.
