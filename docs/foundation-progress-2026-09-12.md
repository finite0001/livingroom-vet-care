# Foundation progress — 2026-09-12

This is the first implementation increment of the [practice platform plan](../plans/2026-09-12-practice-platform/plan.md), not completion of the clinical product or permission to use real patient data.

## Confirmed decisions

- Both housecalls and clinic appointments; home base 2619 Spruce Street, Boulder, Colorado; America/Denver scheduling timezone.
- Housecalls target late October 2026; physical clinic targets early 2027.
- Owned domain `thelivingroom.vet`; Stripe preferred; ezyVet integration retained.
- Owner approved the quoted $10/month dedicated Supabase project within Camp Sequoia Lake, with shared organization billing/administrators.

## Implemented

- Central practice configuration and accurate staged-opening/contact copy; removed placeholder contact details and unverified staff biographies.
- Staff invitation and password setup/recovery screens; invitation endpoint requires an active administrator and fixes its redirect server-side.
- Fail-closed staff authorization, stale-session protection, and preserved drafts across same-user token refresh.
- Explicit database privileges paired with existing RLS; anonymous contact submission retains insert-only access, and client reads require active staff.
- Server-side disabled/test/live delivery controls, exact test recipient allowlists, required practice Reply-To, and truthful provider acceptance versus delivery results.
- Conversation reply, new-message and document-send screens preserve drafts on failed or uncertain sends and prevent duplicate submissions while pending.
- npm-based CI, TypeScript checks, isolated handler tests, browser checks, database authorization tests, deployment and restore runbooks.
- Gradient text was replaced with the existing semantic primary color. The design-hook finding was fixed without suppression.

## Dedicated Supabase commissioning

Project: `livingroom-vet-care` / `mgadheotkdnrsatfivjy`, region `us-west-1`.

- All 15 repository migrations applied. MCP-generated receipt timestamps were reconciled to the repository versions after successful application; remote ledger matches the repository.
- Verified 40 public tables, all with RLS enabled; zero Auth users; no anonymous client SELECT or authenticated TRUNCATE privileges.
- `invite-staff`, `send-email`, and `send-sms` deployed with JWT verification enabled.
- Public signup and anonymous sign-in disabled. Site URL `https://thelivingroom.vet`; exact recovery redirect `https://thelivingroom.vet/hub/reset-password`.
- Saved `APP_URL=https://thelivingroom.vet`, `APP_ENV=staging`, `OUTBOUND_DELIVERY_MODE=disabled`.
- No provider credentials installed, staff invitations sent, or real client records imported.
- Original Lovable project `ugpyjacqganaqtsiekay` remains unchanged; its data is not accessible through the connected Supabase account. Repository connection settings still point to it pending migration review.

## Verification

- `npm run check`: lint (zero errors; one existing Fast Refresh warning), application/tooling TypeScript, 28 unit/handler assertions, production build all pass.
- Isolated database: clean migration replay and 19 rollback-only pgTAP authorization assertions pass.
- `npm run test:e2e`: all four Chromium checks pass together (expired reset, contact workflow, authorization denial, and draft preservation during token refresh). Fixtures mock backend/provider traffic and send no real messages.
- Deno checks pass for reviewed invitation and delivery functions. Handler tests use doubles; hosted provider round-trips are not yet verified.

## Open work and launch gates

- Vercel configuration is checked in; no Vercel deployment or DNS cutover is complete. Set environment-specific browser values explicitly before import, avoiding the tracked legacy `.env`.
- Provision shared mailboxes/sender domain, Auth SMTP and server password policy; create a verified first administrator through the trusted operator process, then test invitation/recovery.
- Implement durable outbox, idempotency, inbound email/SMS, verified delivery callbacks and operational opt-out handling before live communications. `send-provider-email` is not deployed: its baseline provider tables are missing.
- Obtain authorized ezyVet API access and decide source ownership/read-sync scope. Stripe, lab and anesthesia provider integration remain outstanding.
- Complete clinical core, schedule/reminders, vaccine certificates, inventory/billing and charting phases. Brand/logo and remaining owner review of public content remain outstanding.
- Contact requests are stored but staff triage/notification and abuse controls are not commissioned.
- Rehearse backup restoration and any existing-data migration before production cutover. Clean schema replay is not a restore drill.
- Dependency audit retains one high and three moderate findings requiring planned major-version work; large bundle and one lint warning remain documented in [dependency-baseline.md](dependency-baseline.md).

See [deployment](deployment-runbook.md), [staff access](staff-access.md), [messaging](messaging-environments.md), and [restore](restore-runbook.md) runbooks.
