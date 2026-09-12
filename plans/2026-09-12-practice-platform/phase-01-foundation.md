# Phase 1 — environments and dependable foundation

Priority: P0. Status: planned. Depends on: backend/account inventory. Context: [architecture](architecture.md), [audit](feature-audit.md).

## Requirements and choices

Retain the existing stack. Establish practice-owned infrastructure early enough to avoid migrating active clinical work. Keep Lovable editing through GitHub. Use one practice with authorized staff membership; do not build a general commercial multi-tenant product now.

## Implementation checklist

1. [ ] Inventory current backend ownership, deployed migrations/functions, production data, storage, auth and domains. Compare against repository migrations without exposing secrets. Resolve missing provider tables deliberately.
2. [ ] Create/reuse practice-owned staging and production Supabase; document access and recovery ownership. Disable outbound delivery in previews. Configure Vercel Vite builds and React Router deep-link rewrites.
3. [ ] Replay migrations against a clean staging database. Introduce practice scope and authenticated-actor audit fields, preserving existing IDs and effective access rules. Regenerate Supabase types.
4. [ ] Fix password reset, add admin-only staff invitation, and document a one-time operator-controlled first-admin bootstrap. Never use an unauthenticated “first caller becomes admin” endpoint.
5. [ ] Centralize practice identity: name/address/timezone, housecall and future clinic service modes, phone/email/hours, vetted emergency referral. Remove unverified public contact paths from launch content.
6. [ ] Establish CI build, explicit TypeScript check, lint and targeted database/browser tests. Resolve baseline failures and triage dependency advisories without blindly upgrading everything.
7. [ ] Add deployment, restore and rollback runbooks, environment manifest without values, error monitoring and staff-visible service health. Define recovery objectives with the practice owner.
8. [ ] Begin domain/email verification, SMS onboarding, Stripe sandbox and veterinary API-access discovery immediately; approvals are external dependencies.

## File work

- Modify `/Users/davidedler/livingroom-vet-care/src/App.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/contexts/AuthContext.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/pages/LoginPage.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/pages/AdminStaffPage.tsx` for invite/recovery flow.
- Create `/Users/davidedler/livingroom-vet-care/src/config/practice.ts`, `/Users/davidedler/livingroom-vet-care/src/hub/pages/ResetPasswordPage.tsx`, `/Users/davidedler/livingroom-vet-care/supabase/functions/invite-staff/index.ts`.
- Add versioned SQL under `/Users/davidedler/livingroom-vet-care/supabase/migrations/`; regenerate `/Users/davidedler/livingroom-vet-care/src/integrations/supabase/types.ts`.
- Create `/Users/davidedler/livingroom-vet-care/vercel.json`, `/Users/davidedler/livingroom-vet-care/.github/workflows/ci.yml`, `/Users/davidedler/livingroom-vet-care/docs/deployment-runbook.md` and `/Users/davidedler/livingroom-vet-care/docs/restore-runbook.md`.
- No planned deletions. Exact migration filenames allocated at implementation time.

## Acceptance and risks

Fresh environment supports bootstrap → staff invite → password setup → login → recovery. Inactive/nonmember users cannot access patient rows/files; staff cannot promote themselves. Deep links load directly on Vercel. Restore a synthetic dataset and files into staging and verify relationships. CI is green. No preview can send to real clients. Migration drift and unknown live data are the principal risks; inventory before changing endpoints.

Next: phase 2 plus mailbox/API prototypes from phases 3 and 5.
