# Commercial-readiness evidence tracker

Goal: complete all requested practice software and website components, then perform one coordinated rollout. Stacked PRs are implementation increments; merging them is not evidence that a commercial launch is ready. The original scope is preserved below.

## User requirements

| Requirement | Current evidence | Still required for acceptance |
| --- | --- | --- |
| Client name/address/phone/email | PR2 household create/edit/search, separate mailing/housecall addresses, duplicate review tests | Multiple contacts, owner review, hosted staff test |
| Pet name/age/species/breed/weight/birthday/color/microchip | PR2 patient workspace, exact/estimated/unknown dates, dated units, mobile persistence test | Hosted clinician review, controlled merge/ownership workflow |
| Vaccine upcoming/last dates | Stock-backed and historical vaccine administration, frozen metadata and clinician-chosen due dates implemented | Complete longitudinal due engine, standard/per-patient reminders and clinician acceptance |
| SOAP records | PR2 versioned save/sign/addenda and concurrency/immutability tests | Full clinical acceptance, document exports and restore proof |
| Important historical diagnoses highlighted red | PR2 problem history and prominent red/icon/text flags | Propagation into booking/medication/vaccine/export workflows |
| Text/email with records and labs | Durable outbox plus verified inbound/status processing implemented; provider delivery remains disabled | Finish all inbox UI/consent cutover, real authorized attachments and controlled provider round-trips |
| Standard and per-patient vaccine/lab reminders | Legacy reminder tables only | Configurable due engine, invalidation, outbox and provider acceptance |
| Vaccine certificates with due dates | Not implemented | Frozen administration metadata, PDF samples and veterinarian acceptance |
| Rabies certificates with complete vaccine information | Not implemented | Separate template, required metadata, reviewed samples |
| Invoices and payment by text/email | Invoice, item and credit ledgers plus household billing UI implemented | Payment ledger/Stripe sandbox reconciliation and invoice delivery integration; Stripe connector needs reauthentication |
| Select all/some medical records/certificates for email | Private patient documents: 46 SQL checks and 3 browser scenarios | Exact authorized package snapshots, export, delivery and privacy tests |
| Medication inventory, expiration/lot/billing | Product/lot/location stock ledger and atomic treatment-plus-charge workflow implemented | Hosted stock acceptance, invoice/payment reconciliation and real opening balances |
| Vaccine inventory and billing | Frozen vaccine lot/expiry metadata and atomic stock decrement/billing implemented | Certificate acceptance, inventory import/opening balances and hosted workflow |
| Clinic/housecall schedule + Maps | Day/week clinic/housecall schedule, Denver time, travel buffers and atomic overlap checks in PR5 | Availability rules, maps usability and hosted acceptance |
| Automatic appointment reminders | Versioned appointment reminder jobs invalidate on reschedule/cancel | Actual reminder dispatcher/outbox and controlled delivery proof |
| Dental charting in patient record | PR15 dog/cat dentition charts, signed history and shared draft navigation protection | Dr. Edler review, print/export and hosted acceptance |
| Automatic anesthesia records | Not implemented | Charting/manual original file plus actual vendor adapter/sample/round-trip evidence |
| QOL charting | PR14 versioned qualitative observations, sign/addenda and reopen/conflict tests | Dr. Edler instrument acceptance, longitudinal presentation and print/export |
| Reopen/update mass body maps | PR14 stable lesions, keyboard schematic, dated observations and patient-photo validation | Clinician acceptance of schematic and measurements, print/export |
| Unified inbox without Gmail dependence | Durable outbox, signed Resend/Twilio ingestion, sender review and per-user cursor backend implemented | Inbound email/SMS, per-user read state, pagination, callbacks, idempotency, attachment release |
| ezyVet API connection | PR11 bounded staging and administrator-reviewed household/patient promotion with provenance | Authorized ezyVet account and actual API/mapping acceptance; clinical resources beyond household/patient identity need reviewed promotion |
| Logo/new visuals | PR12 approved armchair/dog/cat direction; medical-cross/descriptor refinement proposed | Consistent final master, small-size/readability checks, responsive brand integration and final owner acceptance |
| Supabase/Vercel + owned domain | Dedicated Supabase provisioned; Vercel config; domain known | Frontend environment parity, staff/Auth SMTP, DNS/HTTPS, backups/restore, monitoring and cutover |

## Deployment inventory revalidated 2026-09-12

- PR1 and PR2 are merged; baseline for current documents work is `56f8315`.
- The original backend is accessible through the Lovable connector, despite being inaccessible through the Supabase connector. Lovable project `7ea421c9-31d9-4bc4-acc7-d206c92b4b42` is associated with repository `livingroom-vet-care`, previews merged commit `56f8315`, and has a published `livingroom-vet-care.lovable.app` site.
- Original database has 14 migrations, 1 Auth user, 1 profile, 1 role, 8 app settings; every other public table has zero rows and Storage has zero objects. These are exact count queries, not estimated statistics. No row contents or credentials were exported. Recheck immediately before cutover because counts can change.
- Dedicated project `mgadheotkdnrsatfivjy` has the reviewed foundation/clinical migrations. It is still empty and outbound is disabled. Subsequent migration counts and commissioning checks are recorded per increment.
- The current tracked frontend connection still points at the original backend. Its missing clinical migration means environment parity remains an actual rollout task. No original-backend writes or public/DNS cutover were performed during this audit.
- The Vite/SWC toolchain update resolves Vite/esbuild findings. The user authorized patched React Router v7 while preserving routes and navigation; PR7 implements v7.18.3. The combined installed dependency audit reported zero vulnerabilities on 2026-09-12.

## Completion gates

Completion requires a real authorized staff workflow on the chosen hosted backend: household/patient creation → housecall or clinic booking → reminder → SOAP and alerts → stock-backed vaccine/medication administration → invoice and certificates → exact selected-record delivery → inbound client reply → verified payment reconciliation → next due reminders. Dental, anesthesia, QOL and body-map histories must reopen intact, and actual ezyVet/lab/anesthesia integrations require their real sample/account evidence.

No test count, branch label, disabled endpoint, mock vendor adapter or populated checklist alone proves that gate. Staff/clinician acceptance, production settings, domain sender verification, SMS consent/opt-out, monitoring, backup restoration and content/brand review are separate evidence items. Preserve all patient records and existing staff/account settings during cutover; no unreviewed destructive reconciliation.

## External inputs still pending

Practice phone, emergency referral contact, opening hours, staff identities/credentials, QOL/consent instrument approval, anesthesia vendor, ezyVet authorized import access, domain provider access, mail/Auth SMTP/SMS accounts and Stripe sandbox/production configuration. Secrets must be entered in provider/project secret stores rather than chat or Git.

## Current stack strategy

Build and test focused dependent branches, with each subsequent PR based on its predecessor. Keep production sends disabled while integration fixtures and controlled tests are built. Do not merge/redeploy the full stack until environment parity and the relevant acceptance gates are verified. User authorized a single coordinated rollout, not silent repeated production cutovers.

## Confirmed clinical integration decisions

The user selected Antech (entered as “Antec”) as the lab provider and Dr. Susan Edler as the reviewer for clinical forms. Anesthesia recording vendor remains undecided. Clinical forms and certificate samples must be reviewed with Dr. Edler; provider selection alone does not supply API credentials, a supported integration contract or an acceptance result.

Living Room Vet is the primary record system. ezyVet imports are staged and reviewed; matching must preserve local edits and must never delete local records absent from a later import. No outbound clinical synchronization into ezyVet is planned.

## Current implementation evidence (2026-09-12)

PRs 3–15 remain draft increments except previously merged foundations. PR12 is a parallel brand review artifact; the functional dependency chain proceeds through PR13 outbox, PR14 care charts and PR15 dental/navigation protection. Inbound and message-queue UI integration are being stacked next. Counts above describe implemented and locally verified features, not cloud deployments or commercial acceptance.

Latest synthetic message browser tests verify lost queue response recovery, unchanged UUID retry, changed-payload rejection and disabled delivery preserving drafts. Legacy direct-send endpoints are retired in the UI integration branch. Provider secrets, controlled sends and production release have not been performed.
