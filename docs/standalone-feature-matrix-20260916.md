# Standalone platform feature audit

Status: initial code-backed inventory, not a claim of complete feature parity or commercial acceptance. The owner requires an independent Living Room Vet ecosystem, ezyVet feature parity and Vet Connect Hub communications. See [the recorded direction](standalone-platform-direction-20260916.md). No ongoing ezyVet connection is required. Original clinical, housecall and communications requirements remain in scope.

Evidence levels: **native** means a reachable implementation and related tests were inspected; it does not establish hosted or clinician acceptance. **gap** means the inspected implementation lacks the described workflow. **unassessed** preserves a parity requirement pending deeper inspection; it is not an assertion of absence.

## Native clinical and practice workflows

| Capability | Repository evidence | Remaining work |
|---|---|---|
| Household and patient records | `src/hub/pages/ClientsPage.tsx`, `ClientProfilePage.tsx`, `features/patients/PatientFormDialog.tsx`, `WeightHistory.tsx`; client/patient browser suites | Native. Hosted staff acceptance; retain housecall address, precise birth dates and dated weights. |
| SOAP, diagnoses and critical alerts | `src/hub/features/clinical/ClinicalWorkspace.tsx`, `PatientProblems.tsx`, `PatientAlerts.tsx`; `supabase/tests/clinical_core.test.sql` | Native signed notes/addenda and safety acknowledgments. Dr. Edler review pending. |
| Clinic and housecall scheduling | `features/scheduling/SchedulePage.tsx`, `HousecallDayRoute.tsx`; scheduling and route browser suites | Native Denver-time bookings and Maps links. Travel optimization is not established by Maps links. |
| Care and appointment reminders | `features/care-reminders/CareRemindersPage.tsx`; `care_reminders.test.sql`, `reminder_outbox.test.sql` | Native due plans and overrides. Clinical interval/wording review and live delivery acceptance remain. |
| Medication/vaccine stock and administration | `features/inventory/InventoryPage.tsx`, `features/treatments/PatientTreatments.tsx`; `inventory_billing.test.sql` | Native lots, expiry, locations, stock movements and administration charges. Native prescription dispensing now has its own linked ledger/workspace below. Supplier purchasing and stock transfers remain unassessed gaps. |
| Prescriptions and refills | `src/hub/features/prescriptions/`, `pages/RefillsPage.tsx`, `hooks/use-refills.ts` | **Native authorization implemented and locally verified:** configured DVM signing, immutable orders, cancellation/replacement, current status and order copies ([evidence](evidence/native-prescribing-events-20260916.json)). **Native refill intake/links locally verified:** explicit patient selection, assignment, exact-order links, close/deny and preserved read-only legacy history ([evidence](evidence/native-refill-intake-20260916.json)). **Native fulfillment implemented:** versioned allowance, partial/multiple-lot stock and invoice transactions, explicit forfeiture, separate pickup and exact saved-fill printing ([evidence](evidence/native-fulfillment-20260916.json)). **Native selected releases implemented:** explicit signed orders/dispenses with frozen status, lots, usage and pickup, retaining historical packages and original-byte checks. **Corrections and physical returns locally verified:** immutable annotations/pickup amendments, held custody, disposal and guarded restocking with printV3/schema12 disclosure ([return evidence](evidence/native-dispense-returns-20260916.json)). **Synthetic acceptance passed:** erroneous-return quantity reconciliation and unresolved physical discrepancies in [PR151](https://github.com/finite0001/livingroom-vet-care/pull/151), including lot holds and print4/schema13. CI35086396244 passed database, actual Auth/browser, contention and restore acceptance; hosted rollout and clinical review remain pending. **Synthetic acceptance passed:** dispense-linked credits/refunds and terminal uncertain-request resolution in PR154 (CI35091844016); hosted rollout remains pending. See the [reconciliation contract](../plans/20260916-native-prescribing/return-reconciliation-contract.md). Legacy queue statuses confer no clinical authority. Clinical review and rollout remain pending. |
| Estimates and quotes | Versioned native draft foundation candidate: immutable priced revisions, household editor, history and saved-request resolution (PR155) | **Draft backend CI and local staff UI acceptance passed:** [evidence](evidence/native-estimate-drafts-20260916.json); final combined-source CI and hosted rollout pending. **Still missing:** exact publication/delivery, client decisions and accepted-price execution for services, vaccines and medications. See the native estimates plan. |
| Billing and payments | `features/billing/HouseholdInvoices.tsx`, payment and invoice-document modules; billing/payment browser suites | Native billing/credit/recovery machinery. Stripe sandbox acceptance deferred pending owner setup. |
| Vaccination and rabies certificates | `features/certificates/PatientCertificates.tsx`, `print.ts`; certificate SQL/browser suites | Native issued versions/corrections and due plans. Issuer and clinical acceptance pending. |
| Dental chart | `features/dental/PatientDentalChart.tsx`, `tooth-chart.ts`; dental SQL/browser suites | Native findings, signed history and corrections. Dr. Edler review pending. |
| Anesthesia | `features/anesthesia/PatientAnesthesiaRecords.tsx`, `model.ts`; anesthesia SQL/browser suites | Native manual monitoring/events and originals. Automatic device/vendor import is not configured; vendor undecided. |
| QOL and mass maps | `features/care-charts/PatientCareCharts.tsx`; care-chart browser suite | Native qualitative QOL and longitudinal lesions. Clinical acceptance pending; no validated automatic QOL score claimed. |
| Lab work/results | `features/lab-work/PatientLabWork.tsx`, `PatientLabResults.tsx`; lab/provenance SQL/browser suites | Native manual orders, due plans, originals and DVM acknowledgment. Antech order/result automation remains a provider gap. |
| Selected record packages | `features/record-releases` and secure document links; record-release workflow tests | Native explicit selection/frozen output. Clinical authorization and controlled live delivery acceptance remain. |
| Staff and access | `src/hub/pages/AdminStaffPage.tsx`; `staff_access.test.sql` | Native invitations and ADMIN/DVM/TECH/STAFF roles. Hosted staffing and operational acceptance remain. |
| Practice reporting | `src/hub/pages/AdminDashboardPage.tsx`, `hooks/use-admin-metrics.ts` | Existing dashboard is communication analytics. **Gap:** practice financial/clinical/stock reporting is not established. |

Paths beginning `features/` or `hooks/` in this table are relative to `src/hub/`. The existing [clinical review pack](clinical-review/README.md) remains unapproved; code/test coverage is not clinical acceptance.

## ezyVet reference coverage

The official [feature catalog](https://www.ezyvet.com/features) and [knowledge-center index](https://docs.ezyvet.com/en/browse-documentation/ezyvet) provide a starting inventory. Marketing categories and API endpoints are not exhaustive acceptance specifications. Some direct documentation pages reject automated browsing; indexed official content supports this initial inventory, with detailed workflow inspection still required.

The published catalog adds these parity areas to the original practice requirements: client portal, self check-in, boarding, case assignees/watchers, templates, dictation, tags/custom fields, client e-signatures, internal memos, student supervision, multiple locations, time clock, wellness subscriptions, discounts, statements, split billing, barcodes, bundles, purchasing and stock transfers. Each remains **unassessed** unless the native table above establishes the complete corresponding workflow; none is silently removed from scope. [Feature catalog](https://www.ezyvet.com/features)

| Reference area | Audit target |
|---|---|
| Appointment workflows | Configurable appointment types/statuses, client signatures and charge capture. Native implementation must preserve clinician-controlled actions. [Official appointment overview](https://www.ezyvet.com/features/appointment-management) |
| Financial workflows | Estimates, statements, pricing/bundles, remote payment links and insurance-related workflows. Compare native record lifecycle and recovery, not just document appearance. [Official invoicing overview](https://www.ezyvet.com/features/invoicing-and-transactions) |
| Business reporting | Financial and activity filters, staff/product breakdowns, scheduled reports and underlying totals. Do not infer parity from a dashboard. [Official reporting overview](https://www.ezyvet.com/features/business-reporting) |
| Inventory and prescriptions | Catalogs, balances, purchasing, batches and prescription entities appear in the API reference. Use these as discovery prompts; endpoint availability does not prove an equivalent staff workflow. [Official API reference](https://developers.ezyvet.com/) |

## Client-facing workflow audit

Read-only native route/server inspection at `19e044a` established these additional gaps. No hosted access or provider calls were made.

| Capability | Evidence and status |
|---|---|
| Client portal | **Gap:** `/hub/client/:id` and `/hub/patient/:id` require active staff through `src/App.tsx` and `ProtectedRoute.tsx`. No client authentication, household membership, portal dashboard or client-managed patient workflow found. |
| Appointment self check-in | **Gap:** `/contact`, `public-contact` and `accept_contact_intake` collect inquiries. They do not identify an appointment, confirm a patient, record arrival or populate a staff check-in queue. |
| Client e-signatures | **Gap:** legacy consent tables, token lookup and a ticket checkbox exist, but no reachable consent route, signature UI, signing RPC or immutable signed snapshot/version was found. Existing schema does not prove a signing workflow. |
| Shared documents | Native scoped `/shared/:grant` access via `SharedDocumentsPage.tsx` and `document-link-http.ts`, with browser isolation/revocation coverage. This is a specific capability grant, not general client access. |
| Public payments | Native `/pay/:grant` and payment-return capability workflows, with `e2e/client-payment.spec.ts`. Provider acceptance remains pending; these grants do not establish household portal membership. |

Portal authentication/household delegation, appointment-bound arrival and versioned consent signing remain explicit future native work. Preserve the narrower public capability boundaries when adding them; possession of a document/payment link must not implicitly grant wider patient access.

## Communications comparison

Read-only comparison: Vet Connect Hub `1dc05ea` and Living Room Vet `430cc8a`. Source inspection is not provider acceptance. Fastmail and Resend remain the approved mail direction. Hub already uses Resend for outbound email; its Gmail synchronization path is not needed in the native product.

| Capability | Native status and source evidence |
|---|---|
| Inbox, assignment, priority, archive and search | Native server-side filtering, pagination, revision checks and staff read boundaries; `src/hub/hooks/use-conversations.ts`, migration `20260913095000_inbox_workspace.sql`. |
| Inbound threading and review | Native Message-ID/References handling with ambiguous sender/thread review; `supabase/functions/_shared/inbound/process.ts`, `features/inbound-review/InboxReviewPage.tsx`. |
| Rich recipient workflows | **Gap:** basic compose exists, but reply-all, CC/BCC and forwarding are not equivalent to Hub `ReplyComposer.tsx`. |
| Conversation attachments | **Gap:** native `ConversationDetailPage.tsx` supplies empty attachment IDs. Reviewed record/invoice delivery exists separately; inbound metadata capture does not establish binary retrieval or timeline viewing. |
| Templates | Native reachable template creation/edit/delete, with RLS error reporting; `src/hub/hooks/use-templates.ts`. |
| Ad hoc send-later | **Gap:** no native composer scheduling/edit/cancel workflow. Reminder scheduling is a separate feature. |
| Due-date reminders | Native appointment, vaccine and lab sources; migration `20260913180000_reminder_outbox.sql` and durable scheduler. |
| Consent and delivery recovery | Native phone-specific consent and durable queue/recovery. Preserve these; do not copy permissive Hub missing-consent or automatic uncertain-resend behavior. |
| Campaigns and follow-up sequences | **Gap:** campaigns route is unavailable; no native equivalent to Hub `trigger-follow-up` and due-step execution. |
| AI assistance | **Incomplete:** optional suggest-replies function exists, but current conversation detail does not mount suggestions. Native triage/voice workflows absent. |
| Notes, history and reactions | Native internal notes and paginated history; cross-thread client-history UI and message reactions remain gaps. |
| Calls, voicemail, surveys and alerts | Routes deliberately unavailable in `src/App.tsx`; copied pages do not establish shipped capabilities. |

Hub's unmerged send-later, attachment-only inbound and phone-lookup fixes are requirements references, not implementations to copy blindly. Native shared-number ambiguity must retain explicit review. Controlled live email reply/attachment, webhook, bounce/complaint and SMS consent/status acceptance remains pending.

Safe conversation attachments are the first communications priority: staff-owned private uploads, explicit recipient/file review, immutable byte hashes bound to the durable send, attachment-only inbound visibility and authorized retrieval. Then add scheduled delivery with reviewable edit/cancel history and final recipient/consent checks.

## Implementation order

1. Finish and package the current local operational-decision phase; stop the former ezyVet integration/report roadmap.
2. Complete this code/workflow matrix, including communications and dependency retirement. Use authorized read-only ezyVet inspection where documentation leaves behavioral questions.
3. Design native prescribing/refill authorization and dispensing against patient, clinical-role, stock and billing records. Preserve explicit human clinical approval; do not represent a request-status change as a prescription.
4. Add native estimates and the missing communication workflows in dependent PRs; expand into the remaining parity inventory without dropping unassessed features.
5. Commission the approved providers and complete the full hosted staff workflow, clinical review, backups/monitoring and public launch checks. Standalone operation removes ezyVet commissioning from that gate, not the other requirements.

Next implementation priorities are an engineering inference from the inspected gaps. This inventory is not yet the final exhaustive feature specification.
