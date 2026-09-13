# Commercial-readiness evidence tracker

Goal: complete all requested practice software and website components, then perform one coordinated rollout. Stacked PRs are implementation increments; merging them is not evidence that a commercial launch is ready. The original scope is preserved below.

## User requirements

| Requirement | Current evidence | Still required for acceptance |
| --- | --- | --- |
| Client name/address/phone/email | PR2 household create/edit/search, separate mailing/housecall addresses, duplicate review tests | Owner review and hosted staff test |
| Pet name/age/species/breed/weight/birthday/color/microchip | PR2 patient workspace, exact/estimated/unknown dates, dated units, mobile persistence test | Hosted clinician review |
| Vaccine upcoming/last dates | Stock-backed and historical vaccine administration, frozen metadata and clinician-chosen due dates implemented | PR24 due plans and PR29 guarded outbox bridge implemented; obtain clinician acceptance and controlled provider proof |
| SOAP records | PR2 versioned save/sign/addenda and concurrency/immutability tests | Full clinical acceptance, hosted selected-record export acceptance and restore proof |
| Important historical diagnoses highlighted red | PR2 red/icon/text flags, PR31 critical-history export and PR40 shared booking/treatment refresh with exact server-validated alert review | Clinician acceptance and hosted booking/medication/vaccine workflow checks |
| Text/email with records and labs | Durable outbox plus verified inbound/status processing implemented; provider delivery remains disabled | PR35 frozen report/original-file email preparation and guarded outbox delivery implemented; controlled authorized provider round-trips remain |
| Standard and per-patient vaccine/lab reminders | PR19 lab interval templates and PR24 standard/patient vaccine due plans with immutable unsent jobs | PR29 disabled-by-default scheduler/outbox bridge and PR34 versioned administrator policy UI implemented; reviewed wording/policies, deployment configuration and controlled provider acceptance remain |
| Vaccine certificates with due dates | PR20 immutable vaccine history and Current certificate integration adds reviewed patient due-plan snapshots; print/correction tests pass | Veterinarian acceptance and hosted issuance |
| Rabies certificates with complete vaccine information | PR20 separate required-metadata template, verified issuer registry and immutable issuance | Verified practice issuer setup and Dr. Edler review |
| Invoices and payment by text/email | Invoice/item/credit ledgers and reviewed invoice email; PR52/54/57 add payment/refund ledger, verified event inbox and provider handlers; PR59 adds staff controls; PR60/61 add reviewed collection grants and isolated client pages | Actual capability endpoint/database roundtrip, reviewed payment-link delivery, audited reconciliation resolution, hosted acceptance and real Stripe payment/refund/webhook tests; Stripe connector needs reauthentication |
| Select all/some medical records/certificates for email | PR26/31 selected-record snapshots/history, PR35 exact frozen email report/originals and PR38 schema-4 imported-weight provenance; private originals remain protected | Dr. Edler/operator disclosure acceptance, hosted privacy checks and controlled recipient/provider delivery |
| Medication inventory, expiration/lot/billing | Product/lot/location stock ledger and atomic treatment-plus-charge workflow implemented | Hosted stock acceptance, invoice/payment reconciliation and real opening balances |
| Vaccine inventory and billing | Frozen vaccine lot/expiry metadata and atomic stock decrement/billing implemented | Certificate acceptance, inventory import/opening balances and hosted workflow |
| Clinic/housecall schedule + Maps | Day/week clinic/housecall schedule, Denver time, travel buffers and atomic overlap checks in PR5 | Maps usability and hosted acceptance |
| Automatic appointment reminders | Versioned appointment reminder jobs invalidate on reschedule/cancel | PR29 guarded scheduler/outbox implemented; approved appointment wording, explicit activation and controlled delivery proof remain |
| Dental charting in patient record | PR15 dog/cat dentition charts, signed history and shared draft navigation protection | PR26 selected signed-chart export implemented; Dr. Edler review and hosted acceptance remain |
| Automatic anesthesia records | PR21 native monitoring, manual/source-document transcription, immutable signatures/addenda and patient draft protection | Dr. Edler review; vendor selection and actual automatic-import adapter/sample/round-trip evidence |
| QOL charting | PR14 versioned qualitative observations, sign/addenda and reopen/conflict tests | PR26 selected history export implemented; Dr. Edler instrument/longitudinal presentation acceptance remains |
| Reopen/update mass body maps | PR14 stable lesions, keyboard schematic, dated observations and patient-photo validation | PR26 selected body-map history export implemented; clinician acceptance of schematic and measurements remains |
| Unified inbox without Gmail dependence | PR16–18 signed Resend/Twilio ingestion, sender review, durable outbox, consent UI, personal read state and paginated inbox implemented | PR26/31 releases and PR28 website-inquiry triage implemented; controlled inbound/provider callbacks and hosted acceptance remain |
| ezyVet API connection | PR11 reviewed household/patient promotion; PR36 reviewed historical weight create/link and discrepancy history; PR38 release provenance | Authorized ezyVet account and actual API/mapping acceptance; clinical resources beyond household/patient identity and reviewed historical weights need a separate implementation and acceptance |
| Logo/new visuals | PR12 approved armchair/dog/cat direction; PR33 medical-cross PNG with live descriptor integrated into public header/footer, responsive previews checked | Final owner acceptance and optimized/vector master; raster texture/fringe and print/monochrome reproduction review remain |
| Supabase/Vercel + owned domain | Dedicated Supabase provisioned; Vercel config; domain known | Frontend environment parity, staff/Auth SMTP, DNS/HTTPS, backups/restore, monitoring and cutover |

## Deployment inventory revalidated 2026-09-12

- PR1 and PR2 are merged. The original deployment audit baseline was `56f8315`; the current integrated release-provenance implementation baseline is `63414e8`. These are different checkpoints.
- The original backend is accessible through the Lovable connector, despite being inaccessible through the Supabase connector. Lovable project `7ea421c9-31d9-4bc4-acc7-d206c92b4b42` is associated with repository `livingroom-vet-care`, previews merged commit `56f8315`, and has a published `livingroom-vet-care.lovable.app` site.
- Original database has 14 migrations, 1 Auth user, 1 profile, 1 role, 8 app settings; every other public table has zero rows and Storage has zero objects. These are exact count queries, not estimated statistics. No row contents or credentials were exported. Recheck immediately before cutover because counts can change.
- Dedicated project `mgadheotkdnrsatfivjy` now has all 47 reviewed repository migrations through invoice email and 120 RLS-enabled public tables. Only the eight existing app settings rows are populated; Auth users and Storage objects remain zero. [The hosted commissioning report](hosted-schema-commissioning.md) records preflight, private exports and live checks. Outbound settings remain unchanged and disabled. [Reviewed Edge deployment and guarded hosted probes](hosted-edge-commissioning.md) are complete; actual staff and provider workflow acceptance remain pending.
- The current tracked frontend connection still points at the original backend. Its missing clinical migration means environment parity remains an actual rollout task. No original-backend writes or public/DNS cutover were performed during this audit.
- The Vite/SWC toolchain update resolves Vite/esbuild findings. The user authorized patched React Router v7 while preserving routes and navigation; PR7 implements v7.18.3. The combined installed dependency audit reported zero vulnerabilities on 2026-09-12.

## Completion gates

Completion requires a real authorized staff workflow on the chosen hosted backend: household/patient creation → housecall or clinic booking → reminder → SOAP and alerts → stock-backed vaccine/medication administration → invoice and certificates → exact selected-record delivery → inbound client reply → verified payment reconciliation → next due reminders. Dental, anesthesia, QOL and body-map histories must reopen intact, and actual ezyVet/lab/anesthesia integrations require their real sample/account evidence.

No test count, branch label, disabled endpoint, mock vendor adapter or populated checklist alone proves that gate. Staff/clinician acceptance, production settings, domain sender verification, SMS consent/opt-out, monitoring, backup restoration and content/brand review are separate evidence items. Preserve all patient records and existing staff/account settings during cutover; no unreviewed destructive reconciliation.

## External inputs still pending

Practice phone, emergency referral contact, staff identities/credentials, QOL/consent instrument approval, anesthesia vendor, ezyVet authorized import access, mail/Auth SMTP/SMS accounts and Stripe sandbox/production configuration. The three owner-approved sending DNS records are saved and authoritative values confirmed; Resend sending-domain verification is complete. The stated first-administrator address is `admin@thelivingroom.vet`, inferred from the owner's `admin@` response; no mailbox or Auth account has been created. Secrets must be entered in provider/project secret stores rather than chat or Git.

## Current stack strategy

Build and test focused dependent branches, with each subsequent PR based on its predecessor. Keep production sends disabled while integration fixtures and controlled tests are built. Do not merge/redeploy the full stack until environment parity and the relevant acceptance gates are verified. User authorized a single coordinated rollout, not silent repeated production cutovers.

## Confirmed clinical integration decisions

The user selected Antech (entered as “Antec”) as the lab provider and Dr. Susan Edler as the reviewer for clinical forms. Anesthesia recording vendor remains undecided. Clinical forms and certificate samples must be reviewed with Dr. Edler; provider selection alone does not supply API credentials, a supported integration contract or an acceptance result. The [Antech commissioning checklist](antech-commissioning.md) records the official public evidence, required approved contract/sample account, and patient/result/acknowledgment acceptance cases before an adapter.

Living Room Vet is the primary record system. ezyVet imports are staged and reviewed; matching must preserve local edits and must never delete local records absent from a later import. No outbound clinical synchronization into ezyVet is planned.

## Current implementation evidence (2026-09-12)

PRs 3–36 have green frontend/database CI at this checkpoint. PRs 37–44 have green frontend, database and frozen Edge checks, including PR41 at `5896463`; the aligned PR32 documentation tip `a75dce4` also passed all three checks. Subsequent increments require their own CI runs. [The clinician acceptance pack](clinical-review/README.md) remains a technical review artifact with every clinical decision pending. No CI result proves hosted deployment, provider activation or commercial acceptance.

| Increment | Implemented evidence | Remaining gate |
| --- | --- | --- |
| PR26 | Explicit selected clinical-record packages, retained preview/confirmation snapshots, private original references and offline rendering | Clinician/operator disclosure acceptance and controlled delivery |
| PR27 | Planned Monday–Saturday 9 am–5 pm hours and GoDaddy ownership disclosure; unpublished phone remains unset | Owner content acceptance and actual DNS/hosting cutover |
| PR28 | Staff website-inquiry triage and reviewed reply destinations | Hosted intake-to-inbox and authorized provider round-trip |
| PR29 | Disabled-by-default reminder scheduler, durable outbox origin and final source/consent checks on attempts and retries | Exact wording/policy approval, server activation and controlled delivery |
| PR30 | Verified, recoverable public contact submission hardening | Production verification configuration and hosted acceptance |
| PR31 | Schema-3 selected diagnosis revisions, highlighted critical history, allergy/legacy summary, dated weights and treatment corrections | Dr. Edler review of selected history and hosted evidence |
| PR32 | Editable clinical acceptance register, exact form checklist and synthetic production-rendered examples | Dr. Susan Edler and operational reviewers must record versioned decisions |
| PR33 | Reusable medical-logo candidate in public header/footer with accessible home links and mobile/desktop previews | Final owner approval and optimized/vector master |
| PR34 | Six administrator reminder-policy slots, versioned save/retry/reload, retired-wording disable control and shared draft guard | Exact wording/policy review and provider commissioning |
| PR35 | Exact frozen HTML report and original attachments, preparation/queue recovery and final guarded email delivery | Staff-authenticated hosted Edge gateway check, verified sender/inbound configuration, recipient acceptance and controlled delivery |
| PR36 | Reviewed historical ezyVet weight creation/linking, durable approval/recovery and retained discrepancy reviews | Authorized account/sample contract, live source mapping evidence and Dr. Edler review |
| PR37 | All 14 Edge entry points checked with frozen Deno dependencies; shared renderers remain deployable | Hosted gateway/runtime commissioning, not just module checks |
| PR38 | Schema-4 selected-weight source provenance, original versus reviewed values, source-review history and separate form-version acceptance; all three CI checks passed | Dr. Edler/operator v4 acceptance and hosted release/delivery checks |
| PR39 | Explicit deployment environment checks reject old-backend fallback, unsafe browser key types and production-backed previews; all three CI checks passed | Separately commissioned staging backend and actual hosted configuration/authentication acceptance |
| PR40 | Exact server-validated treatment alert review, shared diagnosis/profile refresh and immutable review evidence; all three CI checks passed including two-session lock regression | Dr. Edler workflow review and hosted stock/billing acceptance |
| PR41 | Personal unread home counts, explicit load failures and unavailable legacy-tool route gating; focused browser and all three CI checks passed | Hosted staff navigation acceptance |
| PR42 | Immutable issued-invoice email snapshots, exact attachment review, durable preparation/queue recovery and final source checks; local database, application and isolated Edge checks passed | Hosted staff preparation/recovery and controlled provider delivery |
| PR43 | Staff exact-attachment preview and attestation, preserved drafts and receipts across failed refresh/void/retry, and sign-out cleanup; 163 combined units and 14 focused browser cases passed | Hosted staff/provider acceptance |

PR numbering is not a linear dependency order. PR30 intake hardening is based on PR31 history; the later functional chain reaches PR37 through logo, policy controls, release delivery and reviewed weights. PR38 extends PR37, followed by the aligned PR32 clinical review pack, PR39 deployment checks, PR40 treatment review, PR41 staff navigation, PR42 invoice email backend and PR43 staff invoice email review.

At `63414e8`, the implementation owner reports 1,039 SQL assertions, 148 unit tests, ten targeted release browser tests and frozen checks for all 14 Edge entry points passing. These targeted browser results are not a claim of a fresh complete browser-suite run. Historical evidence remains available: PR26 had a local 66/67 browser run with one reminder timeout followed by two passing targeted reminder tests; that older result is not the latest integrated test count.

Synthetic message tests verify lost-response recovery, unchanged UUID retry, changed-payload rejection and disabled delivery preserving drafts. Provider secrets, controlled sends and production release have not been performed by these increments.

## Payment account decision

The owner selected a new Stripe account dedicated to Living Room Vet. Do not configure payments against an existing unrelated account. Stripe connector reauthentication and practice business onboarding are still required; no account has been created or payment processed in this workflow.

## Latest integration checkpoint

The implementation chain now includes record-release selection/export (PR26/31), website-inquiry triage (PR28), public intake hardening (PR30), guarded reminder queuing (PR29), public logo integration (PR33), administrator reminder-policy controls (PR34), frozen email attachments (PR35), reviewed weight promotion (PR36), Edge module verification (PR37) and weight-release provenance (PR38). They are implemented increments awaiting the specific hosted, provider and clinical acceptance gates above, not unimplemented placeholders. The clinical review pack provides editable acceptance rows and synthetic rendered examples without claiming approval. No provider activation or public rollout is implied by these checks.

General certificates now separately preserve reviewed due plans at issuance and per-administration recorded dates. Later plan revisions do not rewrite signed copies; updated client copies require new review/issuance. Standalone invoice print/download documents do not claim payment activity or immutable delivery snapshots. PR42 separately freezes the exact issued invoice, message and recipient for reviewed email delivery; it does not add payment collection or a balance-owed statement. These distinctions remain relevant when attaching documents to outbound messages.

## Confirmed public launch settings

The owner confirmed on September 12, 2026 that GoDaddy currently manages DNS for `thelivingroom.vet`. Planned hours are Monday through Saturday, 9 am to 5 pm in the practice’s America/Denver timezone. The practice phone number is not yet selected and remains unpublished; the emergency referral contact is still undecided. The website labels these as planned hours while services remain planned. These display hours do not silently create bookable staff availability or change the existing opening targets. No DNS or mail records were modified by that initial public-settings change; the later owner-approved sending DNS additions are recorded below.

## Read-only DNS observation — 2026-09-12

The root rollout audit observed nameservers `ns07.domaincontrol.com` and `ns08.domaincontrol.com`, A records `3.33.130.190` and `15.197.148.33`, and no MX answers for `thelivingroom.vet`. These are dated DNS observations, not proof of website or email commissioning. No DNS changes were made. Domain email and Auth SMTP remain configuration/verification tasks; recheck records immediately before an authorized cutover.

## Review and feature documents

- [Editable clinical review register](clinical-review/README.md), [exact form decisions](clinical-review/forms-and-decisions.md) and [offline synthetic examples](clinical-review/review-examples.html). All acceptance rows remain pending.
- [Reviewed invoice email backend](invoice-email-delivery.md) and [staff invoice email workflow](features/invoice-email.md).
- [Frozen release email](release-email-delivery.md), [reviewed historical weight import](ezyvet-reviewed-weights.md) and [schema-4 release provenance](release-weight-provenance.md).
- [Outbox](communications-outbox.md), [inbound processing](inbound-communications.md), [message recovery](message-recovery.md), [selected-record releases](record-releases.md) and [website inquiries](features/website-inquiries.md).
- [Care due plans](care-reminders.md), [scheduler and final delivery guards](reminder-dispatch.md), and [policy controls](features/reminder-delivery-settings.md). The controls select reviewed versions; they do not activate the deployment.
- [Logo candidate and responsive previews](brand/public-logo-integration.md).

## Email-domain DNS saved and verified

The Resend domain `thelivingroom.vet` was created in `us-east-1`; sending is requested On and receiving remains saved Off. Enforced TLS was saved. Tracking behavior remains a controlled-message verification gate; no tracking configuration was submitted.

With the owner's approval, the three sending-verification records were saved in GoDaddy: DKIM TXT at `resend._domainkey`, MX at `send` with priority 10 and destination `feedback-smtp.us-east-1.amazonses.com`, and SPF TXT at `send`. GoDaddy displays 10 records, preserving all seven earlier entries. Saved TTLs display one hour despite the earlier form's 30-minute default. Queries to authoritative nameserver `ns07.domaincontrol.com` confirmed all three values. Resend verification was requested; after reload the provider reports **Verified** and that the domain is ready to send emails. Enforced TLS was rechecked.

[Exact saved records and mail-routing gates](email-domain-setup.md) separate these additions from root MX cutover. No root MX change, webhook/API-key setup or provider send occurred. The owner supplied `admin@`, interpreted and stated as `admin@thelivingroom.vet` for the intended administrator; neither a mailbox nor an Auth account has been created. Public mailbox names remain unpublished until actual receiving and controlled-delivery evidence is complete.

## Invoice delivery checkpoint

At backend `0d2d12b` (PR42), all 33 SQL files / 1,132 assertions and 160 unit tests passed, along with lint, TypeScript, production build and frozen checks for all 15 Edge entry points. An additional functions-only check and bundle excludes root Node dependencies and now runs in CI. Three legacy test fixtures use explicit Denver clinical dates to remain valid around UTC midnight. The integrated UI at `63456ad` (PR43) passed 163 unit tests, lint, TypeScript, production build and 14 focused browser cases (11 invoice email and three existing billing/print cases). The final UI rebase at `48f2dd5` preserves those three UI commits unchanged. CI exposed one additional UTC date in the separate concurrency fixture; backend `69e3c20` corrects it, and both actual two-session lock cases passed under UTC. Final frontend, database and Edge CI passed for PR42 at `69e3c20`, PR43 at `48f2dd5` and PR44 at `191c0fa`, including the complete browser suite.

Apply the invoice migration before the updated dispatcher/preparer and coordinated frontend, following [the rollout ordering](invoice-email-delivery.md#frozen-transport-and-rollout). Older workers cannot send an invoice without its frozen attachment. Outbound delivery remains disabled; no invoice was sent and no Stripe account was configured.

## Hosted schema checkpoint

The dedicated Supabase database was commissioned from `191c0fa` using the authenticated CLI with an explicit project reference and vault updates disabled. All 31 pending migrations applied successfully, followed by a clean dry run and exact live catalog/count checks. See [the commissioning report](hosted-schema-commissioning.md). This removes the dedicated schema gap; it does not commission Edge handlers, staff/Auth, Storage user workflows, providers, hosting or clinical acceptance. Stripe reconnection remains pending. The subsequent owner-approved sending DNS save is recorded above; receiving and provider delivery remain uncommissioned.

## Hosted handler checkpoint

The dedicated project has 13 reviewed ACTIVE handlers, with the three worker authentication corrections from PR46 deployed and verified using managed server keys. The [hosted report](hosted-edge-commissioning.md) records 35 passing denial/configuration/guarded-worker probes, the initial defect and the unchanged exact data counts. This proves runtime and guarded service access, not real staff/provider acceptance. The intended administrator address is now recorded above; account/mailbox creation and Stripe reconnection remain pending. Sending DNS was subsequently saved with owner approval; Resend sending-domain verification is complete; receiving, Auth SMTP and application delivery remain uncommissioned.

## Payment and client-link checkpoint — 2026-09-12

PR57 provider/runtime and PR58 payment/SMS integration passed frontend, database and Edge CI. PR59 staff payment controls passed all three checks at `ae7177e`. PR60 adds reviewed collection grants and read-only status scopes; PR61 adds isolated client payment pages. Both remain draft increments with their own final CI/review required. They have not been deployed.

The collection database passed 51 grant assertions, 64 ledger assertions, 58 reconciliation assertions and 20 actual concurrent database checks. The rollout branch adds that concurrency runner to CI using the checked-out Supabase project ID; both default local targeting and explicit configuration targeting passed. This guards repeated activation and renewal plus invoice credit/payment races.

PR63 implements default-off public collection/status handlers and scoped capability materialization. The combined branch passes 263 unit tests, lint, TypeScript, production build and frozen checks for the public endpoints and staff Checkout. Eighteen capability/HTTP tests include malformed-action rejection before database work. PR65 adds a 30-check actual local HTTP/Auth/PostgREST roundtrip, including canonical capability recovery, role/cross-grant denial, committed payment/refund status, lost acknowledgement and revocation races. Stripe responses remain synthetic. PR66 adds actor-bound staff capability preparation/recovery with safe metadata and hash-only capture. SQL rejection remains authoritative even for sub-millisecond expiry changes; lost preparation acknowledgements retain the same request for explicit recovery. PR68 extends that evidence to 41 actual local checks through production staff handlers, including exact SQL expiry rejection. PR70 adds staff preparation, exact-context review, recovery, revocation and history, with dirty-draft guards and resolved-observation compatibility. Reviewed email/SMS payment-link delivery and real provider acceptance remain. Reconciliation observations currently stop conflicting financial actions; an audited resolution workflow must require fresh matching provider evidence before clearing those specific blockers. An uncertain creation or missing provider object is not proof that no payment occurred.

Stripe previously exposed a Living Room Vet sandbox through the connector, but the latest access failed with OAuth authorization required. Reconnection has been requested. No real payment/refund acceptance or provider sending occurred. Database tests and synthetic browser responses do not establish Stripe or communications readiness.

## Quoted payment-link privacy

PR64 extends post-verification inbound redaction to collection and status tokens and rejects canonical raw tokens at communication/payment history persistence boundaries. Seven inbound tests, 62 document-SMS SQL assertions and 53 collection SQL assertions passed. The combined privacy/HTTP branch passed 267 unit tests. These checks do not scrub arbitrary binary/encoded attachment contents or establish real provider delivery.

## Matching-object reconciliation and staff controls

PR69 implements administrator-reviewed database resolution for explicitly identified blockers and known matching provider objects. It preserves original evidence and requires fresh service proof; unknown objects, context mismatches and contradictory terminal status remain blocked. Forty-five focused SQL assertions and 32 actual contention checks passed, with both refund-settlement/review orderings and public inspection after resolution/recurrence. CI now runs the contention suite. A service proof adapter and administrator review UI are still required, along with separate handling for unsupported external adjustments and inbox retry cycles.

PR70 staff collection controls display resolved observation history without treating it as a current blocker. Undefined legacy or new unresolved observations still block financial work. The combined operations branch passed lint, TypeScript, 282 unit tests, production build and 25 payment/billing/invoice-email browser checks before its final UI expiry-precision correction. After that correction, all 283 unit tests and five staff-collection browser cases passed. No hosted commissioning or provider acceptance is implied.
