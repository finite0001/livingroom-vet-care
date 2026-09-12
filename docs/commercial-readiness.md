# Commercial-readiness evidence tracker

Goal: complete all requested practice software and website components, then perform one coordinated rollout. Stacked PRs are implementation increments; merging them is not evidence that a commercial launch is ready. The original scope is preserved below.

## User requirements

| Requirement | Current evidence | Still required for acceptance |
| --- | --- | --- |
| Client name/address/phone/email | PR2 household create/edit/search, separate mailing/housecall addresses, duplicate review tests | Owner review and hosted staff test |
| Pet name/age/species/breed/weight/birthday/color/microchip | PR2 patient workspace, exact/estimated/unknown dates, dated units, mobile persistence test | Hosted clinician review |
| Vaccine upcoming/last dates | Stock-backed and historical vaccine administration, frozen metadata and clinician-chosen due dates implemented | PR24 due plans and PR29 guarded outbox bridge implemented; obtain clinician acceptance and controlled provider proof |
| SOAP records | PR2 versioned save/sign/addenda and concurrency/immutability tests | Full clinical acceptance, hosted selected-record export acceptance and restore proof |
| Important historical diagnoses highlighted red | PR2 problem history and red/icon/text flags; PR31 selected diagnosis revisions and critical-history export | Review propagation into booking/medication/vaccine workflows and accept exported history |
| Text/email with records and labs | Durable outbox plus verified inbound/status processing implemented; provider delivery remains disabled | PR26/31 selected packages implemented; controlled authorized attachment/provider round-trips remain; PR22 reload recovery implemented |
| Standard and per-patient vaccine/lab reminders | PR19 lab interval templates and PR24 standard/patient vaccine due plans with immutable unsent jobs | PR29 disabled-by-default scheduler/outbox bridge implemented; reviewed policies, deployment configuration and controlled provider acceptance remain |
| Vaccine certificates with due dates | PR20 immutable vaccine history and Current certificate integration adds reviewed patient due-plan snapshots; print/correction tests pass | Veterinarian acceptance and hosted issuance |
| Rabies certificates with complete vaccine information | PR20 separate required-metadata template, verified issuer registry and immutable issuance | Verified practice issuer setup and Dr. Edler review |
| Invoices and payment by text/email | Invoice/item/credit ledgers, household billing UI and PR23 print/download documents implemented | Payment ledger/Stripe sandbox reconciliation and invoice delivery integration; Stripe connector needs reauthentication |
| Select all/some medical records/certificates for email | PR26 exact selected-record snapshots and offline export; PR31 diagnosis/allergy/weight/treatment histories; private originals remain protected | Dr. Edler/operator disclosure acceptance, hosted privacy checks and controlled recipient/provider delivery |
| Medication inventory, expiration/lot/billing | Product/lot/location stock ledger and atomic treatment-plus-charge workflow implemented | Hosted stock acceptance, invoice/payment reconciliation and real opening balances |
| Vaccine inventory and billing | Frozen vaccine lot/expiry metadata and atomic stock decrement/billing implemented | Certificate acceptance, inventory import/opening balances and hosted workflow |
| Clinic/housecall schedule + Maps | Day/week clinic/housecall schedule, Denver time, travel buffers and atomic overlap checks in PR5 | Maps usability and hosted acceptance |
| Automatic appointment reminders | Versioned appointment reminder jobs invalidate on reschedule/cancel | PR29 guarded scheduler/outbox implemented; approved appointment wording, explicit activation and controlled delivery proof remain |
| Dental charting in patient record | PR15 dog/cat dentition charts, signed history and shared draft navigation protection | PR26 selected signed-chart export implemented; Dr. Edler review and hosted acceptance remain |
| Automatic anesthesia records | PR21 native monitoring, manual/source-document transcription, immutable signatures/addenda and patient draft protection | Dr. Edler review; vendor selection and actual automatic-import adapter/sample/round-trip evidence |
| QOL charting | PR14 versioned qualitative observations, sign/addenda and reopen/conflict tests | PR26 selected history export implemented; Dr. Edler instrument/longitudinal presentation acceptance remains |
| Reopen/update mass body maps | PR14 stable lesions, keyboard schematic, dated observations and patient-photo validation | PR26 selected body-map history export implemented; clinician acceptance of schematic and measurements remains |
| Unified inbox without Gmail dependence | PR16–18 signed Resend/Twilio ingestion, sender review, durable outbox, consent UI, personal read state and paginated inbox implemented | PR26/31 releases and PR28 website-inquiry triage implemented; controlled inbound/provider callbacks and hosted acceptance remain |
| ezyVet API connection | PR11 bounded staging and administrator-reviewed household/patient promotion with provenance | Authorized ezyVet account and actual API/mapping acceptance; clinical resources beyond household/patient identity need reviewed promotion |
| Logo/new visuals | PR12 approved armchair/dog/cat direction; medical-cross/descriptor refinement proposed | Consistent final master, small-size/readability checks, responsive brand integration and final owner acceptance |
| Supabase/Vercel + owned domain | Dedicated Supabase provisioned; Vercel config; domain known | Frontend environment parity, staff/Auth SMTP, DNS/HTTPS, backups/restore, monitoring and cutover |

## Deployment inventory revalidated 2026-09-12

- PR1 and PR2 are merged. The original deployment audit baseline was `56f8315`; the current historical-release implementation baseline is `3c0c314`. These are different checkpoints.
- The original backend is accessible through the Lovable connector, despite being inaccessible through the Supabase connector. Lovable project `7ea421c9-31d9-4bc4-acc7-d206c92b4b42` is associated with repository `livingroom-vet-care`, previews merged commit `56f8315`, and has a published `livingroom-vet-care.lovable.app` site.
- Original database has 14 migrations, 1 Auth user, 1 profile, 1 role, 8 app settings; every other public table has zero rows and Storage has zero objects. These are exact count queries, not estimated statistics. No row contents or credentials were exported. Recheck immediately before cutover because counts can change.
- Dedicated project `mgadheotkdnrsatfivjy` has the reviewed foundation/clinical migrations. It is still empty and outbound is disabled. Subsequent migration counts and commissioning checks are recorded per increment.
- The current tracked frontend connection still points at the original backend. Its missing clinical migration means environment parity remains an actual rollout task. No original-backend writes or public/DNS cutover were performed during this audit.
- The Vite/SWC toolchain update resolves Vite/esbuild findings. The user authorized patched React Router v7 while preserving routes and navigation; PR7 implements v7.18.3. The combined installed dependency audit reported zero vulnerabilities on 2026-09-12.

## Completion gates

Completion requires a real authorized staff workflow on the chosen hosted backend: household/patient creation → housecall or clinic booking → reminder → SOAP and alerts → stock-backed vaccine/medication administration → invoice and certificates → exact selected-record delivery → inbound client reply → verified payment reconciliation → next due reminders. Dental, anesthesia, QOL and body-map histories must reopen intact, and actual ezyVet/lab/anesthesia integrations require their real sample/account evidence.

No test count, branch label, disabled endpoint, mock vendor adapter or populated checklist alone proves that gate. Staff/clinician acceptance, production settings, domain sender verification, SMS consent/opt-out, monitoring, backup restoration and content/brand review are separate evidence items. Preserve all patient records and existing staff/account settings during cutover; no unreviewed destructive reconciliation.

## External inputs still pending

Practice phone, emergency referral contact, staff identities/credentials, QOL/consent instrument approval, anesthesia vendor, ezyVet authorized import access, GoDaddy DNS access, mail/Auth SMTP/SMS accounts and Stripe sandbox/production configuration. Secrets must be entered in provider/project secret stores rather than chat or Git.

## Current stack strategy

Build and test focused dependent branches, with each subsequent PR based on its predecessor. Keep production sends disabled while integration fixtures and controlled tests are built. Do not merge/redeploy the full stack until environment parity and the relevant acceptance gates are verified. User authorized a single coordinated rollout, not silent repeated production cutovers.

## Confirmed clinical integration decisions

The user selected Antech (entered as “Antec”) as the lab provider and Dr. Susan Edler as the reviewer for clinical forms. Anesthesia recording vendor remains undecided. Clinical forms and certificate samples must be reviewed with Dr. Edler; provider selection alone does not supply API credentials, a supported integration contract or an acceptance result.

Living Room Vet is the primary record system. ezyVet imports are staged and reviewed; matching must preserve local edits and must never delete local records absent from a later import. No outbound clinical synchronization into ezyVet is planned.

## Current implementation evidence (2026-09-12)

PRs 3–25 have green CI at this checkpoint. PRs 26–31 are implemented draft increments with current CI runs pending; do not describe them as a fully green combined stack. PR12 remains a parallel brand artifact. PR32 is the draft clinician acceptance pack, with all review decisions pending.

| Increment | Implemented evidence | Remaining gate |
| --- | --- | --- |
| PR26 | Explicit selected clinical-record packages, retained preview/confirmation snapshots, private original references and offline rendering | Clinician/operator disclosure acceptance and controlled delivery |
| PR27 | Planned Monday–Saturday 9 am–5 pm hours and GoDaddy ownership disclosure; unpublished phone remains unset | Owner content acceptance and actual DNS/hosting cutover |
| PR28 | Staff website-inquiry triage and reviewed reply destinations | Hosted intake-to-inbox and authorized provider round-trip |
| PR29 | Disabled-by-default reminder scheduler, durable outbox origin and final source/consent checks on attempts and retries | Exact wording/policy approval, server activation and controlled delivery |
| PR30 | Verified, recoverable public contact submission hardening | Production verification configuration and hosted acceptance |
| PR31 | Schema-3 selected diagnosis revisions, highlighted critical history, allergy/legacy summary, dated weights and treatment corrections | Dr. Edler review of selected history and hosted evidence |

PR31 is based on the reminder branch; PR30 intake hardening is now based on PR31 history. PR numbering is not a linear dependency order. Latest history checks at `3c0c314`: typecheck and eight targeted record-release browser tests pass. PR26's latest local combined browser run was **66 passed of 67**, with one care-reminder timeout; a targeted rerun of the two reminder tests passed. This is not a claim that a subsequent complete 67-test run was green. PR29 separately passed its three mounted care/reminder browser tests and 124 project tests on its then-current base.

Synthetic message tests verify lost-response recovery, unchanged UUID retry, changed-payload rejection and disabled delivery preserving drafts. Provider secrets, controlled sends and production release have not been performed by these increments.

## Payment account decision

The owner selected a new Stripe account dedicated to Living Room Vet. Do not configure payments against an existing unrelated account. Stripe connector reauthentication and practice business onboarding are still required; no account has been created or payment processed in this workflow.

## Latest integration checkpoint

The implementation chain now includes record-release selection/export (PR26/31), website-inquiry triage (PR28), public intake hardening (PR30) and guarded reminder queuing (PR29). They are implemented increments awaiting the specific hosted, provider and clinical acceptance gates above, not unimplemented placeholders. The clinical review pack provides editable acceptance rows and synthetic rendered examples without claiming approval. No provider activation or public rollout is implied by these checks.

General certificates now separately preserve reviewed due plans at issuance and per-administration recorded dates. Later plan revisions do not rewrite signed copies; updated client copies require new review/issuance. Standalone invoice documents similarly do not claim payment activity or immutable delivery snapshots. These distinctions remain relevant when attaching documents to outbound messages.

## Confirmed public launch settings

The owner confirmed on September 12, 2026 that GoDaddy currently manages DNS for `thelivingroom.vet`. Planned hours are Monday through Saturday, 9 am to 5 pm in the practice’s America/Denver timezone. The practice phone number is not yet selected and remains unpublished; the emergency referral contact is still undecided. The website labels these as planned hours while services remain planned. These display hours do not silently create bookable staff availability or change the existing opening targets. No DNS or mail records were modified.

## Read-only DNS observation — 2026-09-12

The root rollout audit observed nameservers `ns07.domaincontrol.com` and `ns08.domaincontrol.com`, A records `3.33.130.190` and `15.197.148.33`, and no MX answers for `thelivingroom.vet`. These are dated DNS observations, not proof of website or email commissioning. No DNS changes were made. Domain email and Auth SMTP remain configuration/verification tasks; recheck records immediately before an authorized cutover.
