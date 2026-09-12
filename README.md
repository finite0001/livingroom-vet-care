# The Living Room Vet

Boulder veterinary practice website and staff workspace. Home base: 2619 Spruce Street. Housecalls target late October 2026; the clinic targets early 2027. Owned domain: **thelivingroom.vet**.

The application uses React 18, TypeScript, Vite, Tailwind, shadcn/ui, React Router 6 and Supabase. Lovable remains connected through GitHub. This is an evolving practice platform; the clinical checklist is not yet fully implemented.

## Development

Use Node 22 and npm. `package-lock.json` is the validated install path; see [dependency notes](docs/dependency-baseline.md) for legacy Bun lockfiles.

```sh
npm ci
# Create .env.local using .env.example and your isolated local/staging values.
npm run dev
```

The tracked `.env` still points at the original Lovable backend. Override it before local integration work. Never use production data for browser tests, and never place service-role or provider secrets in `VITE_*` variables.

## Verification

```sh
npm run check
npx playwright install chromium
npx playwright test
```

`check` runs lint, frontend/config TypeScript, Node policy/handler tests and a production build. Browser tests run a separate dev server with synthetic configuration and mocked backend calls. Database policy checks are in `supabase/tests/staff_access.test.sql` and must run on an isolated migrated database.

## Current foundation

- Public password setup/recovery route, invitation-only staff onboarding, fail-closed staff authorization and account-safe cache handling.
- Server-controlled outbound disabled/test/live modes; exact test recipient allowlists and explicit provider acceptance versus delivery.
- Draft preservation on rejected or uncertain sends; real delivery/inbound callbacks and durable outbox remain planned.
- Central practice settings with both launch stages and verified domain/address. Unconfigured phone/mailbox/hours are not advertised.
- Explicit database grants, CI checks and Vercel SPA configuration.

The new dedicated Supabase project is `mgadheotkdnrsatfivjy`; the original Lovable backend remains unchanged. Connection cutover, data migration, provider credentials and public deployment require the commissioning steps below.

## Clinical core increment

The patient workspace adds identity details, weight history, SOAP drafts/signing/addenda and important historical problems. Household contacts and addresses can be edited, with server search and duplicate review. See [clinical workflow and deployment gates](docs/clinical-core.md). Apply the clinical migration to the active backend before frontend rollout; the original Lovable connection has not been switched.

## Working documents

- [Implementation plan and feature audit](plans/2026-09-12-practice-platform/plan.md)
- [Housecall and clinic release schedule](plans/2026-09-12-practice-platform/release-schedule.md)
- [Deployment runbook](docs/deployment-runbook.md)
- [Staff access and first-admin bootstrap](docs/staff-access.md)
- [Messaging environments](docs/messaging-environments.md)
- [Restore procedure](docs/restore-runbook.md)
- [External ezyVet integration plan](plans/2026-09-12-practice-platform/external-pims-integration.md)

Use reviewed branches/PRs and recheck the latest GitHub state before merging because Lovable may push concurrently. Do not change the active backend merely by replacing the project ID without reconciling data, auth, files and integrations.
