# Commercial-readiness evidence tracker

The API-attachment work is tracked in [draft PR126](https://github.com/finite0001/livingroom-vet-care/pull/126) and [phase3d](../plans/20260913-ezyvet-clinical-import/phase-03d-api-attachments.md). Parent-scoped intake, immutable capture and authenticated default-off capture/cleanup workers are implemented locally. The import page includes patient-scoped scan and file history with source-change notices and pagination, plus explicit saved-scan recovery and one-page continuation controls. Recovery runs before and after each page attempt; uncertain outcomes guard patient switching and navigation. Allowlisted error messages distinguish source-context changes, setup, authorization and cooldowns, and stale contexts cannot immediately request another page. Migration7000 adds bounded owned observation and cleanup-history discovery. Migration7100 adds durable authenticated preparation for new Animal/Consult scans before provider traffic. The operator UI now selects patient or current consultation context, persists preparation identity, recovers lost responses after reload and opens the saved scan for explicit page reading. Migration7200 corrects an observed administrator-revocation race after download request/source lock waits. The chart checkpoint's97-migration rehearsal passes261 HTTP/Auth/Storage checks and108 contention checks, including six new preparation/abandonment role-loss cases; four focused SQL suites pass150 assertions. New preparation passes19 focused SQL assertions; the prior discovery checkpoint passed694 SQL assertions and236 compatibility checks. Observed files now support explicit private-copy preparation, capture and exact-request recovery, with captured status gated by a saved matching receipt. Server file-request history now supports verified recovery after local-reference loss and reopens the original source page. The cleanup worker now reports unreserved abandoned requests as ineligible without a false retry or absence receipt. Confirmed abandonment and recovery now cover prepared and source-less requests, while protecting captured evidence. Cleanup history now distinguishes active attempts, attempts without receipts and point-in-time absence receipts, with strict identity checks and pagination. Reserved abandoned files now have explicit cleanup confirmation, exact-attempt recovery/retry, history-based pointer repair and a separate new-sweep action after resolution. Uncertain cleanup attempts preserve existing navigation guards. Captured originals now support private byte verification and download for inspection, with fresh owned recovery before and after Storage access. Inspection does not mark clinical approval. Migration7300 adds immutable API attachment approval/correction records with exact capture/source binding and predecessor checks. Seven observed approval race scenarios now cover administrator loss at four lock boundaries, competing corrections and both source-change orderings; the full attachment harness passes91 checks. Captured file cards now show paginated, validated approval history with an explicit latest-version reference and preserved API provenance. Migration7500 adds serialized cancellation and recovery for unconfirmed approval IDs, preserving committed approvals and blocking late approval after cancellation. The staff decision form now requires verified-original inspection and explicit attestation, preserves submitted decision identity, supports correction, cancellation and saved-history recovery, and retains draft/navigation guards. Migration7600 adds active-staff patient-chart discovery of reviewed API records and exact private original access. The chart distinguishes latest approvals from current source observations, preserves superseded versions and verifies original bytes before offering download. Unreviewed captures remain owner scoped; revoked staff are denied chart and Storage reads. Evidence is recorded in [chart verification](evidence/attachment-patient-chart-local-20260913.json). Migration7700 adds private validation of exact selected API approvals/captures for the [schema9 release plan](../plans/20260913-api-attachment-releases/plan.md);the fresh98-migration run passed295 local HTTP/Auth/Storage checks, including34 new selection-validation checks, and108 existing contention checks with cleanup verified. Migration7800 now adds schema9 API-original preview/confirmation/recovery, source registration/invalidation and server byte binding. Shared print HTML/email/link artifact builders validate separate API provenance. The99-migration run passed319 HTTP/Auth/Storage checks and108 existing contention checks;628 units,40 targeted browser cases and frozen Edge checks passed. Migration7900 and the existing release UI now provide schema9 current/latest API-source discovery, explicit selection, policy9 gating, exact retry and verified original inspection. The100-migration run passed327 HTTP/Auth/Storage checks and108 existing contention checks;628 units and44 targeted browser cases passed. Fourteen observed API/native release races now pass, expanding contention checks to202. They reproduced two post-wait access gaps in exact confirmation replay and package reads; migration8000 adds current-staff rechecks while preserving saved receipts. Full handler/batch acceptance, delivery-worker races and current101-migration populated upgrade/restore remain unfinished. Current populated upgrade/restore, broader contention and issued-site/operator acceptance are still required. No hosted attachment migration or activation is claimed. Mail/Auth, Stripe sandbox acceptance, vendors, clinical approval and public cutover remain part of the full commercial-readiness goal.

## September 13 — private mailbox verified; application mail capacity pending

The owner-created Fastmail trial now has the designated administrator mailbox. GoDaddy saved six root-mail DNS records; Fastmail verifies MX, DKIM and SPF and reports the domain ready to send and receive mail. [Mail commissioning evidence](mail-commissioning-plan.md) also records the staging APP_URL, Auth Site URL and exact password-reset redirect configuration. Actual message delivery, Auth SMTP, staff onboarding and clinical/provider acceptance remain unverified. Earlier mailbox-creation statements below are historical.

The accessible Resend team is `finite01` (Pro), with 10 of 10 domain slots occupied, including the verified practice root. The provider blocks adding the planned `auth` and `reply` subdomains. Its Usage page offers 100 additional domains for $20/month; the add-on is off. No additional subscription was purchased and no existing domain was removed. Additional capacity or an explicitly selected alternative is needed before those sender domains can be commissioned.

## September 13 — reviewed vaccination software deployed to staging

PR112 passed combined CI at73abb6a and is merged into the release integration branch. [Staging deployment evidence](reviewed-vaccination-staging.md) records75 migrations, seven matching version3 export functions, selected hosted authorization checks and the refreshed protected frontend. No clinical approval, staff login, provider send or public cutover is claimed. The administrator mailbox still needs creation; Fastmail signup is with the owner for private password entry and terms acceptance.

## September 13 — shared-team Auth callback separation implemented

[Reserved-sender callback separation](auth-mail-webhook-separation.md) keeps signed Auth delivery statuses out of the client ledger while preserving unknown-client retries. All28 inbound tests and all three PR114 CI jobs pass. Staging webhook version3 matches the tested source; no Resend secrets are installed and the unconfigured endpoint returns503. No mailbox creation, Auth SMTP configuration or sending is claimed. The owner has supplied the first administrator's mailbox; authoritative root DNS still has no MX record, so actual private-mail delivery remains unverified.

## September 13 — protected frontend preview available

The current application now has a [protected Vercel preview](protected-frontend-preview.md) against the separately commissioned staging database. Its guarded hosted build passes; HTTP checks and the served bundle verify payment routes, staging backend selection and private-route headers. Staff/rendered/provider acceptance remains open. The public Lovable site and `thelivingroom.vet` were not cut over.

## September 13 — payment runtime and security continuation

The owner-selected payment backend remains `mgadheotkdnrsatfivjy`. Its runtime Stripe key has been verified against account `acct_1UF1ewGUaxUNX5Ol` with test mode confirmed. Sandbox webhook `we_1UFEiWGUaxUNX5OlbNtD6lHW` is registered with its signing secret saved; delivery and payment gates remain disabled. Earlier reconnection requests in this historical tracker are superseded by that verified runtime setup.

The owner confirmed `thelivingroom.vet` as the intended domain and supplied `livingroom-vet-care.lovable.app` as the published application. HTTP inspection found the former serving a `/lander` redirect and the latter's published entry bundle still targeting the old `ugpyjacqganaqtsiekay` backend without the new payment routes. Publishing the matching application and verifying return/status pages remain dependencies; no public cutover has occurred in this continuation.

[Payment trigger hardening](payment-trigger-hardening.md) records the independently verified search-path correction deployed to the owner-selected payment backend. It preserves all clinical, provider and full-launch acceptance gates below.

Goal: complete all requested practice software and website components, then perform one coordinated rollout. Stacked PRs are implementation increments; merging them is not evidence that a commercial launch is ready. The original scope is preserved below.

## Current release checkpoint

- PR106 (`e80cf62`) has all three GitHub CI jobs green (run34746522048), including the complete browser suite. Patient-scoped consult/history ingestion remains staging for explicit review; authorized ezyVet account/API access is confirmed by the owner; secure configuration and source validation remain pending.
- PR104 (`c85b5f0`) has all three GitHub CI jobs green (run34745342987), as do its PR103/102 bases. Schema5 release-source implementation passed382 unit tests,41 focused browser cases, frozen Edge checks and24 disposable source-capture checks; the CI frontend job also passed the complete browser suite. See [integrated evidence](release-source-byte-binding.md).
- Last read-only hosted verification: dedicated project `mgadheotkdnrsatfivjy` has51 migration receipts through3400 with older gaps. Its259 application routines and168 trigger bindings match the observed subset except the six direct grants documented in [hosted preflight](hosted-upgrade-preflight.md). The4600 correction is implemented and locally tested, but remains unapplied there.
- The observed51-version history plus grant differences was reproduced locally and upgraded through71 migrations. Canonical permissions, captured records, private Storage/database restore and cleanup passed. This does not establish hosted recovery coverage or authorize a hosted backfill.
- No public cutover, provider commissioning, clinical approval or full hosted staff acceptance is claimed. Main remains outside this stacked-PR rollout; revalidate its actual state before merging.
- Original Lovable and dedicated future-production environments must remain distinct. Staging has all 71 migrations and 28 reviewed Edge functions deployed; frontend and mail/Auth commissioning, Stripe reauthentication, provider contracts and owner/clinical acceptance remain open as detailed below.

The tables below preserve the complete requested scope. Dated narrative checkpoints later in this document are historical evidence, not instructions to deploy those old revisions or claims that their counts describe today's hosted database.

## Next implementation

The [clinical ezyVet migration plan](../plans/20260913-ezyvet-clinical-import/plan.md) preserves the remaining API-backed history, diagnoses/reactions, vaccinations, prescriptions, attachments and reconciliation scope. Phase1 is implemented in PR106 at `e80cf62`: patient-scoped consult/history ingestion, exact page recovery, observation freshness and administrator review UI. Local evidence includes384 unit tests,13 browser cases,59 focused SQL assertions,41 contention checks,30 actual synthetic HTTP/Auth/PostgREST checks and a69-migration upgrade/restore rehearsal. PR105 planning and PR106 implementation CI are green. Phase2 is implemented and locally verified at `ddf3d80` on `codex/ezyvet-reviewed-history`: administrator-approved source history, explicit DVM create/link decisions, source-discrepancy review and schema6 release disclosure. Its integrated checks passed 399 unit tests, 36 browser tests, 37 actual workflow checks and a 71-migration upgrade/restore; PR107 at `f1c7764` passed all three CI jobs (run34748271853). Database evidence includes 65 focused SQL assertions, 522 regressions and 63 contention checks. See [integrated evidence](release-imported-history-artifacts.md). Vaccination, prescription, attachment and full reconciliation work remains next. The pending [C11 clinical checklist](clinical-review/imported-history-and-problems.md) includes examples with and without full source narratives. Provider access and clinical acceptance remain open.

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
| Invoices and payment by text/email | Invoice/item/credit ledgers and reviewed invoice email; PR52/54/57 add payment/refund ledger, verified event inbox and provider handlers; PR59 adds staff controls; PR60/61 add reviewed collection grants and isolated client pages | PR65/68 actual capability/staff roundtrips; PR72–78 reviewed delivery database/transport/preparation and administrator reconciliation implemented. Staff payment-message composer now integrated; hosted acceptance and real Stripe payment/refund/webhook tests remain; Stripe connector needs reauthentication |
| Select all/some medical records/certificates for email | PR26/31 selected-record snapshots/history, PR35 exact frozen email report/originals and PR38 schema-4 imported-weight provenance; private originals remain protected | Dr. Edler/operator disclosure acceptance, hosted privacy checks and controlled recipient/provider delivery |
| Medication inventory, expiration/lot/billing | Product/lot/location stock ledger and atomic treatment-plus-charge workflow implemented | Hosted stock acceptance, invoice/payment reconciliation and real opening balances |
| Vaccine inventory and billing | Frozen vaccine lot/expiry metadata and atomic stock decrement/billing implemented | Certificate acceptance, inventory import/opening balances and hosted workflow |
| Clinic/housecall schedule + Maps | Day/week clinic/housecall schedule, Denver time, travel buffers and atomic overlap checks in PR5 | Maps usability and hosted acceptance |
| Automatic appointment reminders | Versioned appointment reminder jobs invalidate on reschedule/cancel | PR29 guarded scheduler/outbox implemented; approved appointment wording, explicit activation and controlled delivery proof remain |
| Dental charting in patient record | PR15 dog/cat dentition charts, signed history and shared draft navigation protection | PR26 selected signed-chart export implemented; Dr. Edler review and hosted acceptance remain |
| Automatic anesthesia records | PR21 native monitoring, manual/source-document transcription, immutable signatures/addenda and patient draft protection | Dr. Edler review; vendor selection and actual automatic-import adapter/sample/round-trip evidence |
| QOL charting | PR14 versioned qualitative observations, sign/addenda and reopen/conflict tests | PR26 selected history export implemented; Dr. Edler instrument/longitudinal presentation acceptance remains |
| Reopen/update mass body maps | PR14 stable lesions, keyboard schematic, dated observations and patient-photo validation | PR26 selected body-map history export implemented; clinician acceptance of schematic and measurements remains |
| Unified inbox without Gmail dependence | Signed Resend/Twilio ingestion, reviewed sender-assignment UI/RPC, provider-processing review and audited retry UI, durable outbox, consent UI, personal read state and paginated inbox implemented | Controlled inbound/provider callbacks and hosted acceptance remain |
| ezyVet API connection | PR11 reviewed household/patient promotion; PR36 reviewed historical weight create/link and discrepancy history; PR38 release provenance | Authorized ezyVet account and actual API/mapping acceptance; clinical resources beyond household/patient identity and reviewed historical weights need a separate implementation and acceptance |
| Logo/new visuals | PR12 approved armchair/dog/cat direction; PR33 medical-cross PNG with live descriptor integrated into public header/footer, responsive previews checked | Final owner acceptance and optimized/vector master; raster texture/fringe and print/monochrome reproduction review remain |
| Supabase/Vercel + owned domain | Dedicated Supabase provisioned; Vercel config; domain known | Frontend environment parity, staff/Auth SMTP, DNS/HTTPS, backups/restore, monitoring and cutover |

## Historical deployment inventory — 2026-09-12

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

Practice phone, emergency referral contact, staff identities/credentials, QOL/consent instrument approval, anesthesia vendor, ezyVet clinical-resource samples and migration acceptance, mail/Auth SMTP/SMS accounts and Stripe sandbox/production configuration. The three owner-approved sending DNS records are saved and authoritative values confirmed; Resend sending-domain verification is complete. The owner has now explicitly supplied a named first-administrator mailbox privately, superseding the earlier inferred `admin@` address; no mailbox or Auth account has been created. Secrets must be entered in provider/project secret stores rather than chat or Git.

## Current stack strategy

Build and test focused dependent branches, with each subsequent PR based on its predecessor. Keep production sends disabled while integration fixtures and controlled tests are built. Do not merge/redeploy the full stack until environment parity and the relevant acceptance gates are verified. User authorized a single coordinated rollout, not silent repeated production cutovers.

## Confirmed clinical integration decisions

The user selected Antech (entered as “Antec”) as the lab provider and Dr. Susan Edler as the reviewer for clinical forms. Anesthesia recording vendor remains undecided. Clinical forms and certificate samples must be reviewed with Dr. Edler; provider selection alone does not supply API credentials, a supported integration contract or an acceptance result. The [Antech commissioning checklist](antech-commissioning.md) records the official public evidence, required approved contract/sample account, and patient/result/acknowledgment acceptance cases before an adapter.

Living Room Vet is the primary record system. ezyVet imports are staged and reviewed; matching must preserve local edits and must never delete local records absent from a later import. No outbound clinical synchronization into ezyVet is planned.

## Historical implementation evidence — 2026-09-12

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

## Historical integration checkpoint through PR43

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

## Reviewed payment delivery and reconciliation integration

PR72–73 implement immutable email/SMS delivery requests, optional original invoice attachments and hash-verified transport. PR74–76 add administrator-only known-object discovery, fresh proof retrieval, exact-proof completion and receipt recovery. PR77 adds staff preparation/recovery/transient review; PR78 tests that flow through actual Auth/PostgREST, queue and worker lease/start/finish operations. Delivery history3900 returns original-actor requests and receipts for an invoice without requiring the grant to remain collectible.

The44-check delivery roundtrip validates exact provider body hashes, original invoice renderer attachment bytes, SMS consent, one queue receipt on retry, accepted-versus-delivered status, uncertain outcomes without automatic resend, revoke-before-send and capability-free stored outbox rows. External provider transport is simulated; no message reaches Resend/Twilio. Delivery and reconciliation local HTTP runners and21 delivery concurrency checks are now in CI.

The staff message composer and attachment handoff are still being integrated. Audited Stripe event retry cycles remain separate work. No hosted2800+ migrations, sending flags, Stripe mutations or public deployment were applied in these increments. All clinical review, real provider acceptance, staff/Auth and hosting/cutover gates above remain open.

## Audited processing retry integration

PR80 adds4000 immutable retry-cycle receipts and bounded per-cycle attempts, preserving lifetime counts and earlier worker history. PR81 adds active-administrator discovery, review, exact-request retries and read-only recovery. The integrated frontend checks317 unit tests plus lint/typecheck/build. Four retry parser tests and three browser scenarios cover exact ownership/hash matching, completed/ignored and future event names, lost responses and staff denial;31 actual database contention checks are wired into CI. This does not authorize financial resolution or claim successful provider processing.

Antech integration remains contract-gated: [the current-source audit and phased plan](plans/antech-integration.md) identifies native lab schema gaps, result provenance/review, production authentication/schema/acknowledgment requirements and electronic-order acceptance. Public vendor documentation does not supply a complete production API contract. The owner confirmed that Antech has not yet assigned an account representative or onboarding contact; no vendor outreach, account changes or invented adapter endpoints were used.

## Complete local payment-message workflow integration

The payment composer now supports EMAIL/SMS review, exact hash-attested queueing, current contact/consent checks, invoice attachment handoff and original-request/receipt recovery across reload. Its invoice-screen dirty state is combined with payment collection and administrator reconciliation so conflicting changes remain guarded. The integrated branch passes full lint/typecheck/build and321 unit tests, plus33 combined invoice-email, Checkout/refund, collection-grant, delivery, reconciliation and processing-retry browser scenarios.

This closes the native staff delivery composer implementation gap. It does not prove real-provider delivery, hosted staff operation or commercial readiness. Existing44-check local delivery HTTP/queue/worker evidence uses synthetic transport; clinical full-workflow acceptance, Antech onboarding/contract, ezyVet account evidence, anesthesia provider, communications/Stripe commissioning and hosting gates remain.

## Cross-module clinical workflow evidence

The actual local clinical runner now connects one synthetic household/patient through clinic and housecall bookings, signed SOAP, stale/current critical-alert review, stock-backed vaccine and medication charges, an issued invoice, a vaccine certificate and selected-record release rendering. All26 checks passed again on the current local schema, including the additive lab foundation. CI runs the same test after the other real local workflow harnesses. [The evidence report](clinical-workflow-roundtrip.md) lists exact identities, exclusions and operational limits.

The temporary record-release policy gate and confirmation exist only inside a rolled-back test transaction; no clinician approval or release was saved. Random fixture cleanup and policy restoration were verified. The test does not cover reminder/provider delivery, automatic appointment-to-encounter linkage, private attachment transport, Antech or anesthesia integration, or hosted clinical acceptance. Those gates remain open.

## Native lab report provenance and verified private files

Migration4100 adds reviewed manual source identities, immutable report receipts, service-computed private-file digests, reviewed patient/order mappings, original/corrected report versions and separate DVM acknowledgments. The source registry starts empty and automated transport remains disabled. Staff cannot submit a browser-computed digest as verification. Existing lab notes, due plans and result-document fields remain intact.

The default-off verification endpoint downloads only the exact existing private patient document from configured Supabase Storage, checks bounded size and MIME, computes SHA-256 and captures immutable proof. Integration verification passed11 focused handler tests and13 actual local HTTP/Auth/Storage/database checks. Database development passed28 focused SQL assertions,81 existing lab/document regression assertions and13 contention checks. CI now includes the contention and actual private-file harnesses. See [the byte-verification evidence and limits](lab-report-byte-verification.md).

The integrated staff panel now supports reviewed source mappings, exact file verification, original/corrected report linking and separate DVM acknowledgment. Original actors can resume incomplete server receipts after browser session cleanup, retaining the same UUID and database timestamp. Full lint/typecheck/build and337 unit tests passed, followed by eight native-lab/provenance browser checks. These browser scenarios simulate backend responses; the13 actual private-file HTTP checks above provide separate runtime evidence.

These changes do not establish Antech connectivity, authenticity or clinical interpretation of a report, Dr. Susan Edler's approval, hosted deployment or client delivery. Antech onboarding remains pending an assigned contact and a production integration contract. The [hosted upgrade preflight](hosted-upgrade-preflight.md) found14 pending migrations and confirmed a successful dry run without applying them.

## Signed inbound integration correction

A real signed local HTTP request exposed a production defect: Svix2.5.0 verifies authenticity but returns no parsed event. The shared verifier now parses the exact signed body after successful verification. Eighteen focused inbound tests and25 actual local HTTP/signature/Auth/PostgREST checks pass, covering durable receipts, retries, inbox reads and unknown-sender review. [The evidence report](inbound-local-acceptance.md) distinguishes the real local database and signatures from synthetic provider reads. The fix is not yet hosted; external receiving and controlled provider acceptance remain open. Operational messaging documentation now reflects the implemented durable queue and managed worker authentication rather than retired direct-send routes.

## Reviewed historical medical-record originals

Migration4200 and the default-off verifier preserve a manually obtained medical-record original against an approved ezyVet animal mapping, exact local patient/document versions and explicit export provenance. Administrator approval, original/replacement history and independent per-version DVM acknowledgment remain separate. No native SOAP, diagnosis, vaccine, inventory or billing row is inferred from the file.

Integration verification passed12 focused handler tests and16 actual local HTTP/Auth/Storage/database checks. Database development passed42 focused assertions,106 existing regressions and22 contention checks; CI now runs the contention and actual private-file harnesses. The integrated staff panel supports reviewed original/replacement files, exact request recovery after session cleanup, paginated history and independent DVM acknowledgment recovery. Full lint/typecheck/build and353 unit tests passed, followed by13 combined lab/import browser checks. Browser transport is simulated; the16 actual private-file checks provide separate runtime evidence. [The implementation contract](plans/ezyvet-historical-records.md) preserves the outstanding structured-import and source-completeness requirements. [Supplemental C09/C10 clinician review](clinical-review/lab-import-addendum.md) is explicitly pending; no provider access, source authenticity, hosted rollout or clinical approval is implied.

## Signed SMS and remaining operator workflow gaps

Twenty-eight actual local signed-SMS HTTP/Auth/PostgREST checks passed for immediate STOP suppression, retrieval failure, chronological START handling, inbox persistence and receipt replay. [The evidence report](inbound-sms-local-acceptance.md) distinguishes actual signatures/database behavior from synthetic provider GETs. No external SMS or provider configuration occurred.

An all-source runtime audit at `f544f75` corrected an earlier overstatement: unknown-household assignment exists as a backend RPC and is tested directly, but has no staff browser consumer yet. Failed provider-processing events likewise have no operator queue or audited retry UI. These workflows are now being implemented separately; direct RPC tests do not prove usable staff recovery. Existing outgoing-message recovery is a different workflow.

## Audited inbound processing recovery backend

Migration4300 provides bounded safe queue discovery, immutable receipt/attempt/retry history and exact administrator-reviewed retries for exhausted generic processing failures. Each cycle allows ten claims, including crashed leases; content-mismatch/oversize and crash-only exhaustion remain visible but ineligible for this retry action. Release and completion require a current unexpired lease. The updated worker reports the state returned by the database instead of claiming a retry remains pending after exhaustion.

Database validation passed44 focused SQL assertions,39 existing regressions and16 contention checks. The companion actual email/Auth/PostgREST runner passed67 checks, including the staff review screen's exact assignment field projection. Integration reran28 actual signed-SMS checks and21 focused inbound tests successfully; the production worker's frozen Deno check passed. CI now includes inbound concurrency as well as both actual HTTP workflows. [The backend contract](plans/inbound-processing-recovery.md) records eligibility and preserved STOP suppression. Staff sender-review and retry screens are still undergoing separate integration; no hosted deployment, provider read/send, consent change or clinical acceptance was performed.

## Staff review of unmatched incoming replies

The integrated `/hub/inbox/review` screen now reads unassigned incoming originals as plain text, lets staff select an existing household and its conversation, and requires a reason and explicit confirmation. Lost-response recovery verifies the original inbound row and exact assignment audit; a competing staff assignment is a conflict rather than proof of success. Account changes clear retained intent data, and navigation guards preserve unsaved work. The screen does not change contact information or consent and does not send a reply.

Full lint/typecheck/build and359 unit tests passed on the integrated branch, followed by seven combined inbox/sender-review browser checks. Browser responses are simulated; the67-check actual backend workflow separately verifies assignment/projection semantics. Independent read-only review found no blocking issue; its post-await unmount guard suggestion was applied. [The staff workflow](features/inbound-household-review.md) closes the previously backend-only sender-review gap. The provider-processing queue/retry UI remains separate work, and real hosted staff/provider acceptance is still pending.


## Provider-processing staff recovery integration

The processing screen now exposes the migration-4300 safe queue to active staff and exact reviewed retries to administrators. It preserves the original request UUID across uncertain responses and reloads, supports receipt recovery from history, and distinguishes recorded retries from later processing or delivery. Clearing an uncertain local request requires changed authoritative work and a second receipt check; an absent receipt alone cannot prove cancellation.

The integrated branch passes lint (one existing Fast Refresh warning), typecheck, all 362 unit tests and the production build (existing chunk-size warning). Twelve combined processing, sender-review and inbox browser scenarios passed with simulated API responses. Independent review confirmed both requested recovery fixes. The actual database/HTTP evidence remains documented separately in the preceding backend integration; these browser checks do not establish hosted or external-provider acceptance.

Both previously backend-only inbound recovery screens are now integrated. The historical audit entries above describe their state at the named earlier revisions. See [the staff processing workflow](features/communication-processing-review.md). Hosted staging remains [a concrete proposal awaiting approval of a second project charge](hosted-staging-proposal.md); no additional project, hosted migration, provider request or public deployment was performed in this integration.


## Operational visibility and durable scheduler evidence

The ADMIN operations workspace now exposes safe global outbox exceptions, reminder candidates and blocked handoffs, inbound review counts and durable scheduler runs. Old unfinished Stripe events are reachable through keyset pagination in the existing reviewed retry panel. Stable source/job/run references and patient/conversation links support investigation; the workspace does not retry sends, alter consent or resolve financial uncertainty.

Migration4400 shares the existing reminder candidate query between queueing and discovery. The enabled worker confirms a stable start receipt, then queues and records completed counts atomically. Ambiguous responses use read-only receipt recovery; missing terminal evidence remains unknown. Disabled workers still create no database client or run.

Validation:374 integrated unit tests, lint/typecheck/build and16 combined operations, Stripe and inbound browser checks passed. The actual local HTTP/Auth/PostgREST workflow passed26 checks, including one queued synthetic email reminder with no provider attempt and verified cleanup. Database validation passed53 focused assertions,20 candidate-equivalence assertions,15 contention checks and123 existing reminder/outbox/Stripe regressions. Independent read-only database review found no blocking issue. CI includes the new contention and actual HTTP runners; the frozen queue-reminders entrypoint check passed. Existing Fast Refresh and bundle-size warnings remain.

See [operations workflow](features/operations-visibility.md) and [scheduler evidence](operations-scheduler-runtime.md). This supplies local operational evidence, not deployed monitoring or cron/provider activation. The newly observed hosted migration gaps remain unmodified and require deployment coordination; staff/provider/clinical acceptance and launch inputs remain open.


## Reviewed pre-provider outgoing retry recovery

Administrators can now open an exact outgoing exception from Operations, review its original safe source context, attest to a completed repair and recover the original retry action after lost acknowledgments or browser-pointer loss. A monotonic outbox revision prevents a later failure from reusing an older review. Local cleanup additionally requires a strictly increased revision and a second receipt check; reversible contact/source eligibility changes alone do not authorize discarding an uncertain request.

Migration4500 revokes the unversioned retry entry point. Fresh review is limited to failed work with no provider attempt, acceptance, delivery or reconciliation evidence. Existing reminder, invoice, release, document-link and payment-delivery source checks remain in force, as does the final worker materialization chain. The same outbox/message/payload is returned to pending; no new message or provider request is created by the retry action. Previously attempted and uncertain work still requires a reviewed provider-evidence recovery path and is not claimed complete by this increment.

Integrated validation passed376 unit tests, lint/typecheck/build and15 combined retry/operations/inbound browser checks. The actual local Auth/PostgREST runner passed30 checks, including a discarded committed retry response followed by another preflight failure: original receipt recovery/replay did not requeue that later failure. Database validation passed41 focused assertions,292 source/base assertions and24 contention checks. Source-specific tests found and fixed a document-link helper naming ambiguity before integration. Independent read-only database review found no blocking issue; CI includes the contention and actual HTTP runners. Existing Fast Refresh and bundle-size warnings remain.

See [staff retry workflow](features/outbox-retry-review.md) and [actual local evidence](outbox-retry-local-acceptance.md). No hosted migration, provider call, consent change or public deployment occurred. Provider reconciliation acceptance, hosted migration coordination, accounts, staff access and clinical review remain open.


## Current-stack restore revalidation

The isolated restore rehearsal passed again at `d265177`, capturing and restoring all65 migrations through4500. Actual fresh login, private file checksum/access controls, signed clinical history, invoice/credit and stock checks passed; generated resources were verified removed. [The dated restore evidence](restore-runbook.md) records checksums, timings and limits, including that newer payment/scheduler/retry tables are schema-restored but not populated by this fixture. Hosted project revalidation still found51 migrations through3400 and zero Auth users, Storage objects, clients and pets; no hosted changes were made. Local restore success does not resolve the hosted migration gaps or establish production backup coverage.

The local observed-gap rehearsal now passes51→65 migrations with synthetic records present before backfill. All captured clinical/billing/Auth/Storage rows survived unchanged; public function definitions/security/configuration/effective grants and trigger bindings matched a separate canonical installation. Full database/private-Storage restoration and generated-resource cleanup also passed. [Sanitized evidence](hosted-upgrade-preflight.md) records scope and checksums. Hosted migration coordination and provider/clinical acceptance remain open.

Read-only hosted catalog comparison after PR100 found six broader execution grants despite matching migration receipts, 259 application function bodies/owners/security configurations and 168 trigger bindings/enable modes. Existing internal authorization checks remain, but pending migrations through4500 do not normalize the extra direct-role grants. [The preflight evidence](hosted-upgrade-preflight.md) records the exact differences and a pending additive correction; no hosted permissions were changed. The stronger local rehearsal and five comparison regression tests passed.

Migration4600 now explicitly corrects the six observed direct-role RPC grant differences. It passed46 focused SQL assertions,54 existing staff/ezyVet regressions and28 rollback upgrade checks. A full51→66 local rehearsal began with the observed permissions, matched the hosted routine inventory, converged to canonical permissions after all15 pending migrations, preserved captured records and passed database/private-Storage restore plus cleanup. [Correction evidence](explicit-rpc-grants.md) records the limits. The hosted correction remains unapplied; commercial readiness and provider/clinical acceptance remain incomplete.

The next planned release extension is [schema5 selected lab/external-original provenance](../plans/20260913-release-source-provenance/plan.md). Scouts confirmed that schema4 does not include4100/4200 version ledgers and both delivery capture paths lack comparison to those original capture digests. The plan requires explicit selection, historical compatibility, safe acknowledgment locks and independent byte checks before claiming this workflow implemented. No release format, clinical acceptance or delivery behavior changed in the planning increment.

## September 13 — hosted staging initialized

The owner authorized the recommended additional $10/month staging project. `livingroom-vet-staging` (`kothoqicubowyhwfsrte`, US West) now contains the 71-migration PR107 schema. Hosted checks confirm zero clients, pets, Auth users and Storage objects, four private buckets, and no release/reminder policy rows. Public signup and email autoconfirm are disabled. The 28 reviewed Edge functions are deployed; frontend, staff and provider commissioning remain pending. See [staging setup and CLI findings](hosted-staging-proposal.md). Earlier entries describing staging as proposed reflect their historical integration state.

## September 13 — mail topology selected

The owner corrected the mail selection to Fastmail for private staff mailboxes and one Resend team for automated practice notices plus authentication/security mail. Postmark is removed; shared-team Auth/client webhook routing needs implementation and acceptance. Preparation is authorized; no mail purchase or second Resend team is authorized. Exact checkout prices remain pending. Clinical record/lab delivery remains required but is outside this initial transport commissioning scope. See the [selected mail plan](mail-commissioning-plan.md).

The owner confirmed production ezyVet API credentials from Vet Connect Hub and authorized copying them into staging. Lovable could list only saved secret names. An owner-session ezyVet export subsequently supplied the client ID, client secret and site UID, now stored in staging. Existing credentials subsequently passed OAuth and a bounded contact read without a partner ID; clinical resource acceptance remains pending.

## Owner direction — continue with read-only ezyVet imports

Dr. Susan Edler owns the inquiry to her ezyVet representative. Build against read-only ezyVet access and keep Living Room Vet as the primary record system. Continue vaccination, prescription, attachment and reconciliation implementation independently of provider correspondence. Basic API authentication is verified; clinical-resource sample acceptance remains pending; no write-back or additional service fee is authorized. Mail remains Fastmail + one Resend team, including authentication mail, with no Postmark.

## Existing read-only API verified

The source GreenTree credentials returned HTTP 200 for OAuth without a partner ID. Issued scope/site claims matched the requested read-contact/read-animal access and exported site; a bounded one-record contact GET returned HTTP 200. Nothing was imported or modified. The mandatory partner-ID gate was removed from the adapter; Dr. Edler’s separate inquiry about two-way access no longer blocks read-only connection work.

## Consult-scoped vaccination intake — implementation stack

Migration 5200 and the administrator intake workflow freeze the approved patient mapping and current scoped consultation, preserve raw vaccination evidence, and support exact-run recovery and server discovery. Generic vaccination ingestion is blocked. Shared navigation protection retains pending clinical and vaccination work together.

Verification passes: 407 unit tests, 24 importer tests, 21 targeted browser tests, 81 focused SQL assertions, 215 existing import regressions, 53 concurrency/runner checks and 43 actual disposable Auth/HTTP checks. Lint, type checking and the production build pass with existing warnings. Receipt backup/restore verification is tracked in [runtime evidence](vaccination-runtime-evidence.md).

This completes source intake implementation only. Product mapping, date interpretation, clinical adoption and Dr. Edler's review remain later work. The new migration and optional-partner importer are now deployed to hosted staging; permission and anonymous-denial checks passed. The direct read-only connection proof remains separate from hosted staff and vaccination sample acceptance. See [staging commissioning](vaccination-staging-commissioning.md).

## Reviewed outside vaccination history — implementation stack

The patient chart now provides DVM-reviewed interpretation of scoped ezyVet vaccinations, immutable correction history, durable request recovery and active-staff read access. Schema7 packages explicitly include outside vaccination history with existing narratives and original-file verification. Approval creates no native treatment, due plan, stock movement, charge, certificate or reminder.

Validation:418 unit tests,45 targeted browser cases,57 focused review SQL assertions,143 existing regressions,59 observed concurrency checks,24 release SQL assertions,70 actual local review API checks and42 actual local mixed-release checks passed. The51→74 upgrade/restore preserved reviewed vaccination/source lineage and existing fixtures, with cleanup verified. [Feature/evidence](features/reviewed-outside-vaccinations.md) and [Dr. Edler's unapproved review cases](clinical-review/outside-vaccination-history.md) are recorded.

This increment is not yet deployed to hosted staging. Active due-plan adoption, global source-product mapping, clinical approval and authorized practice acceptance remain required subsequent work. No public cutover or clinical policy activation occurred.
