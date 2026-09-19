# Direct integrations — no ezyVet in the middle

Date: 2026-09-19. Companion to `MAP.md` (Track F). Source: web research of vendor sites and developer docs on this date. "Unverified" means no primary source could be read; treat it as a lead, not a fact.

## The one-paragraph answer

Every veterinary-specific vendor — reference labs, commercial PACS, pharmacies, insurers, microchip registries, client financing — is **partner-gated**: you apply as a PIMS vendor and wait. **Imaging is the exception**, because DICOM is an open standard: a single clinic can integrate X-ray with no vendor permission at all. Everything else should be built as *adapter interface + manual fallback now, real API when the vendor approves*. The repo already works this way for labs.

Naming hazard: **"VetConnect PLUS" is an IDEXX lab product and trademark.** It has nothing to do with the clinic's internal "Vet Connect Hub". Keep the names apart in UI and docs; consider renaming the Hub before anything is marketed.

## Verdicts

| Integration | Verdict | What to build |
|---|---|---|
| **X-ray / imaging — self-hosted Orthanc + OHIF viewer** | **OPEN** | See "Imaging" below. Highest value for zero gatekeeping. |
| IDEXX Web PACS · Antech Imaging/Sound · Asteris Keystone · Vet Rocket · Heska/Cuattro | PARTNER-GATED | If the clinic already uses one, v1 = store an "open study" URL on the imaging order. |
| **Antech reference lab** (the chosen lab) | PARTNER-GATED — no public portal or spec | Apply **now** via the Antech account rep; ask for the PIMS integration team. Interim: order in HealthTracks in a side tab, record Antech test codes on the native lab order, ingest result PDFs by upload or inbound email. Model the internal interface on ezyVet's **public** lab spec (`developers.ezyvet.com/dx.html`) so the real API drops in later. |
| IDEXX VetConnect PLUS · Zoetis labs · in-house analysers | PARTNER-GATED | Same manual/PDF fallback. Precedent: the open-source PIMS OpenVPMS obtained IDEXX access, so small vendors are onboarded — slowly. |
| **Stripe Terminal** (card-present) · **Stripe Billing** (card-on-file, plans) | OPEN | Extends the existing Stripe ledger. Deposits, split tender, refund-to-original-tender. |
| Trupanion Express · CareCredit · Scratchpay · Cherry | PARTNER-GATED / no API | Record as a tender type; generate an itemised invoice + medical-record PDF that serves any insurer claim. |
| **Vetcove** purchasing / home delivery | PARTNER-GATED, but the OpenAPI spec is public (`integration.vetcove.com/redoc/`) | Worth applying. Interim: CSV purchase-order export. |
| Vetsource · Covetrus · Chewy Practice Hub | PARTNER-GATED / no API | Native "external prescription" record: approve in the vendor portal, log it in the chart, print a written prescription. |
| Microchip registries (AKC Reunite, HomeAgain, PetLink) | PARTNER-GATED / no API | Store number + brand + implant date; link out to the AAHA universal lookup. |
| **QuickBooks Online / Xero** | OPEN | One **daily summary journal entry** (revenue by category, tax, payments by tender, A/R change). Do not sync invoice-by-invoice. |
| **E-signature / consent** | OPEN | Build native (signature pad → hashed PDF + audit trail). This is MAP task E3. |
| **AI scribe / dictation** | OPEN if built in (speech-to-text + LLM API); vet-specific scribe vendors have no public API | Later. Clinician must review and sign — never auto-file. |
| Twilio SMS · Resend email | OPEN — already integrated | Register A2P 10DLC before go-live. |
| SmartFlow / Vet Radar (treatment sheets, whiteboard) | IDEXX add-ons | Build the whiteboard natively (MAP task C5) and skip the dependency. |
| Controlled-drug cabinets (CUBEX, Modeus) | PARTNER-GATED | Not needed for a small clinic; the native log (MAP E5) is the requirement. |

## Imaging — the recommended path

How PIMS ↔ X-ray works everywhere: the PIMS publishes an order to a **DICOM Modality Worklist**; the X-ray console pulls it (no retyping, and the accession number ties the study to the order); the console **sends the study** to a PACS; the PIMS opens it in a viewer.

**Architecture constraint:** worklist and study-send are raw TCP DICOM protocols. They **cannot run in Supabase edge functions**. The clinic needs one small always-on box on its network (mini-PC / NAS / Docker host).

1. Run **Orthanc** (GPLv3) with its DICOMweb and Worklists plugins on that box. The Worklists plugin has had a REST API for creating entries since Nov 2025.
2. A native imaging order posts a worklist entry to Orthanc over REST. Accession number = the order ID.
3. The X-ray vendor's technician points the console at Orthanc as both worklist source and send destination — a routine request.
4. Orthanc's "stable study" callback (or a poll) writes study ID + accession back to Supabase.
5. The patient record shows thumbnails and an "Open study" button into **OHIF** (MIT licence). Caveat: OHIF lacks vet-specific measurements (vertebral heart score, TPLO).
6. Nightly off-site replication of Orthanc to object storage. Teleradiology: DICOM-send from Orthanc to the reading service; attach the report PDF to the order.

**First, an owner question:** what X-ray hardware and PACS will 2619 Spruce actually have? If the vendor bundles a cloud PACS, v1 is just a stored study link and Orthanc can wait. Also ask whether Modality Worklist is a paid licence option on that console.

Tiering: the data model (imaging order, study link, report attachment) is **S→K**. The Orthanc box is infrastructure — owner + stronger model, not the executor.

## Regulatory inputs the software must honour (Colorado / US)

| Topic | Requirement | Consequence for the build |
|---|---|---|
| Record retention | **≥ 3 years after the patient's last exam**; written storage/security/disposal plan; copies to owners on request (C.R.S. 12-315-119 — verified). | **The repo's dormant `apply_retention_policies()` archives conversations after 365 idle days and hard-deletes them 730 days later, keyed to the last message — not the last exam. Never enable it as configured** (verified: it touches only `conversations`; it is off and has no caller). Clinical records and client communications need soft-delete only and a retention clock keyed to last exam (MAP E9). |
| Rabies certificate | NASPHV Form 51 fields: owner name/address/phone; species, name, age, sex/altered, weight, breed, colour, microchip; tag number; vaccine product, manufacturer, serial/lot, 1- or 3-year, initial/booster; date given and next due; veterinarian name, licence number, address, signature. | Diff `src/hub/features/certificates/` against this list (tier K, read-only audit first). |
| Controlled substances | 21 CFR 1304: records kept ≥ 2 years; initial + biennial inventory; Schedule II separate, III–V readily retrievable; each dispensing record = drug/strength/form, quantity, **owner name and address** + patient, date, dispenser initials; receipts dated. | MAP task E5. Append-only, per-container running balance, witnessed waste, discrepancy report. |
| Colorado PDMP | Daily reporting duty falls on pharmacies; practitioner in-clinic dispensing appears **not** reportable (secondary source — **confirm with the State Board of Pharmacy**). | No PDMP feed now. Keep dispensing data structured (NDC, quantity, days' supply, owner DOB/address) so an export can be added. |
| Prescription labels | Dispenser name/address, serial number, date, drug, prescriber, patient, directions/cautions (C.R.S. 12-280-124 — from summary, unverified); AVMA adds client, species, strength, quantity, expiry, refills, "for veterinary use only". | Audit the saved-fill print template in `src/hub/features/prescriptions/`. |
| HIPAA | **Does not apply** to veterinary records. Confidentiality comes from C.R.S. 12-315-119 and AVMA ethics. | Do not market as "HIPAA compliant". |
| Colorado Privacy Act | Applies at ≥100,000 consumers/yr — a single clinic is far below. Breach-notification and reasonable-security statutes still apply. | Privacy policy still needed (MAP E8). PCI scope stays minimal with Stripe-hosted fields and Terminal. |

Unverified and needing counsel or the vendor: Antech's API protocol and onboarding criteria · IDEXX's partner criteria · Colorado PDMP account duty for DEA-registered vets · 4 CCR 727-1 field-level record and label rules · Colorado's veterinary telehealth relationship rule · DEA Forms 106/41 handling.

## What "2022 ezyVet" actually was

ezyVet's only documented redesign is **Q1 2024**: the persistent black left sidebar became hidden by default (full-screen view), the memo preview moved, user names became avatars, a floating footer appeared. The **information architecture did not change** — primary module tabs, left sidebar, record tabs, a patient summary sidebar, global search, quick links. So the "simple 2022 layout" the vets miss is most plausibly: a **persistent left rail**, **context that never scrolls away**, and **memos visible at a glance**. Those are MAP tasks C1, C2, C6, C7. Cheap confirmation: ask Dr. Edler to point at a 2022 screenshot and say what she misses.

Migration note: ezyVet sells existing customers a "Private Integration" to their own data ($500 one-time read-only; approval takes weeks). `AGENTS.md` records that the owner chose **not** to pursue further ezyVet integration, and the reviewed history already imported is preserved. Nothing here reopens that decision.
