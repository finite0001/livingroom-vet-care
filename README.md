# The Living Room Vet

Boulder veterinary practice website and staff workspace. Home base: 2619 Spruce Street. Housecalls target late October 2026; the clinic targets early 2027. Owned domain: **thelivingroom.vet**.

The application uses React 18, TypeScript, Vite, Tailwind, shadcn/ui, React Router 7 and Supabase. Lovable remains connected through GitHub. This is an evolving practice platform; the clinical checklist is not yet fully implemented.

## Development

Use Node 22.12 or newer and npm. `package-lock.json` is the validated install path; see [dependency notes](docs/dependency-baseline.md) for legacy Bun lockfiles.

```sh
npm ci
# Create .env.local using .env.example and your isolated local/staging values.
npm run dev
```

The repository intentionally does not track a real `.env` file. Keep `.env` and `.env.local` ignored, derive local browser values from `.env.example`, and never place service-role or provider secrets in `VITE_*` variables.

## Verification

```sh
npm run check
npx playwright install chromium
npx playwright test
```

`check` runs lint, frontend/config TypeScript, Node policy/handler tests and a production build. Browser tests run a separate dev server with synthetic configuration and mocked backend calls. Database authorization, concurrency and workflow checks are in `supabase/tests/` and must run on an isolated database with the relevant migrations applied. Passing synthetic tests does not establish hosted/provider or clinical acceptance.

## Implemented platform and remaining commissioning

- Public password setup/recovery route, invitation-only staff onboarding, fail-closed staff authorization and account-safe cache handling.
- Server-controlled outbound disabled/test/live modes; exact test recipient allowlists and explicit provider acceptance versus delivery.
- Durable communication outbox, verified inbound/status handlers, per-staff inbox state and draft recovery after rejected or uncertain enqueue responses. These are implemented; configured live provider round-trips remain a commissioning gate.
- Central practice settings with both launch stages, owned domain and home-base address. Planned hours are Monday–Saturday, 9 am–5 pm America/Denver; unconfigured phone and mailbox are not advertised. Display hours do not create bookable availability.
- Reviewed care due plans, a disabled-by-default reminder scheduler/outbox bridge and administrator policy controls. Saving wording or a policy does not activate providers or send a message.
- Selected clinical-record packages, preserved historical export and reviewed frozen email attachments through the outbox, plus public inquiry triage and recoverable contact intake.
- A public header/footer medical-logo candidate with live readable text; owner approval and a final optimized/vector master remain pending.
- Explicit database grants, CI checks and Vercel SPA configuration.

Implementation status spans current hosted evidence and historical branch receipts. Reviewed historical ezyVet weight promotion and schema-4 release provenance retain original source values, local reviewed measurements and discrepancy history; no live ezyVet credentials or import activation is implied. See the [readiness evidence tracker](docs/commercial-readiness.md) for current checks and open gates.

The selected dedicated Supabase project is `mgadheotkdnrsatfivjy`. Hosted migrations are at parity, Vercel Production targets that backend, and the original Lovable backend remains retained historical state. Provider credentials, public contact content and live commissioning still require the steps below.

## Clinical workspace and acceptance

The patient workspace includes identity details, weight history, SOAP drafts/signing/addenda, important historical problems, dental and qualitative QOL/body-map charts, native anesthesia records, due plans and certificates. Household contacts and addresses can be edited with server search and duplicate review. These forms await Dr. Susan Edler’s acceptance through the [editable clinical review pack](docs/clinical-review/README.md) and [synthetic offline examples](docs/clinical-review/review-examples.html). Native manual anesthesia records do not imply automatic vendor import, and Antech selection does not imply an active lab connection. See [clinical workflow and deployment gates](docs/clinical-core.md); hosted migration parity does not replace clinical/provider acceptance.

## Working documents

- [Implementation plan and feature audit](plans/2026-09-12-practice-platform/plan.md)
- [Housecall and clinic release schedule](plans/2026-09-12-practice-platform/release-schedule.md)
- [Deployment runbook](docs/deployment-runbook.md)
- [Staff access and first-admin bootstrap](docs/staff-access.md)
- [Commercial readiness and current CI evidence](docs/commercial-readiness.md)
- [Clinical review register](docs/clinical-review/README.md) and [form-by-form decisions](docs/clinical-review/forms-and-decisions.md)
- [Email domain setup and commissioning status](docs/email-domain-setup.md)
- [Messaging environments](docs/messaging-environments.md), [durable outbox](docs/communications-outbox.md), [inbound processing](docs/inbound-communications.md) and [reload recovery](docs/message-recovery.md)
- [Care plans](docs/care-reminders.md) and [guarded reminder scheduler](docs/reminder-dispatch.md)
- [Reminder policy controls](docs/features/reminder-delivery-settings.md)
- [Frozen release email delivery](docs/release-email-delivery.md), [reviewed ezyVet weights](docs/ezyvet-reviewed-weights.md) and [schema-4 weight provenance](docs/release-weight-provenance.md)
- [Selected-record releases](docs/record-releases.md) and [website inquiry workflow](docs/features/website-inquiries.md)
- [Public logo candidate and responsive previews](docs/brand/public-logo-integration.md)
- [Restore procedure](docs/restore-runbook.md)
- [Antech commissioning requirements](docs/antech-commissioning.md)
- [External ezyVet integration plan](plans/2026-09-12-practice-platform/external-pims-integration.md)

Use reviewed branches/PRs and recheck the latest GitHub state before merging because Lovable may push concurrently. Do not change the active backend merely by replacing the project ID without reconciling data, auth, files and integrations.
