# Phase 1 — release control and environment proof

Priority: P0. Status: hosted migration/function/domain reconciliation is evidenced for the current backend; launch remains blocked by owner content, provider commissioning and restore/staff acceptance. Depends on: owner access to current backend and provider accounts.

## Objective

Establish one authoritative deployment path and prove that the system can be operated safely before adding more clinical features.

## Implementation steps

1. Re-run `npm ci`, `npm run check`, browser tests, and isolated database tests. Record current failures separately from the historical September baseline. Current state: frontend preflight is green; official `npx supabase test db` reaches the retargeted local stack but fails on schema drift until reset/replay.
2. Inventory old Lovable backend, dedicated Supabase, Vercel, DNS, Auth SMTP, storage, scheduled jobs, provider callbacks, secrets, and existing records. Do not switch URLs during inventory. Current state: CLI and Vercel Production browser envs point at `mgadheotkdnrsatfivjy`; Lovable/browser alternates and provider dashboards still require deliberate confirmation. Use `npm run readiness:inventory` for the repeatable non-secret Vercel/DNS/Supabase snapshot, then supplement it with provider-account evidence outside Git.
2a. Reconcile Supabase migration history before hosted rollout. Current 2026-09-24 evidence records 148 matching local/remote versions, 0 remote-only receipts, and 0 local-only migrations after applying the post-PR #204 hosted rollout. Current remote public-schema inventory shows the operating-loop table/RPC/trigger objects present, and current Edge Function inventory shows the dispatcher/callback/inbound-SMS function slugs active remotely with expected JWT modes.
2b. Preserve Vercel build parity before remote deploys. The hosted Vercel project expects `npm run build:deployment`; make sure the local `package.json`/`vercel.json` deployment contract is committed before using a remote deployment as evidence.
3. Choose migration versus continued use of the old backend. If migrating, rehearse rows, Auth identities, Storage objects, settings, and IDs into staging; compare counts, relationships, and file hashes.
4. Create a production/staging environment manifest and secret ownership register. Keep all server secrets out of `VITE_*`, logs, Git, and chat.
5. Prove staff bootstrap → invitation → password setup → recovery → deactivation. Verify no self-signup, anonymous clinical access, cross-practice access, or staff self-promotion.
6. Commission Vercel preview/staging/production separately. Verify direct deep links, environment values, SPA rewrites, cache clearing on account switch, and rollback instructions. Run `npm run public:readiness` before any public/domain cutover; current audit blocks launch on missing phone, email, and emergency phone/instructions. Run `npm run hub:readiness` before treating Hub workflows as hosted-ready; current local Hub workflow wiring and hosted dependencies are ready for the audited workflows. Run `npm run readiness:refresh` to regenerate the ordered evidence chain, then `npm run readiness:summary` or its fail-on-blockers mode to produce the aggregate launch gate.
7. Add operational visibility: failed jobs, provider acceptance, unknown outcomes, webhook replay, backup status, and staff-visible service health. Public contact form now has DB-side same-email throttling and duplicate-submission blocking; remaining work is edge/IP captcha-style protection and operational monitoring.
8. Perform a restore rehearsal into an isolated destination, including private document bytes, Auth mapping, RLS, audit history, and one synthetic visit.

## Files

- Modify: `/Users/davidedler/livingroom-vet-care/docs/deployment-runbook.md`, `/Users/davidedler/livingroom-vet-care/docs/restore-runbook.md`, `/Users/davidedler/livingroom-vet-care/docs/staff-access.md`, `/Users/davidedler/livingroom-vet-care/docs/messaging-environments.md`, `/Users/davidedler/livingroom-vet-care/.env.example`.
- Create: `/Users/davidedler/livingroom-vet-care/docs/environment-manifest.md`, `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/` records, and any required versioned migrations/tests.

## Success criteria

- Frontend checks are green; database checks either run against a clean replayed stack or have named, accepted exceptions with rollback/disposable-stack evidence. Current frontend proof includes the 2026-09-23 `npm run preflight:deployment` pass after the contact-abuse update.
- Target backend and frontend are explicitly identified; no accidental old-backend CLI or browser writes.
- Restore drill and hosted staff workflow are evidenced.
- Preview environments cannot send to real recipients or mutate production.

## Risks

Unknown old-backend data, Lovable concurrent pushes, missing SMTP/provider ownership, and a false sense of safety from clean-schema tests. Mitigate by freezing cutover, reconciling migration receipts, and requiring evidence before enabling production delivery.
