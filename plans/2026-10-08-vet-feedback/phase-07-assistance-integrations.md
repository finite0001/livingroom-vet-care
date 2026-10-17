# Phase 7 — Clinical assistance, imaging, anesthesia and Gusto

**Status:** First native staff-supplied transcript/SOAP review slice implemented and verified locally and in staging; [scope and acceptance](../2026-10-16-clinical-dictation-review/plan.md). Primary release awaits its specific PR approval. Audio capture, transcription/generation, recap/call/dental assistance and vendor/device exchange remain outstanding. **Priority:** vendor/access proofs start during Phase 0. **Requirements:** N10, N18, N20; H03, H15–H16. **Dependencies:** reviewed chart/PDF model, provider interfaces and Phase 6 approved production output. [Vendor evidence](integrations.md).

These are separate deliverables and should be separate PR sequences. One working connector does not complete the others.

## 7A — Native VetRec-style assistance

1. Add encounter-bound microphone recording/upload → transcription → draft SOAP. Store source metadata and processing state; distinguish dictation from an ambient multi-person visit. Confirm patient/encounter before processing and insertion.
2. Make generated content reviewable beside its transcript/source. Preserve uncertain passages and missing facts as review needs; do not fill unspoken examination findings. Vet edits/accepts/rejects the draft before the existing chart signing process.
3. Add records recap using authorized selected documents, with each factual summary linked to source document/page/date where available. Separate historical information from current findings and handle contradictory sources without resolving them silently.
4. Reuse CloudTalk call records/transcripts/summaries and the existing phone strategy. Converting a summary into a clinical note is a distinct reviewed action. Current call media is ADMIN-only; any extension to clinicians needs explicit role rules and server checks, not a front-end bypass.
5. Add dental dictation that proposes structured tooth observations/procedures for the existing chart. Require tooth/species/dentition confirmation, and distinguish planned from performed procedures. Never automatically mark teeth normal/extracted.
6. Select transcription/model providers using the chosen workflow, retention, access and cost requirements. If calling Claude, the project default is `claude-sonnet-4-6`. External keys stay server-side. Confirm recording/retention policy with the practice before use; delete source audio according to that policy without deleting signed chart history.
7. Track generated drafts by patient/encounter, source snapshot, job and generation version. Treat transcript/document content as clinical source data, never as instructions to access another record or execute actions. Acceptance inserts an audited draft once; retrying a generation must not overwrite an already accepted/signed note. Define size/duration/cost limits and abandoned-job recovery in the provider proof.

**Acceptance:** noisy/multi-pet recordings remain tied to the correct patient; draft never auto-signs or changes signed history; recap cites actual sources; rejected output makes no chart change; existing call permissions hold; dental ambiguity requires review; failed/retried jobs do not duplicate drafts. Complete all four requested workflows, not SOAP alone.

## 7B — VetRocket X-ray integration

**October16 progress:** public official-source/demo investigation and native manually linked imaging register are underway in the [VetRocket implementation plan](../20261016-vetrocket-imaging/plan.md). Automatic study/report exchange remains open pending practice account/interface evidence.

1. Confirm the actual RocketPACS product/account and obtain authorized interface details. Prove patient/study identity mapping before broader automation.
2. Add patient/encounter imaging studies with accession/vendor study ID, modality, date, viewer link, report and status. A reviewed manual link is an intermediate workflow; do not call it an automatic result feed.
3. Implement the agreed supported study/report exchange. Where the vendor offers it and the practice requires it, add order/worklist creation and result notification through a separate tested adapter. Do not assume public DICOMweb/HL7/SSO/webhook support from product marketing.
4. Keep diagnostic images in the diagnostic viewer; attach the report PDF to the patient and selected release. Shared links respect the vendor's authorization/expiration and disclose only the intended study.

**Acceptance:** real test study opens from the right patient; report is attached to the same study; a mismatched/unknown patient is held for review; repeated notifications do not duplicate studies; unavailable/expired access is handled clearly. Automatic versus link-based launch scope must be explicitly settled with the practice and vendor.

## 7C — Automatic anesthesia record integration

1. Identify monitor/software/model and an actual export/feed. Define patient/encounter IDs, time units/timezone, measurement units, sampling representation, medications/events and correction semantics from its documentation.
2. Build an ingestion adapter into a review queue with raw-source preservation and stable source event IDs. Parse into existing anesthesia charts; unmatched identity, timestamp/unit ambiguity or invalid values require review.
3. Import automatically when the supported feed/export arrives; human approval moves the reviewed record into the clinical chart. Prevent a duplicate drug event from independently decrementing inventory or billing again; link existing administration IDs and controlled-register events from Phase 5.
4. Preserve manual anesthesia entry during outages and show gaps/source type honestly. Replaying an export or reconnecting after a gap must not double-record observations or overwrite signed records.

**Acceptance:** actual representative device/export produces a correctly matched chart automatically; retry deduplication, disconnected recovery, clock/unit checks and signed-record protection pass. Manual-only charting does not complete H16.

## 7D — Gusto for this practice only

**Confirmed intent:** comprehensive exchange, internal use only. Gusto's partner REST path currently excludes direct own-company integrations. Start an access proof using a supported Gusto internal route (currently its official CLI/MCP offerings), or obtain another route explicitly approved by Gusto. Do not design an unattended embedded REST connector on the assumption a payroll account grants access.

Proposed source-of-truth map, to validate field by field against the supported route:

| Data | Direction / authority | Write rule |
|---|---|---|
| Employee identity, active status, job/payroll identifiers, pay configuration | Gusto → app; Gusto owns employment/payroll facts | Review staff mapping; never auto-grant app roles from imported employees |
| Approved shifts/hours and classifications | App → Gusto; app owns recorded time, Gusto payroll remains authoritative | Approved entries only; explicit employee/job/period mapping; reversible draft submission |
| Approved doctor production/bonus amounts | App → Gusto draft payroll input | Closed, accepted Phase 6 report; stable period/adjustment IDs; prevent duplicate earnings |
| PTO balances/policies and approved absence status | Gusto → app where supported | Read-only payroll authority; employee-request workflow is not assumed |
| Payroll processing status, posted amounts and employer costs | Gusto → app where supported | Reconcile by employee/pay period and flag discrepancies |

- Keep final payroll approval/submission in Gusto. “All of it” is interpreted as the above staff/time/compensation/payroll exchange, not permission to execute payroll or rewrite employment records automatically.
- First prove OAuth/authorization, allowed objects, read/write operations, refresh/revocation and audit. If supported CLI/MCP access is interactive/admin-assisted, present that honestly; don't label it automatic bidirectional synchronization.
- Model outbound batches with preview, approval, idempotency and returned result/status; incoming sync with cursors/deduplication and conflict review. Corrected or already-paid periods require adjustment handling, not repeated submission.
- A timed-out payroll-input write remains uncertain until reconciled using the provider's supported lookup/result evidence. Do not blindly repeat it. The access proof must demonstrate duplicate prevention and draft reconciliation, not just a successful request.
- Existing CSV export is useful for development/fallback; **it does not satisfy the requested full two-way integration**. If no supported route covers the required field map, record a launch dependency and return the specific limitation for a scope decision.
- Payroll data and tokens require narrower admin access than ordinary patient care. Keep provider credentials and payroll exports out of public frontend configuration.

**Acceptance:** stable staff mapping; approved hours and production input return identifiable draft results; payroll/PTO/status data return correctly for supported fields; revoked access fails safely; duplicate submission and corrected-period cases do not double-pay. Owner reviews the resulting Gusto draft before any final payroll action.

## File responsibilities

| Action | Absolute path | Purpose |
|---|---|---|
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/clinical/ClinicalWorkspace.tsx` | Reviewed draft insertion |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/dental/PatientDentalChart.tsx` | Reviewed tooth-level suggestions |
| Reuse/extend by reviewed role policy | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/cloudtalk/CallMediaControls.tsx` | Authorized call source material |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/anesthesia/PatientAnesthesiaRecords.tsx` | Source/import review and chart status |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/components/timesheet/AllStaffTimesheet.tsx` | Approved Gusto batch preparation |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/clinical-assistance/` | Recording/jobs/review/recap UI |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/imaging/` | Patient study/report UI |
| Create after access proof | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/services/integrations/` | Provider-specific jobs/adapters; hosting chosen from actual supported contracts |
| Create per independent package | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_<integration_domain>.sql` | Job receipts, identity mappings, review/audit and scoped RPCs |

Do not bundle unrelated connector schema or credentials in one giant migration. Reuse source snapshots, staff authorization, private documents and existing audit/correction conventions.
