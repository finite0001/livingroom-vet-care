# Implementation order and completion checkpoints

**Planning complete; batch 1A merged in [PR #230](https://github.com/finite0001/livingroom-vet-care/pull/230), deployed and verified on both hosted backends/frontends.** [Rollout evidence: merged PR #231](https://github.com/finite0001/livingroom-vet-care/pull/231). Full-product staff acceptance remains pending. This is the execution sequence for the [45-item requirements matrix](requirements.md). Every requirement remains required before launch. Batches organize construction and review; none is a reduced-scope launch. The first batch covers required contacts and linked creation; Patient photo implementation is in [PR #232](https://github.com/finite0001/livingroom-vet-care/pull/232), merged and deployed to staging/primary, with engineering verification passed and practice acceptance pending. Whogot is implemented and locally verified in [PR #234](https://github.com/finite0001/livingroom-vet-care/pull/234); PR #234 is merged, deployed and verified on both hosted backends/frontends; practice acceptance remains pending. [Whogot rollout evidence](../../docs/launch-evidence/2026-10-10-whogot-rollout.md). Package 2A Daily communications is implemented in [PR #235](https://github.com/finite0001/livingroom-vet-care/pull/235), merged, deployed and verified on both hosted backends/frontends; practice acceptance remains pending. [Daily communications rollout](../../docs/launch-evidence/2026-10-10-daily-communications-rollout.md). Package 2B [PR #236](https://github.com/finite0001/livingroom-vet-care/pull/236) is approved and merged as `77cf8d52af68a9372a716838e260ec65ea5649c4`, deployed and verified on staging and primary. Both backends have 172 migrations; 105 rollback assertions passed on each, plus 33 genuine staging Auth assertions. Production has no configured clinical intervals or recurring delivery policies. Practice acceptance remains pending. [2B hosted rollout](../../docs/launch-evidence/2026-10-10-care-recurrence-rollout.md). Package 2C records requests and selective sharing is approved and merged in [PR #237](https://github.com/finite0001/livingroom-vet-care/pull/237), merge `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`. Package 2C brought staging and primary to173 migrations with all five affected functions installed and verified frontend/backend pairs; the current inventory is 175 after 3B1 below. Hosted proof passed 52 rollback assertions on each backend and 22 genuine staging Auth/private-file/renderer assertions. No provider messages were sent; practice acceptance and disclosure commissioning remain pending. [2C hosted receipt](../../docs/launch-evidence/2026-10-11-records-requests-rollout.md). Phase 3 has a [concrete package plan](../2026-10-11-diagnostics-pdfs/plan.md) and [local 16-page PDF engine proof](../../docs/launch-evidence/2026-10-11-diagnostics-pdf-engine-proof.md); Package 3A1 manual diagnostics is approved, merged and engineering-verified in [PR #239](https://github.com/finite0001/livingroom-vet-care/pull/239), merge `cd51799bac47e2a4860d727b08bd145563daebaa`. Staging and primary have174 migrations. All exact-head CI passed;39 rollback assertions passed on each backend and40 genuine deployed staging Auth/private-file/Patient360 assertions passed including cleanup. [3A1 hosted receipt](../../docs/launch-evidence/2026-10-11-manual-diagnostics-rollout.md). Generated PDF creation/registration and isolated worker/recovery are engineering-verified; schema14 release integration is approved, merged and rolled out default-off in #245; all45 launch requirements and practice acceptance remain required.

## Begin with two kinds of work

1. **Establish a trustworthy baseline:** refresh main, inspect current hosted state, demonstrate existing features with synthetic data, and identify incomplete client contacts. See [Phase 0](phase-00-baseline.md).
2. **Start vendor proofs immediately:** supplier samples, Gusto access, anesthesia interface and VetRocket access. Incorporate the forthcoming VetRec/VetSnap workflow review and Susan's financing choice as they arrive. Do not wait until the last engineering batch to discover an unavailable interface.

## Build and review in this order

Each row represents a bounded PR sequence, not one large PR. Split database contracts, workers and UI when needed, keeping each intermediate revision compatible. The phase files specify affected paths and acceptance cases.

Apply the [shared transaction and retry contracts](implementation-contracts.md) before implementation. Resolve source paths against the isolated implementation checkout; paths in phase files identify the reviewed baseline, not an instruction to edit an unrelated working branch.

| Batch | Deliverable | Prerequisite | Evidence needed to close |
|---|---|---|---|
| 1 | Required client phone/email; existing-client patient creation; multiple-pet verification; optional pet photo | Baseline and contact cleanup approach | UI and server reject incomplete clients/orphans; two pets retain distinct histories; photo access is private |
| 2 | Performed-service capture and Whogot search | Stable patient/product identities; existing treatment/dispense sources | Search returns actual administration, dispensing and performance; prescription/billing alone does not count |
| 3 | Daily communications and configurable care reminders | Canonical outbox; client/contact rules | Current and historical sends appear accurately; recurrence/override/death-after-enqueue cases pass |
| 4 | Records-request queue and selective record packages | Existing release contract; recipient-scope decision for third-party sharing | Incoming/outgoing requests link evidence; complete charts are packaged without truncation; exact recipient/scope enforced |
| 5 | In-house diagnostics, trend graphs and stored PDFs | Existing lab model; early renderer feasibility proof | Compatible results graph; reviewed result versions produce actual readable PDFs and exact email attachments |
| 6 | Appointment types, next-visit prompt and cleaning/restocking tasks | Reviewed practice templates and room mapping | Length/species/resource rules work; reschedule/cancel/retry does not duplicate tasks or bookings |
| 7 | MWI/Midwest SKU import and iPhone camera scanning | Representative files/approved interface and real labels | Both vendors import through preview; units reviewed; camera works on a real iPhone; no automatic stock from catalog import |
| 8 | Controlled-drug ledger, witnesses and reconciliation | Existing inventory event identity; Susan's witness/container/location rules | Two identities witness immutable events; counts, waste, mobile transfer and corrections reconcile to stock |
| 9 | Invoice terms and unpaid-balance reminders | Communications outbox | Final-send balance check suppresses stale reminders; partial payments and holds remain accurate |
| 10 | Doctor attribution, production rates and reports | Eligible-service, split and closed-period policies | Net invoiced revenue reconciles; discounts/refunds counted once; historical percentages remain reproducible |
| 11 | Chosen financing provider | Susan's selection, merchant eligibility and actual interface | Verified payment evidence updates invoice once; failed/abandoned applications do not; refunds reconcile |
| 12 | SOAP dictation, record recap, call-summary notes and dental dictation | Reviewed workflow references; transcript/model and access contracts | All four workflows produce reviewed drafts linked to the correct sources; no automatic clinical signing |
| 13 | VetRocket study/report connection and anesthesia ingestion | Actual vendor/device interfaces; diagnostics model; drug-event linkage | Real representative study and device feed match the right encounter; retries do not duplicate chart/drug/stock entries |
| 14 | Supported two-way Gusto exchange | Early access proof, staff mapping and accepted production output | Approved hours/production reach identifiable draft payroll inputs; agreed return data reconcile; no duplicate earnings |
| 15 | Full acceptance and release rehearsal | Every required matrix row implemented or existing behavior verified | One complete multi-pet workflow, current engineering checks, clinical decisions and vendor round trips recorded on the release revision |

Batches 6 and 7 can proceed independently of diagnostics once their prerequisites are ready. Invoice reminders can proceed before financing selection. Clinical-assistance and vendor-interface research can proceed while native workflows are built. Gusto production export waits for accepted production calculations, even if staff/time access has already been proven.

## Vendor proofs that can change the schedule

| Dependency | Minimum evidence before building the final connector | If unavailable |
|---|---|---|
| MWI and Midwest | Actual supported catalog/price sample or approved interface from each existing account | Keep mapping/import work staged; do not claim a public API or catalog access from account ownership |
| Financing | Susan's preference plus approved veterinary eligibility, fees, supported checkout/link and payment/refund evidence | Continue unpaid-invoice reminders and production reports; leave financing acceptance open |
| VetRocket | Actual account/product, interface contract and representative patient/study/report identifiers | Keep imaging UI and identity contract preparatory; a manual link is not proof of an automatic feed |
| Anesthesia | Manufacturer/model/software, sample feed/export, identifier/unit/time definitions and automatic arrival mechanism | Keep current manual records available; H16 remains incomplete |
| Gusto | An explicitly supported internal route covering each agreed staff/time/compensation/payroll operation | Identify missing operations for Dave; CSV alone does not complete requested two-way exchange |
| VetRec and VetSnap references | Authorized workflow access or sufficiently detailed published behavior, reviewed with Susan | Use available documentation for preparation; resolve ambiguous workflow behavior before clinical acceptance |

## Delivery responsibilities

- **Engineering:** implementation, migrations, meaningful tests, staged demonstrations, recovery paths and acceptance evidence.
- **Susan:** clinical templates and workflow decisions; financing preference; controlled-drug and clinical acceptance.
- **Dave:** access coordination, business/compensation decisions, review and explicit merge of each PR.
- **Vendor:** supported interface/access terms and representative integration evidence where required.

For every batch, link its requirement IDs, changed revision, test results, demonstration and unresolved issues. An existing screen, successful compile or mocked provider response alone does not close clinical or integration acceptance. [Phase 8](phase-08-release.md) defines the final rehearsal and rollout order.

## Remaining inputs

- Susan's financing selection; the comparison has already been emailed.
- Forthcoming VetRec/VetSnap access, supplier samples, VetRocket account/interface details and anesthesia manufacturer/model/software.
- Supported Gusto access and exact field coverage, proven before committing to completion.
- appointment/reminder/task templates; witness rules; production eligibility/splits/late-refund policy.

These are decision and access dependencies, not reasons to invent a launch date. Set a calendar estimate after the baseline repairs and vendor proofs are known.

Package 3B1 is approved, merged and deployed in [PR #240](https://github.com/finite0001/livingroom-vet-care/pull/240), merge `14be15205456af9ce98930b4d62b5c4ee3adff09`. Both hosted backends have 175 migrations; 46 rollback checks passed on each and 60 genuine deployed staging checks passed including cleanup. [3B1 hosted receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-jobs-rollout.md). Clinical worker/release/disclosure policies remain empty/off; existing captures remain unvalidated/unuploaded/non-exportable.

Package 3B2A isolated rendering and strict PDF admission is implemented in [PR #241](https://github.com/finite0001/livingroom-vet-care/pull/241), head `b54d4428219526c090cfe0841e8380b88332f44c`; all exact-head CI passed; #241 is approved, merged and production READY. The final native hosted proof rendered 100 findings across 22 pages, verified sandbox/network/non-root/actual-byte admission and whole-VM descendant expiry. All 15 owned trial VMs are stopped with no snapshot; eight obsolete image records were removed. Local checks: 1,320 unit tests, 20 PDF counterexamples, typecheck/lint/build. [3B2A plan](../2026-10-11-diagnostic-pdf-renderer/plan.md) / [renderer evidence](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-renderer.md).

3B2B registration,3C/#243 staff review/download and3A2a/#244 scope review are merged and rolled out default-off.3A2b/#245 numbered diagnostic sharing is approved, merged and rolled out default-off to both179 backends. All 45 requirements and real practice acceptance remain required.

Package 3B2B is implemented in [PR #242](https://github.com/finite0001/livingroom-vet-care/pull/242), head `0af5c25a2561391fbcc53f13d6f01d8a75a329be`; all required exact-head CI passed; #242 approved, merged as `ef12883e2a86c99c80ecaecec9f8facc791bbc73`, and rolled out default-off to both backends. Local verification: 1,336 unit tests, 143 SQL files / 5,834 assertions, and 45 genuine Auth/Storage/native Sandbox checks including four lost acknowledgements, owner handoff, observed locks and populated restore. All 25 new trial VMs were independently verified stopped with no snapshots. Repository179 on #245; hosted baseline178 after approved #244. Worker/release/disclosure policies remain off.

Final #242 verification: all required checks pass at `0af5c25a2561391fbcc53f13d6f01d8a75a329be`; 1,336 unit tests, 520 browser passes/one existing skip, 5,834 SQL assertions and 45 genuine native amd64 registration checks. [CI receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-registration-ci.json). Next: [3C staff review/private download](../2026-10-11-diagnostic-pdf-review/plan.md). #242 merge and hosted rollout are complete; [rollout receipt](../../docs/launch-evidence/2026-10-12-diagnostic-pdf-registration-rollout.md).

Current staff next-visit/#249 status: approved, merged and production/domain verified; repository/staging/primary183. Both passed49 rollback assertions; staging25 Auth/API +19 browser checks. [Hosted receipt](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). [4B detailed design](../2026-10-13-operational-tasks/plan.md) is prepared, not implemented or enabled. 4C daily tasks and Susan acceptance remain open. All45 original requirements retained.
