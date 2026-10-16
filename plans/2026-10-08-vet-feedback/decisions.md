# Decisions and questions

## Confirmed by Dave on October 8, 2026

| Decision | Result |
|---|---|
| Launch scope | All listed required features before launch |
| Client contacts | Both phone and email mandatory; no override |
| Whogot | Find patients that received a particular vaccine, medication or treatment |
| Supplier identity | Midwest Veterinary Supply; both Midwest and MWI purchasing accounts exist |
| Payment plans | External financing such as CareCredit/Scratchpay |
| VetSnap scope | Controlled-drug log |
| Barcode | Required; iPhone camera reads the barcode |
| Production basis | Net invoiced revenue after discounts and refunds |
| Gusto scope | “All of it” in response to staff details, approved hours and production bonuses; comprehensive exchange mapped in Phase 7 |
| Intended users | Only The Living Room Vet; not a product offered to other practices |
| VetSnap / VetRec access | Dave will obtain logins for workflow research; access is forthcoming, not yet provided |
| Website workflow research | Dave authorized Firecrawl research to understand features for the native app |
| Financing selection | Revised one-page comparison emailed to Susan at Dave's request; awaiting her preferred provider. No provider selected, enrolled or enabled by this task. [Comparison PDF](../../output/pdf/living-room-vet-stripe-financing.pdf) |
| Current authorization | Planning finished; Dave subsequently resumed work. First implementation batch addresses confirmed client-contact and patient-creation rules in an isolated branch, with review before rollout |

## Proposed implementation defaults

These are planning recommendations, not additional answers from Dave.

- **Whogot:** one result per clinical event, with patient, client, event date, product/service, lot where applicable, clinician and source. Distinguish administered, dispensed, historical and corrected/voided events. A billed item alone does not establish performed treatment. Add explicit performed-service records where needed. Search and export do not automatically message anyone.
- **Contact enforcement:** validate format on both UI and server. Do not equate having contact information with SMS/email consent. Review existing incomplete clients; never fabricate contact details or delete their clinical histories to pass a constraint.
- **Deceased patients:** stop routine patient-specific care/birthday automation, including pending eligible work. Keep living household members eligible. Handle outstanding billing and staff-directed communications separately, with sensitivity holds available; death does not erase debt or the chart. Do not attempt to recall a message already accepted by a provider.
- **Records requests:** one visible queue for incoming outside-record requests and outgoing record-release requests, with direction, patient(s), requesting/receiving party, scope, status, owner and due date. They share a queue, not the same disclosure permissions.
- **Clinical AI:** suggest drafts with source links; staff review and the existing signature workflow remain authoritative. Never infer an examination, normal result, drug administration or tooth procedure that was not recorded.
- **Supplier imports:** preview, map and approve using supplier+SKU keys and explicit package/unit conversions. Catalog import never creates received stock without a receipt event.
- **Finance:** financing approval/application is separate from settlement. Record a payment only against verifiable settlement evidence. Percent changes must not silently rewrite closed doctor-production periods.

## Questions still affecting implementation

| Question | Why it matters | Timing |
|---|---|---|
| Can the supported Gusto internal-access route cover the field map in Phase 7, including return data? | Internal-only custom partner REST access is not currently supported; a CSV handoff alone does not fulfill the requested two-way exchange | Prove before promising Gusto completion |
| Should records go to clients only, or also authorized third parties such as another clinic? | Existing client-only destination checks cannot be bypassed by a new queue field | Confirmed: client contacts and authorized third parties; named verified email, recorded client authority, exact manifest scope, expiry and revocation |
| Which financing provider(s) will the practice use, and is the practice eligible/enrolled? | Susan has the revised comparison. Stripe support does not establish approval for this practice; selection determines payment flow and reconciliation | Susan's choice pending; verify terms/access before Phase 6 connector |
| Which anesthesia monitor/software will generate the records, and what export/interface is available? | No universal device feed can be promised without manufacturer/model and format | Before Phase 7 connector |
| Is the VetRocket account installed/contracted, and which integration access does it include? | Viewer links and server/API/DICOM access have different setup requirements | Before Phase 7 connector |
| Which approved supplier catalog/export samples can each purchasing account provide? | Confirms SKU, package, price and update semantics | Before Phase 5 import mapping |
| Which controlled-drug entries need an independent witness, and who can witness? | Defines receipt/admin/dispense/waste/reconciliation transitions | Dr. Edler review before Phase 5 activation |
| Which appointment types, default lengths, species restrictions, rooms and cleaning/restocking templates should be configured? | Configuration comes from practice workflow, not guessed clinical defaults | During Phase 4 acceptance |
| Which services earn production, how are shared cases split, and what happens to refunds after a period closes? | Percentages alone do not define a compensation policy | Before Phase 6 activation |

Vendor samples and business choices block their dependent implementation, not preparation of the remaining phases. No vendor has been contacted and no account changed in this task.

## Decision ownership and closure

- **Susan:** financing preference, clinical workflow acceptance, appointment/reminder templates, controlled-drug witness rules and device/PACS details with the relevant vendor.
- **Dave:** supply the forthcoming reference-product access, coordinate supplier/Gusto access, decide record-sharing scope and compensation policy, and approve each implementation PR for merge.
- **Implementation team:** produce the access proofs, proposed mappings, worked production examples and acceptance evidence. Do not turn proposed defaults into confirmed practice policy silently.
- Store access credentials through the authorized credential workflow, not in this public repository, screenshots, research notes or test fixtures. Receiving a website login does not by itself establish API access.
- Record each answer here with its date and update the affected phase before its dependent work begins. Unanswered questions do not make the plan incomplete; they keep the affected implementation or activation gate open.

## October 15 owner update

- Affirm is already set up and installed; financing provider selection is resolved by Dave. Do not re-open vendor choice or enrollment implicitly. This records owner confirmation, not a new live transaction test.
- Unpaid invoices: due on receipt, email reminders at 7, 14 and 30 days overdue, with editable settings and pause/dispute/bereavement controls.
- Sequence: finish unpaid reminders, then use reverse-engineer-anything for authorized VetRec and VetRocket workflow analysis and native feature recreation.
