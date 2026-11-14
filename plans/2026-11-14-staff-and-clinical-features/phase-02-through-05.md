# Later releases

Status: proposed. [Coverage](feature-matrix.md) · [Release controls](integration-and-release.md).
Complete phase 1 first unless Dave changes priorities. Backups begin in phase 0 and continue throughout.

## Phase 2 — team operations and culture
1. Extend `src/hub/features/daily-tasks/` for quick ad-hoc tasks with assignees, due dates,
   completion/undo and history. Reuse action/invalidation patterns; keep automated operational generation intact.
2. Confirm kennel rotation meaning. For staff duties, add recurring rotation, eligibility/availability,
   substitutions and completion history using existing operational tasks. If occupancy/patient care is intended,
   specify patient, kennel and care-record requirements before selecting a model.
3. Add a staff-only board, pins, comments and acknowledgments in a new `src/hub/features/team/` module.
   Keep it separate from client messages, the delivery outbox and medical-record exports.
4. Add employee milestone preferences: opt-in birthday month/day and employment anniversary.
   Offer dismiss/snooze, one occurrence per milestone/year and keyboard-accessible pop-ups; retain private dates separately.
5. Add staff events with organizer, deadline, attendance choices, signup capacities/cancellation/waitlist.
   Reuse one event model for parties and other events.

Integration: add Team pages through `src/App.tsx` and `src/hub/components/layout/nav-items.ts`;
new additive migrations and tests under existing conventions. Keep existing daily-task routes.
Acceptance: retries do not duplicate rotations/pop-ups, absent staff are skipped, concurrent last-seat requests
cannot overbook, canceled RSVPs free capacity and staff chatter cannot trigger client delivery/archive.

## Phase 3 — owner tools
1. Add private effective-dated compensation rates and approved raises/bonuses. Use integer minor currency
   units or database numeric calculations, audited changes and explicit earning codes.
2. Build payroll summaries from locked approved time, eligible paid leave and period-specific rates/adjustments.
   Preview → review → frozen export; record source versions and prevent accidental duplicate exports.
   Begin with the clinic's payroll-provider CSV. API submission is a later decision requiring provider documentation.
3. Add SIMPLE IRA document workflows: approved provider/form versions, employee assignment,
   private upload/completion and reminders. Confirm whether fillable completion or signature integration is needed.
   This feature does not assume a benefits election engine, tax filing or automatic fund transfers.
4. Design anonymous peer reviews separately from named performance records. Store eligibility/one-use
   submission receipts separately from responses; strip author IDs and unnecessary timestamps from results/logs.
   Use aggregated reporting with a clinic-approved minimum response count and delayed release.
   Explain the practical limits of anonymity for a small team; confirm who can access raw responses.
5. Add owner-only management UI in a new `src/hub/features/people-management/` module,
   private storage, additive schema/RPCs and denial tests. Do not infer owner access from the clinical DVM role.

Acceptance: pay changes split correctly at effective boundaries; summaries reconcile to frozen time/leave;
bonus retries and re-exports are traceable; unauthorized API/Storage access is denied; peer-review exports
and ordinary audit logs cannot join a respondent to their response. Form completion and revisions remain auditable.

## Phase 4 — deterministic clinical tools and dental acceptance
1. Have Dr. Edler approve supported species, clinical references, formula versions, input ranges and
   known-answer cases for fluid, shock fluid, chocolate toxicity and gestation calculators.
   Verify current authoritative veterinary sources before coding formulas; none are specified by this plan.
2. Implement pure calculation modules and accessible forms under `src/hub/features/clinical-tools/`.
   Show units, required inputs, reference/version and uncertainty. Patient weight requires units/date confirmation.
   Reject unsupported cases; calculations use deterministic approved logic rather than generated AI arithmetic.
3. Add a Clinical tools destination and optional patient-context launch. Saving to a chart records
   inputs/result/reference/time/reviewer, only through explicit staff action.
4. Validate and extend the existing `src/hub/features/dental/PatientDentalChart.tsx` and `tooth-chart.ts`.
   Walk through species/dentition, tooth findings, save/reopen, signing, addenda, concurrent edits,
   keyboard operation, unsaved changes, timeline and release output; preserve signed-record rules.

Acceptance: approved reference cases pass, invalid/ambiguous units fail, output never crosses patient identity,
and dental round trips preserve exact observations. Dr. Edler accepts each tool before clinical activation.
Tests extend `tests/dental/` and add focused calculator/patient-context cases. Existing dental functionality
stays available while the other tools are gated.

## Phase 5 — clinical AI helpers
1. Extend the architecture of `src/hub/features/clinical/recap/` and the shared clinical processing handlers.
   Add distinct discharge and bloodwork request/result schemas, source selection and review screens;
   do not relabel an existing recap as a completed feature.
2. Discharge drafts use reviewed encounter findings, diagnoses, prescribed medications and instructions.
   Bloodwork explanations use verified patient-linked results, exact units, source ranges and report dates.
   Highlight absent/conflicting sources; cite sources and record generated versus approved content.
3. Keep generation separate from signing, saving and client sending. Explicit staff review creates a
   versioned artifact; sending uses the existing native communications workflow, with its current delivery gates.
   Source changes invalidate pending approval; errors remain recoverable without duplicate chart entries or sends.
4. Pill identification needs a verified catalog/provider, permitted use and supported country/species/formulation.
   Combine imprint/shape/color/photo as available, return evidence-backed candidates or unable-to-identify,
   and require manual verification. A generated visual guess cannot authorize dispensing or dosing.
5. Add model/version records, request limits, cost/error health and a synthetic evaluation set covering
   wrong-patient, missing-source, hallucinated facts, unit errors and prompt injection in source material.
   Use existing providers where suitable; any new Claude API code defaults to `claude-sonnet-4-6`.

Acceptance: no unsourced medication changes; sources are traceable; no automatic send/sign; uncertain pill
cases abstain; clinician review remains mandatory and is recorded. Use synthetic/de-identified evaluation
fixtures, never real patient or employee records in the public repository.

## Remaining decisions
Kennel duty scope; payroll provider/export and SIMPLE IRA forms; peer-review anonymity policy;
milestone visibility; event capacity rules; clinical reference set and pill-reference licensing.
These decisions block only their dependent slices, not initial time/PTO design.
