# Living Room Vet — October 8 feedback implementation plan

**Current status — October13:** #249 is approved, merged and verified on staging/primary183 and production. 4B operational tasks now have a locally implemented184 backend and strict contracts; staff UI, complete hosted acceptance and phases5–8 remain pending. [Current full scope](../2026-10-13-operational-tasks/full-plan-status.md), [backend evidence](../../docs/launch-evidence/2026-10-13-operational-tasks-backend-local.json). All45 original rows and real practice/vendor acceptance remain required. Dave has given standing approval to review and merge all additional PRs for completing this plan; no repeated per-PR permission checkpoint is needed for this goal.

**Baseline:** freshly fetched `origin/main`, `1790f11c1989b3a5daac94757ddbe104299c14b8` (October 5). Review worktree: `/Users/davidedler/Developer/lrv-feedback-plan-20261008`.

## Launch agreement

- All listed required features must be complete before launch. Phases are implementation order, not permission to launch a reduced product.
- Saving a client requires **both phone and email, with no override**. Every patient belongs to an existing client.
- “Whogot” means finding patients who received a selected vaccine, medication or treatment.
- MWI and **Midwest Veterinary Supply** accounts already exist.
- Payment plans mean **third-party financing**, not clinic-managed installment lending.
- “VetSnap” means a **controlled-drug log**, including a second-person approval/witness workflow.
- Barcode scanning is required: use the **iPhone camera** to read a barcode.
- Doctor production percentages apply to **net invoiced revenue after discounts and refunds**.
- Gusto exchange should cover staff information, approved hours and production compensation plus the corresponding payroll data; field-level scope is specified in Phase 7. This software is **only for this practice**, which affects the supported Gusto access route.

## Read this plan

1. [Implementation order](execution-order.md): what to build first, independent work, vendor proofs and completion checkpoints.
2. [Requirements matrix](requirements.md): all 25 October items and all 20 substantive housecall items, with existing implementation evidence and acceptance targets.
3. [Decisions and open questions](decisions.md): resolved policies, proposed defaults and prerequisites.
4. [Vendor findings](integrations.md): verified public capabilities and access limitations.
5. Phase files below: concrete changes, dependencies and tests.
6. [Senior review and shared contracts](implementation-contracts.md): transaction boundaries, retry behavior and mandatory cross-phase checks.

| Phase | Deliverable | Depends on | Status |
|---|---|---|---|
| [0 — Baseline and acceptance](phase-00-baseline.md) | Current hosted evidence, workflow demonstrations and a release checklist | None | Contact/migration baseline checked; clinical/vendor acceptance pending |
| [1 — Client, patient and Whogot](phase-01-patients-whogot.md) | Required contacts, patient photo and cross-patient clinical history search | 0 | 1A merged/deployed/verified; 1B merged/deployed/verified in PR #232; Whogot implemented in [PR #234](https://github.com/finite0001/livingroom-vet-care/pull/234); merged/deployed/verified; practice acceptance pending |
| [2 — Communications and records](phase-02-communications-records.md) | Daily communications, reminders, deceased-patient coverage and records-request queue | 0; 1 for contact enforcement | 2A merged/deployed/verified in PR #235; practice acceptance pending; 2B merged/deployed/verified in PR #236; practice acceptance pending; 2C merged/deployed/verified in PR #237; practice acceptance pending |
| [3 — Diagnostics and PDFs](phase-03-diagnostics-pdfs.md) | Manual observations, comparable trends, stored PDFs and selective sharing | 0; 2 for request linkage | 3A1 merged/deployed; 3B1 in PR #240; renderer/validated PDF/release packages pending |
| [4 — Scheduling and daily work](phase-04-scheduling-tasks.md) | Appointment templates, next-visit prompts and schedule-derived tasks | 0 | Planned |
| [5 — Stock and controlled drugs](phase-05-inventory-controlled-drugs.md) | Supplier imports, iPhone scanning and witnessed drug ledger | 0; vendor samples; 1 for Whogot product mappings | Planned |
| [6 — Payments and production](phase-06-payments-production.md) | External financing, overdue reminders and net-invoiced doctor production | 2; attribution/provider decisions | Affirm installed per owner; reminders/settings merged in PRs260–261; delivery test-only, invoice cron inactive; production planned |
| [7 — Clinical assistance and devices](phase-07-assistance-integrations.md) | Reviewed voice-generated drafts, VetRocket and automatic anesthesia capture; scoped Gusto exchange | 3; 5 for drug events; 6 for production export; vendor access | [Staff-supplied dictation review](../2026-10-16-clinical-dictation-review/plan.md) verified locally/staging; primary release pending; audio/AI and integrations outstanding |
| [8 — Full release acceptance](phase-08-release.md) | Every required row demonstrated, reconciled and accepted on the release revision | All required phases | Planned |

## Findings that drive the design

Most core charting already exists: SOAP, vaccine history/certificates, dental charts, body maps, QOL, prescribing, inventory and billing. Build on these modules and complete clinical acceptance instead of creating parallel records.

The October 8 Daily communications gap is resolved by package 2A: the Deliveries route now combines canonical messages, retained deliveries and reminder jobs. Generated release documents are HTML; existing uploaded PDFs do not satisfy automatic PDF creation for manual diagnostics.

Existing patient-specific reminders already check deceased status. Extend and verify these checks across new automation, without suppressing another living pet's reminders or deleting historical records.

## Working rules

- Preserve the project’s React 18 / React Router 7 / npm architecture, Patient 360 routes, semantic design tokens and shared status components.
- Reuse authenticated staff RPCs, server-stamped `auth.uid()` actors, audited corrections, private files and the durable communication outbox. Staff clinical data is shared by authorized roles; it is not partitioned by which staff member created it.
- Apply the shared contracts before adding features; a drug movement, generated document or external payment must not acquire a second independent source of truth.
- Use additive migrations and preserve history. Do not regenerate Lovable-managed types locally. Permanent stale/conflict errors use the existing non-retryable pattern (`PT409`), not deliberate `40001` retries.
- Verify the dedicated staging and primary project references before future rollout. The retained Lovable database is not the target backend.
- Each implementation change goes through a reviewed PR; Dave merges or explicitly delegates a specific PR merge. Batch 1A was merged and its hosted rollout explicitly authorized. The rollout receipt and reproducible probes are in `/Users/davidedler/Developer/lrv-contact-rollout-20261008` and merged PR #231. Dave confirmed Affirm is installed on October 15; preserve that selection.

## Completion rule

A requirement is done only after its UI, server rules, persistence, meaningful tests and staff acceptance agree. Integrations additionally need a real approved vendor round trip. The planning review inspected repository code and historical evidence; it did **not** record clinical approval. Batch 1A subsequently passed hosted database probes and real owner-session UI checks; its rollout is documented in PR #231. Full-product staff acceptance remains pending.

No launch date is promised before vendor access, anesthesia hardware, financing-provider selection and the remaining business rules are resolved.

Current package 2A: [Daily communications PR #235](https://github.com/finite0001/livingroom-vet-care/pull/235) is merged, deployed and verified on staging and primary; practice acceptance remains pending. [Hosted receipt](../../docs/launch-evidence/2026-10-10-daily-communications-rollout.md). Package 2B [PR #236](https://github.com/finite0001/livingroom-vet-care/pull/236) is approved and merged as `77cf8d52af68a9372a716838e260ec65ea5649c4`, deployed and verified on staging and primary. Both backends have 172 migrations; 105 rollback assertions passed on each, plus 33 genuine staging Auth assertions. Production has no configured clinical intervals or recurring delivery policies. Practice acceptance remains pending. [2B hosted rollout](../../docs/launch-evidence/2026-10-10-care-recurrence-rollout.md). Package 2C records requests and selective sharing is approved and merged in [PR #237](https://github.com/finite0001/livingroom-vet-care/pull/237), merge `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`. Package 2C brought staging and primary to173 migrations with all five affected functions installed and verified frontend/backend pairs; the current inventory is 175 after 3B1 below. Hosted proof passed 52 rollback assertions on each backend and 22 genuine staging Auth/private-file/renderer assertions. No provider messages were sent; practice acceptance and disclosure commissioning remain pending. [2C hosted receipt](../../docs/launch-evidence/2026-10-11-records-requests-rollout.md). Phase 3 has a [concrete package plan](../2026-10-11-diagnostics-pdfs/plan.md) and [local 16-page PDF engine proof](../../docs/launch-evidence/2026-10-11-diagnostics-pdf-engine-proof.md); Package 3A1 manual diagnostics is approved, merged and engineering-verified in [PR #239](https://github.com/finite0001/livingroom-vet-care/pull/239), merge `cd51799bac47e2a4860d727b08bd145563daebaa`. Staging and primary have174 migrations. All exact-head CI passed;39 rollback assertions passed on each backend and40 genuine deployed staging Auth/private-file/Patient360 assertions passed including cleanup. [3A1 hosted receipt](../../docs/launch-evidence/2026-10-11-manual-diagnostics-rollout.md). Generated PDF creation/registration and isolated worker/recovery are engineering-verified; schema14 release integration is approved, merged and rolled out default-off in #245; all45 launch requirements and practice acceptance remain required.

Package 3B1 is approved, merged and deployed in [PR #240](https://github.com/finite0001/livingroom-vet-care/pull/240), merge `14be15205456af9ce98930b4d62b5c4ee3adff09`. Both hosted backends have 175 migrations; 46 rollback checks passed on each and 60 genuine deployed staging checks passed including cleanup. [3B1 hosted receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-jobs-rollout.md). Clinical worker/release/disclosure policies remain empty/off; existing captures remain unvalidated/unuploaded/non-exportable.

Package 3B2A isolated rendering and strict PDF admission is implemented in [PR #241](https://github.com/finite0001/livingroom-vet-care/pull/241), head `b54d4428219526c090cfe0841e8380b88332f44c`; all exact-head CI passed; #241 is approved, merged and production READY. The final native hosted proof rendered 100 findings across 22 pages, verified sandbox/network/non-root/actual-byte admission and whole-VM descendant expiry. All 15 owned trial VMs are stopped with no snapshot; eight obsolete image records were removed. Local checks: 1,320 unit tests, 20 PDF counterexamples, typecheck/lint/build. [3B2A plan](../2026-10-11-diagnostic-pdf-renderer/plan.md) / [renderer evidence](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-renderer.md).

3B2B registration,3C/#243 staff review/download and3A2a/#244 scope review are merged and rolled out default-off.3A2b/#245 numbered diagnostic sharing is approved, merged and rolled out default-off to both179 backends. All 45 requirements and real practice acceptance remain required.

Package 3B2B is implemented in [PR #242](https://github.com/finite0001/livingroom-vet-care/pull/242), head `0af5c25a2561391fbcc53f13d6f01d8a75a329be`; all required exact-head CI passed; #242 approved, merged as `ef12883e2a86c99c80ecaecec9f8facc791bbc73`, and rolled out default-off to both backends. Local verification: 1,336 unit tests, 143 SQL files / 5,834 assertions, and 45 genuine Auth/Storage/native Sandbox checks including four lost acknowledgements, owner handoff, observed locks and populated restore. All 25 new trial VMs were independently verified stopped with no snapshots. Repository179 on #245; hosted baseline178 after approved #244. Worker/release/disclosure policies remain off.

Final #242 verification: all required checks pass at `0af5c25a2561391fbcc53f13d6f01d8a75a329be`; 1,336 unit tests, 520 browser passes/one existing skip, 5,834 SQL assertions and 45 genuine native amd64 registration checks. [CI receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-registration-ci.json). Next: [3C staff review/private download](../2026-10-11-diagnostic-pdf-review/plan.md). #242 merge and hosted rollout are complete; [rollout receipt](../../docs/launch-evidence/2026-10-12-diagnostic-pdf-registration-rollout.md).

Current staff next-visit/#249 status: approved, merged and production/domain verified; repository/staging/primary183. Both passed49 rollback assertions; staging25 Auth/API +19 browser checks. [Hosted receipt](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). [4B detailed design](../2026-10-13-operational-tasks/plan.md) is prepared, not implemented or enabled. 4C daily tasks and Susan acceptance remain open. All45 original requirements retained.
