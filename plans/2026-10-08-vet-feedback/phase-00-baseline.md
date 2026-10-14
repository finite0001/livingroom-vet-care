# Phase 0 — Baseline, data review and acceptance

**Status:** Planned. **Priority:** first. **Scope:** all existing rows in [requirements](requirements.md). **Dependencies:** none. This phase prepares implementation; it does not shrink the all-features launch scope.

## Work packages

1. Refresh the implementation branch from current main. Reconcile any new changes against the October 8 baseline before editing. The source repo's original worktree has unrelated files; keep work isolated.
2. Reconcile hosted migrations, function versions, provider modes and scheduler state against current source. The October rollout receipt and shared notes disagree about some later configuration; use fresh evidence. Record project, revision, timestamp and probe result, never secrets.
3. Demonstrate the existing workflows with a synthetic household containing two pets: identity/weights, SOAP/addenda, serious reaction alert, vaccines/certificates, medication fulfillment/stock/billing, dental, QOL, body maps, inbox, record release, appointment reminders and Maps directions. Mark each matrix row demonstrated or needing a named repair.
4. Produce a read-only count/list of existing clients without usable phone/email and patients with invalid linkage. Assign contact cleanup before strict constraints are validated. Preserve every existing chart. Inventory existing supplier products, rooms, clinicians and controlled stock to inform mappings.
5. Obtain supplier export samples, financing-provider selection, VetRocket interface details and anesthesia device/format. Start the Gusto access proof immediately; it can determine the schedule independently of other development.
6. Update clinical/staff acceptance cases for the new requirements. Keep the existing C-PILOT decisions tied to specific revisions and add cases for diagnostics, controlled drugs, voice drafts and imaging. Dr. Edler decides clinical acceptance; Dave decides operational policies.
7. When the VetRec/VetSnap logins arrive, inspect the requested workflows with authorized access. Use Firecrawl for readable public pages; use the authorized browser session for authenticated workflows it cannot access. Capture inputs, state transitions, required fields, corrections, reports and failure behavior using synthetic records. Turn findings into native acceptance cases for the four clinical-assistance workflows and controlled-drug register. Recreate the requested behavior using this app's records and permissions; do not import another product's patient data or proprietary source/assets. Reference-product access informs design and does not authorize changing those accounts.
8. Execute the small feasibility proofs in [shared contracts](implementation-contracts.md): PDF runtime/private artifact recovery, actual iPhone barcode decoding, and supported vendor read/write coverage. Record representative chart/catalog/media sizes and acceptable measured response times before selecting operational limits or committing to a calendar estimate. These proofs prepare implementation; they do not enable live clinical, payment or payroll activity.

## File responsibilities

| Action | Absolute path | Purpose |
|---|---|---|
| Update during implementation | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/docs/clinical-staff-acceptance-register.json` | Evidence references; human decisions only |
| Update | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/docs/clinical-review/forms-and-decisions.md` | New review scenarios |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/docs/launch-evidence/2026-10-feedback-baseline.md` | Dated current-state evidence |
| Read/update after verification | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/docs/go-live-runbook-2026-09.md` | Replace stale state with evidence, preserving historical receipts |

No `docs/development-rules.md`, `codebase-summary.md`, `code-standards.md` or `design-guidelines.md` exists in this reviewed checkout. Use `AGENTS.md`, the README and actual feature conventions. The planning skill's optional session-state scripts are also absent; this directory is the explicit plan location.

## Acceptance and risk controls

- [ ] Each existing feature has a repeatable scenario, result and relevant current revision.
- [ ] Contact cleanup has an identified path; no placeholders or deletion of patient history.
- [ ] Vendor assumptions are labeled and account access is not confused with API permission.
- [ ] Current hosted state is dated separately from inspected source and older receipts.
- [ ] New work uses targeted tests; rollout waits for full CI and the final acceptance phase.

The largest planning risks are vendor access, unavailable anesthesia hardware specifications, historical incomplete contacts and pending clinical decisions. Track these as dependencies, not as evidence that an unrelated feature is missing.
