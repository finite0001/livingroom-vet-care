# Complete feedback-to-work matrix

**Evidence baseline:** `1790f11`, October 8 review. “Existing” means source/SQL implementation was inspected, not that production or clinical approval passed. Existing tests were inspected, not run. Every row is required before launch; Google Maps' originally optional request already has an implementation. Blank checklist entries carry no additional requirement.

Source paths below are relative to `/Users/davidedler/Developer/lrv-feedback-plan-20261008`. Phase files give implementation and acceptance detail. Duplicated requests retain separate IDs so nothing disappears in consolidation.

## October 8 list — 25 items

| ID | Feedback / confirmed meaning | Current implementation and gap | Phase / acceptance target |
|---|---|---|---|
| N01 | MWI and Midwest SKU product imports | Inventory/lot ledger exists in `src/hub/features/inventory/`; supplier identifiers/imports absent | 5: approved import from each actual supplier sample, repeat import does not duplicate; package units explicit |
| N02 | Barcode scanning → iPhone camera | No barcode identifiers or scanner UI found | 5: scan real agreed product labels on iPhone; confirm product, do not silently change stock |
| N03 | Whogot | `patient_treatments` and `native_dispenses` exist; cross-patient search and performed-service records absent | 1: button finds actual administered/dispensed/performed events; never infer receipt from prescribing/billing alone |
| N04 | Require phone and email | `src/hub/components/clients/client-form.ts` and `save_client` allow blank/null | 1: both mandatory in UI/server; legacy contacts corrected without made-up values |
| N05 | Client with multiple pets | Existing client/patient linkage and household Patient 360 | 0/1: create two pets, reload, switch charts without mixing histories |
| N06 | Payment plans → third-party financing | Stripe-based payments exist; external financing absent | 6: approved provider handoff plus verified settlement/refund reconciliation |
| N07 | Remind unpaid owners | Invoice/payment links exist; no due terms or overdue reminder workflow | 6: due/partial balances reflected; paid/void/disputed invoices suppressed at send time |
| N08 | Stop routine communication after death | Existing care reminder discovery, invalidation and final-attempt checks | 2: death after enqueue blocks send; living sibling remains eligible; extend to new reminder kinds |
| N09 | Client required before patient | Existing `pets.client_id NOT NULL`, restrictive relationship and create flow | 1: all create paths require valid, contact-complete client; no orphan patient |
| N10 | Gusto two-way exchange | Time clock/timesheet export exists; no Gusto connector | 7: supported internal-access proof and reconciled staff/time/compensation/payroll exchange; unsupported access remains a blocker |
| N11 | Standard and patient-specific reminders | Vaccine plans and lab due dates exist; general wellness/custom recurrence absent | 2: approved annual/quarterly/etc. templates and per-patient overrides, one next occurrence |
| N12 | Outbound delivery → Daily communications | `DeliveriesPage.tsx` reads legacy deliveries only | 2: preserved route, renamed UI, date-filtered canonical and historical message status |
| N13 | Records-request folder | Ticket checkbox and release/upload tools exist; dedicated queue absent | 2: incoming/outgoing requests track assignee, due date, exact scope and actual fulfillment |
| N14 | Diagnostic trends | Lab orders, original reports and reviewed corrections exist; numeric observations absent | 3: clinically comparable analytes over time, units/ranges/source/corrections visible |
| N15 | Diagnostics always also PDF | Original PDFs upload; generated releases are HTML | 3: every finalized diagnostic report gets a stored versioned PDF, previewed and emailable |
| N16 | Manual in-house diagnostics | Free-text lab notes exist; structured result entry absent | 3: numeric/text observations with units, source, collection time and reviewer |
| N17 | Pet photo | Identity photo merged/deployed in PR #232; practice acceptance pending | 1: authorized upload/change/remove photo in patient header |
| N18 | VetRec-style SOAP, recap, calls, dental | Native SOAP/dental and CloudTalk call summaries exist; encounter scribe/record recap absent | 7: reviewed draft generation for all four workflows, source attribution and no auto-signing |
| N19 | VetSnap-style controlled-drug log | Inventory, dispensing and anesthesia drug links exist; controlled register/witness absent | 5: balances, independent witness, corrections, waste/count/reconciliation and export |
| N20 | VetRocket X-ray/PACS integration | No native connector found | 7: patient-matched study/viewer/report integration proven against practice account; automation level confirmed |
| N21 | Doctor production with adjustable percentages | Invoice lines lack explicit DVM credit; dashboard metrics are communications metrics | 6: net-invoiced attributed production with effective-dated % and reconciled adjustments |
| N22 | Send some/all records, vaccine-only | Explicit source selection, email/SMS document links exist; package/selection limits apply | 2/3: exact selected snapshot/PDF delivery, full-chart package manifest and explicit recipient authorization |
| N23 | Appointment types, durations, species, sick/well | Free-text reason, editable duration, resources/conflict checks exist | 4: configured types/defaults/species/resource rules with recorded overrides |
| N24 | Prompt next visit at appointment end | Patient 360 booking links exist; completion prompt absent | 4: one prompt after completion; book/defer/decline without duplicate booking |
| N25 | Schedule-based cleaning/restocking tasks | No facilities-task domain; room resource is free text | 4: tasks created once, linked to room/procedure, rescheduled/cancelled predictably |

## Housecall list — 20 substantive items

| ID | Feedback | Current implementation / evidence | Phase / acceptance target |
|---|---|---|---|
| H01 | Pet name, age, species, breed, weight, birthday, color, microchip | Existing `features/patients/PatientFormDialog.tsx`, `WeightHistory.tsx`, `patient-details.ts` | 0/1: dated weights, estimated-birth precision, save/reload |
| H02 | Vaccine due dates and last administered | Existing `features/vaccines/PatientVaccineStatus.tsx` and due plans | 0/2: upcoming/overdue/unknown history verified; no guessed interval |
| H03 | SOAP clinical records | Existing `features/clinical/ClinicalWorkspace.tsx` | 0/7: draft/sign/addendum and AI draft review separately verified |
| H04 | Highlight important diagnoses/reactions | Existing `PatientAlerts.tsx`, `PatientProblems.tsx`, treatment alert review | 0: high-importance reaction remains visible during treatment entry |
| H05 | Text/email clients with records/labs | Existing inbox/email attachments and secure document links | 0/2/3: email actual files; SMS secure links; correct recipient and selected patient |
| H06 | Custom and standard vaccine/lab reminders | Existing care reminder plans and lab reminder flag | 2: approved templates, patient override, final eligibility recheck |
| H07 | Vaccine certificate with all due dates | Existing `features/certificates/PatientCertificates.tsx` | 0/3: issuer reviewed, accurate administered/due/unknown states; PDF path |
| H08 | Rabies certificate with complete vaccine data | Existing certificate schema/issuer workflow | 0/3: approved template, product/lot/dates/signature/serial; historical source not recertified |
| H09 | Send payable invoice by text/email | Existing `features/payments/`, `features/billing/` | 0/6: invoice delivery, payment, partial/refund/financing evidence reconciled |
| H10 | Email selected/all medical records/certificates | Existing `features/record-releases/selection.ts` and composers | 2/3: exact selected records and PDFs; intentional inclusion of originals |
| H11 | Medication lots, expiry, inventory and billing | Existing inventory and native prescription/fulfillment ledgers | 0/5: receive/dispense/return/bill consistency; supplier and controlled-drug extensions |
| H12 | Vaccine inventory/info and billing | Existing vaccine catalog profiles, lots, treatments/invoice linkage | 0/5: correct product/lot/patient and single stock/billing movement |
| H13 | Schedule with Google Maps bonus | Existing `features/scheduling/HousecallDayRoute.tsx`, `housecall-route.ts` | 0/4: working daily directions and travel conflict behavior; no route-optimization claim |
| H14 | Automatic appointment reminders | Existing canonical reminder outbox | 0/2: one eligible reminder per schedule/version/channel; cancellation/reschedule honored |
| H15 | Dental chart saved to record | Existing `PatientDentalChart.tsx`, signed history/addenda | 0/7: dog/cat chart acceptance; dictated tooth changes require review |
| H16 | Automatically integrate anesthesia records | Existing `PatientAnesthesiaRecords.tsx` is manual/transcribed only | 7: real selected device/export import, patient/encounter matching, dedupe and provenance |
| H17 | QOL charting | Existing qualitative charts and `QolScaleCharts.tsx` HHHHHMM | 0: reviewed wording/scores/history; no automatic clinical conclusion |
| H18 | Reopen/update mass body maps | Existing `PatientCareCharts.tsx`, lesion observations/photo references | 0: longitudinal lesions and measurements with preserved signed history |
| H19 | Unified inbox | Existing `ConversationsPage.tsx`, CloudTalk/AgentMail ingestion | 0/2: incoming/outgoing email/SMS/calls linked correctly and staff access honored |
| H20 | Client name/address/phone/email (already checked) | Contact/address editor exists; stricter phone+email requirement is new | 1: retain addresses; enforce N04 at every persisted client entry path |

## Evidence anchors and limitations

- Patient and multi-pet tests: `e2e/patients.spec.ts`, `supabase/tests/clinical_core.test.sql`.
- Clinical tests: `e2e/clinical.spec.ts`, `e2e/vaccine-status.spec.ts`, `e2e/vaccine-certificates.spec.ts`, `e2e/dental.spec.ts`, `e2e/care-charts.spec.ts`, `e2e/qol-scale.spec.ts`, `e2e/anesthesia.spec.ts`.
- Diagnostic/release tests: `e2e/lab-work.spec.ts`, `e2e/lab-results.spec.ts`, `e2e/record-release-workflow.spec.ts`, `e2e/native-record-releases.spec.ts` and SQL provenance/concurrency suites.
- Inventory/reminder tests: `supabase/tests/inventory_billing.test.sql`, `inventory_product_locking.test.sql`, `tests/reminder-dispatch/pipeline-ownership.test.ts`.
- Hosted receipt: `docs/launch-evidence/2026-10-01-linkage-audit-rollout.md`. It reports 167 migrations and the then-current provider configuration; it is historical, not an October 8 live-state verification.
- Acceptance register: `docs/clinical-staff-acceptance-register.json` still records pending decisions. Do not substitute passing engineering tests for these decisions.
- The linked Perplexity artifact returned no readable content. This matrix covers the pasted checklist and Dave's subsequent clarifications; it makes no claim to include unseen artifact content.
