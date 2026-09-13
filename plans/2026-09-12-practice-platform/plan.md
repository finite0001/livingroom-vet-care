# Living Room Vet — practice platform plan

Date: 2026-09-12. Planning baseline: `77e08d1`. Status: full commercial-readiness goal active; implementation and verified rollout in progress. See [commissioning and verification](../../docs/foundation-progress-2026-09-12.md).
Practice: Living Room Vet, 2619 Spruce Street, Boulder, Colorado.

## Recommendation

Extend this repository into one practice system: public website, staff workspace, patient records, communications, scheduling, inventory and billing. Keep React/TypeScript/Tailwind/shadcn and the owner-approved patched React Router v7. Keep Lovable connected through GitHub. Establish practice-owned managed Supabase before real patient onboarding; deploy the frontend to Vercel when the staging checks pass.

Use a practice-owned email domain with Resend as the initial inbound/outbound email provider and Twilio for SMS. Store the authoritative inbox in Supabase. AgentMail is an alternative to evaluate in a small mailbox prototype, not a required second provider. Use Stripe for new payments. Preserve the veterinary-software API connection, with Living Room Vet as the primary record system and ezyVet as a reviewed import source.

## What exists

The repo has a public website, staff authentication, clients/basic pets, conversation UI, templates, files, tickets, and outbound Resend/Twilio code. Many clinical features have only tables or are absent. Outbound provider configuration and live delivery are unverified. See the [complete feature matrix and evidence](feature-audit.md).

## Working assumptions

- Confirmed: both clinic visits and housecalls; 2619 Spruce Street is the home base.
- Staff-only clinical workspace first; clients receive controlled document/payment links. A full client portal is later scope.
- Confirmed targets: housecalls as early as late October 2026; physical clinic early 2027. Stripe is preferred. Owned domain is `thelivingroom.vet`. Antech is the selected laboratory; its onboarding contact is not yet assigned. Staff capacity, anesthesia vendor and data-import volume remain unknown.
- Confirmed: retain external veterinary-software API access. ezyVet is confirmed as the requested integration and implemented in the reference; Living Room Vet is primary and ezyVet supplies imports. Authorized source account access, clinical resource contracts and migration completeness still require verification.
- Automatic anesthesia/device and laboratory ingestion depends on the actual vendor interface; provide manual import while validating it.
- Dr. Susan Edler will review clinical workflows and certificate content; acceptance remains pending.

## Delivery sequence

| Phase | Deliverable | Depends on | Status |
|---|---|---|---|
| [1. Foundation](phase-01-foundation.md) | Owned environments, auth, schema reliability, CI, practice settings | Owner/vendor inventory | In progress |
| [2. Clients and clinical core](phase-02-clinical-core.md) | Complete patients, SOAP, diagnoses, alerts, files | 1 | In progress |
| [3. Communications and scheduling](phase-03-communications-scheduling.md) | Two-way inbox, attachments, appointments, reminder engine | 1; patient linking uses 2 | Planned |
| [4. Vaccines, inventory and billing](phase-04-vaccines-inventory-billing.md) | Vaccine/rabies certificates, stock lots, invoices, payment reconciliation | 2; sending uses 3 | Planned |
| [5. Clinical charting and integrations](phase-05-charting-integrations.md) | Dental, anesthesia, QOL, body maps, lab ingestion | 2, 4 | Planned |
| [6. Brand and launch](phase-06-brand-launch.md) | Logo, visuals, truthful public site, migration rehearsal and staff pilot | Brand can start in 1; launch needs relevant clinical gates | Planned |

Detailed [architecture](architecture.md), [dated release schedule](release-schedule.md), [external API scope](external-pims-integration.md), [research](research/provider-and-hub-notes.md), and [first implementation brief](first-sprint.md) accompany this plan.

## Release gates

1. **Public website:** verified contact information, services, staff and photography; real inquiry destination; approved logo and mobile accessibility.
2. **Late-October housecall pilot:** the housecall scope of phases 1–4 accepted using synthetic records, followed by a controlled staff pilot. External API access/mapping starts immediately. Dental/anesthesia or advanced QOL workflows become mandatory if those services are in the housecall offering; scheduling them later does not waive that gate.
3. **Complete requested scope:** phase 5 integrations/charting accepted plus full launch rehearsal. Manual anesthesia upload is an interim capability and does not satisfy automatic integration.

End-to-end proof: create household/pet → schedule visit → send reminder → record SOAP and reaction alert → administer vaccine from a lot → create charge and certificates → send selected records/invoice → receive client reply → reconcile payment → schedule next care reminder.

## Effort and resourcing

Treat this as a multi-month product build, not a website update. Provisional sizing: foundation 1–2 engineering weeks; clinical core 2–4; communications/scheduling 3–5; vaccines/inventory/billing 3–5; charting/integrations 4–8; brand/launch 2–4. Total 15–28 engineering weeks before unknown device/vendor integrations or large data cleanup. The roughly seven-week October window needs a narrow release, parallel implementation and frequent clinical review; full scope is not promised by October. These are planning estimates, not a commitment. Re-estimate after phase 1 and a clinical workflow review.

One technical owner should manage schema/deployments; one veterinarian should approve clinical behavior; a practice manager should own templates, products, scheduling and staff acceptance. Track hosting, backup, storage, email, SMS/number, payment, maps, design and integration costs separately; obtain current quotes once usage and vendors are selected.

## Decisions still open

- Which clinical services must run during October housecalls, and who can validate them weekly?
- Real phone, emergency referral contact and verified staff credentials remain open. Domain is `thelivingroom.vet`; GoDaddy manages DNS; hours are Monday–Saturday, 9 am–5 pm Mountain.
- Anesthesia device/recording software and authorized ezyVet source account remain open. Antech is selected; Living Room Vet is primary with reviewed ezyVet imports.
- Is a housecall offline mode essential? Initial scope assumes a connection, visible save status and an outage procedure; true offline synchronization is additional work.
- Develop the approved armchair/dog/cat direction with a medical-service cue; final artwork and owner acceptance remain pending.

This plan covers the complete requested scope. Foundation commissioning is recorded separately; later phases and logo production remain outstanding. It is not live-system certification. The Perplexity reference could not be accessed; the GitHub hub was reviewed directly.

## Commercial rollout tracking

The user requested stacked PRs followed by one coordinated rollout. Track every original requirement and actual acceptance evidence in [commercial-readiness.md](../../docs/commercial-readiness.md). No phase is complete merely because its first implementation increment merged.
