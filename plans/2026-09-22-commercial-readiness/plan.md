# The Living Room Vet — commercial-readiness plan

Date: 2026-09-22  
Repo: `/Users/davidedler/livingroom-vet-care`  
Baseline: `f23d534` (`codex/patient-documents`)  
Target: controlled housecall pilot in late October 2026; clinic release remains early 2027.

## Executive decision

Do not attempt a full commercial launch from the current feature inventory. Finish and prove a narrow housecall operating loop first:

`client/patient → appointment → reminder → visit/SOAP → offered preventive service → invoice/payment → selected record delivery → reply/follow-up`

The existing foundation, clinical core, and private patient-document increments are useful building blocks, but they are not evidence of production readiness. The launch decision depends on hosted provider round-trips, migration/restore proof, clinician acceptance, and a real staff pilot.

## Current status

| Area | Status | Evidence / implication |
|---|---|---|
| Auth, staff gating, reset, delivery policy | Implemented increment | `src/hub`, foundation docs, isolated tests; hosted staff acceptance still open |
| Client/patient identity, weights, SOAP, problems | Implemented increment | Clinical migration and browser/SQL tests; merge, correction, and clinician review remain |
| Private patient documents | Implemented increment | Private storage, immutable metadata, recovery tests; package export/delivery remains |
| Public website | Prelaunch lead-capture foundation locally; not launch-approved | Routed marketing/legal pages, SEO assets, and Hub contact triage exist; contact, hours, services, staff, emergency referral, legal copy, photography, and housecall claims require owner/veterinarian review |
| Messaging/inbox | Local foundation implemented; not commissioned | Durable outbox, staff-send queueing, signed status callbacks, signed inbound SMS/STOP-START handling, Hub delivery visibility, and guarded retry/cancel controls now exist locally with tests; reconciliation workflow, deployment/registration, provider-document outbox, inbound email, voice/voicemail, and real provider round-trips remain |
| Scheduling/reminders | Partial local foundation; not launch-ready | Appointment write-safety RPCs and reminder-to-outbox invalidation exist; availability windows, travel buffers, clinician capacity, and hosted acceptance remain |
| Vaccines/inventory/billing | Not implemented | No stock ledger, invoice ledger, certificates, Stripe reconciliation, or atomic administration workflow |
| ezyVet/lab/anesthesia integrations | Discovery blocked / unverified | No authorized account, sample payload, or source-of-truth decision |
| Backend/Vercel/domain cutover | Partially commissioned; not launch-approved | Dedicated Supabase is the tracked and linked local CLI target; historical receipts and the 10 readiness migrations are reconciled with 123 matching hosted migrations. Vercel Production browser envs point at the dedicated backend, and `thelivingroom.vet` / `www.thelivingroom.vet` are attached and Vercel-verified after the GoDaddy DNS update. Public contact content, HTTPS smoke after certificate provisioning, provider registration, Auth SMTP, monitoring, backup/restore and live-send approval remain |
| Current verification | Hosted release gate mostly green; public launch gate blocked | `npm run readiness:refresh` passed on 2026-09-23 and the aggregate summary records 4/5 gates passing. The remaining blocker is owner-approved public phone, email, emergency instructions and hours. Final release certification still needs clean local DB replay, provider smoke, staff/Auth acceptance, and restore proof |

## Updated plan after 2026-09-23 multi-agent readiness audit

The codebase is now closest to a controlled prelaunch lead-capture and staff-ops staging candidate, not a full commercial launch. The next work should avoid broad new feature expansion until the existing local capabilities are proven against the actual hosted stack.

1. **Freeze release-control scope and preserve the dirty tree.** Commit or otherwise checkpoint the local build/deployment contract before expecting Vercel to build remotely, because the Vercel project already expects `npm run build:deployment`.
2. **Keep read-only hosted evidence fresh.** Current evidence shows migration/function/domain reconciliation complete for the selected hosted backend. Re-run the inventory chain before any launch decision so drift, domains and function modes are current.
3. **Preserve Supabase history in Git.** Commit the 96 restored historical receipts separately from the 10 new commercial-readiness migrations so reviewers can distinguish ledger recovery from new behavior.
4. **Commission one hosted staging drill in test mode.** With the outbox/contact/appointment readiness pieces already applied to the chosen backend, prove: anonymous contact submit → Hub triage/audit; staff email queueing; staff SMS queueing; appointment reminder enqueue/dispatch; provider delivery callback; STOP/START; and inbound SMS reply.
5. **Finish owner and provider gates.** Confirm public contact fields, HTTPS, Auth SMTP, sender domain, SMS number/webhooks, monitoring, and backup/restore proof before content/legal/owner approval and live delivery mode.
6. **Then resume housecall operating-loop features.** Once the hosted commissioning drill is green, continue with availability/travel buffers, inventory/billing/certificates, and the approved clinical scope for the October pilot.

## Workstreams and order

1. [Release control and environment proof](phase-01-release-control.md) — P0, blocks every live-data or provider change.
2. [Housecall operating loop](phase-02-housecall-operating-loop.md) — P0, the minimum sellable service workflow.
3. [Preventive care, inventory, billing](phase-03-preventive-inventory-billing.md) — P0 for any service offered in October.
4. [Pilot, public launch, and full platform](phase-04-pilot-launch-and-full-platform.md) — P0 release gate and P1 follow-on scope.

## Release boundaries

### Late-October housecall pilot

Must support only the services the veterinarian explicitly approves. Required capabilities: client/patient records, serious alerts, housecall addresses/access notes, calendar and travel buffers, reminders, SOAP, controlled email/SMS, patient documents, any offered vaccine/medication workflow, invoices/payment, and operational monitoring.

Do not advertise clinic care, dental, anesthesia, lab automation, or other services until the corresponding workflow exists and is accepted.

### Early-2027 clinic release

Add rooms/resources, clinic operating hours, clinic/mobile stock transfer, card-present payment if needed, and the advanced charting/integration work that the actual service menu requires.

## Definition of commercial readiness

The product is ready for a controlled pilot only when all of these are true:

- A named practice owner controls domain, Supabase, Vercel, Auth SMTP, email, SMS, payment, and veterinary-vendor accounts.
- Staging and production are separate; outbound delivery is disabled in previews; production migrations are reconciled to the repository.
- A staff member can be invited, recover access, sign in, create a household/patient, and recover an interrupted draft.
- The complete approved housecall scenario passes with synthetic data and then with a limited staff pilot.
- Every outbound message has accepted/delivered/failed/unknown semantics, staff can inspect delivery state, and failed sends have retry/reconciliation controls; inbound SMS and provider callbacks are authenticated and idempotent after deployment/registration; inbound email and voice/voicemail are either implemented or excluded from launch scope.
- Inventory, charge, invoice, certificate, and payment events are atomic or reconciled, replay-safe, and attributable.
- A backup/file restore rehearsal succeeds, including RLS and private documents.
- The veterinarian approves SOAP, alerts, vaccine records, certificates, and any offered clinical forms.
- Public content contains no placeholder contact information or unverified claims.

## Unresolved decisions

See [decisions.md](decisions.md). These are not optional planning details: service scope, provider access, and source-of-truth choices change the implementation and launch date.
