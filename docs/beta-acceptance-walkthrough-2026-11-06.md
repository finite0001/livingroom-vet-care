# Beta acceptance walkthrough — November 6, 2026

Assigned reviewer: **David Edler**, by owner instruction on November 6. Assignment is not acceptance. All decisions remain Pending until the reviewer actually completes the corresponding scenario.

Use the verified staging deployment and Supabase `kothoqicubowyhwfsrte`. Record the exact frontend revision, backend migration prefix, feature flags and date before starting. Production acceptance is a separate run; do not change the register target merely to reuse staging evidence.

## Record the run

1. Make a run-specific copy of [the acceptance register](clinical-staff-acceptance-register.json). Fill in `staffAcceptanceRun.operator`, `dateTime`, `frontendUrl`, `commitOrDeployment` and the actual outbound mode. Keep the register and run project references equal.
2. Use clearly labeled synthetic household/patient/stock examples. Start each scenario with its expected result, then record the actual result and link a sanitized screenshot, recording or receipt. Include negative permission and recovery results.
3. For each completed row, record the actual `reviewer` and `reviewedAt`. Choose Accept, Accept after correction, Reject or Not in pilot scope. Link evidence for acceptance or the explicit reason for exclusion. An automated pass is engineering evidence, not the reviewer’s decision.
4. If a failure requires correction, preserve its evidence and rerun it after the change. Do not convert Accept after correction into Accept until the correction is verified.

Validate the completed copy with:

```bash
node scripts/clinical-staff-acceptance-readiness.mjs --register path/to/completed-register.json --project-ref kothoqicubowyhwfsrte
```

The checker rejects pending/rejected decisions, unverified corrections, missing evidence, missing reviewer/date, omitted rows and project mismatches. This verifies the recorded fields; it cannot authenticate the truth of an external sign-off.

## Clinical review

Use the patient Medical workspace and related inventory/billing surfaces. Begin with two distinct synthetic patients so wrong-patient and cross-household denials can be checked. Detailed source/route links are in the [feature map](beta-readiness-documentation-2026-11-06.md#feature-map-and-beta-exercises).

| Register row | Exercise | Result to inspect |
| --- | --- | --- |
| C-PILOT-01 | SOAP/signing/addenda for housecall visits | Link exact patient/example/revision. |
| C-PILOT-02 | Serious alerts and critical history display | Confirm severity wording and correction path. |
| C-PILOT-03 | Vaccine/treatment administration records | Confirm required fields, correction policy, and source separation. |
| C-PILOT-04 | Preventive due/overdue/unknown/suppressed/completed states | Confirm no unapproved interval is hardcoded. |
| C-PILOT-05 | General vaccine/rabies certificate templates | Confirm exact wording, signature, issued snapshot, and reissue policy. |
| C-PILOT-06 | Record-release selection and client disclosure rules | Confirm what can be sent, to whom, and with which attestation. |
| C-PILOT-07 | Invoice/payment language and client-facing balance/status wording | Confirm refunds, voids, credits, and sandbox-vs-live disclosure. |
| C-PILOT-08 | Reminder wording and delivery-state labels | Confirm wording before provider commissioning, including email appointment reminders (subject + body) and when staff should turn on per-order lab reminders (docs/reminder-dispatch.md). |
| C-VACCINE-01 | Patient vaccine status summary (last given / next due / state per vaccine group) | Confirm source precedence (current reviewed due plan over recorded next due date; proposed plans never supply a date), outside-record labelling, and the due-soon display window (built-in display default 30 days until set in Settings). |
| C-VACCINE-02 | Vaccine catalog metadata, due-date pre-fill, and rabies certificate serial number | Enter or approve per-product group, species, labeled duration and default booster interval (none are seeded); confirm the explicit pre-fill button and the separate rabies serial-number field and its 'not recorded' wording. |
| C-PILOT-09 | HHHHHMM quality-of-life scale assessments, trend and optional reference line | Confirm category wording/source citation, sign/addendum policy, and whether any reference total or wording may be displayed (none is configured by default). |
| C-PILOT-ANES-01 | Anesthesia drugs charged from stock (lot debit + invoice line) and signed-record lock | Confirm required fields and wording, the block-after-signing policy (Treatments + addendum), and correction path. No dose/drug defaults are supplied; Controlled-stock acceptance is tracked separately in C-BETA-NARCOTICS. |
| C-BETA-DENTAL | Dental chart signing, amendment and released snapshots | Confirm tooth/surface findings, prior versions and correction history. |
| C-BETA-DIAGNOSTICS | Manual laboratory, diagnostic PDF and imaging records | Review patient matching, originals, amended findings, private PDF and manual-vs-vendor availability. |
| C-BETA-PRESCRIBING | Prescribing, refills, fulfillment and returns | Review authorizer roles, stock/charge linkage, frozen printed records and reversal history. |
| C-BETA-ASSISTANCE | Dictation, clinical recaps, templates and call assistance | Review source attribution, recording permission, draft acceptance and private-role boundaries; actual device/provider acceptance is separate. |
| C-BETA-NARCOTICS | Controlled-stock, independent review, count, register and recovery | Review synthetic engineering workflows. Physical opening stock, drug classifications and clinic operating procedures must not be inferred. |
| C-BETA-CARE-PLANS | Next-visit planning and clinical handoff into scheduled care | Review plan-to-booking linkage, warnings, completion and correction history. |

For save/sign workflows, check reopening, a second-tab stale edit, and an interrupted response before retrying. Confirm the final state once, with preserved prior versions and no duplicate administration, charge or release.

## Staff and administrator review

| Register row | Walkthrough |
| --- | --- |
| S-PILOT-01 | Staff account invite, password setup, sign-in, recovery, deactivation, and session loss |
| S-PILOT-02 | Household, patient, housecall address, access notes, and cross-household denial |
| S-PILOT-03 | Housecall scheduling through /hub/schedule with warnings and disabled/test reminders |
| S-PILOT-04 | SOAP/care-chart draft, reopen, signing, addendum, stale-save, and navigation guard |
| S-PILOT-05 | Synthetic stock, administration/dispense, invoice line, due-plan/certificate impact, and duplicate prevention |
| S-PILOT-06 | Invoice, sandbox/test payment collection, webhook idempotency, refunds, credits, voids, and issued snapshots |
| S-PILOT-07 | Certificate/document package and disabled/test delivery operations states |
| S-PILOT-08 | CloudTalk/AgentMail/Resend consent, inbound threading, attachments, delivery-state and STOP/resubscribe workflows; distinguish mocked from authorized recipient tests |
| S-BETA-TASKS | Operational task creation, source changes, reconciliation, completion and uncertain-response recovery |
| S-BETA-PLANS | Next-visit plan into scheduled appointment, resources and Denver time-zone handling |
| S-BETA-TIME | Own clock-in/out, administrator concurrent correction/deletion, failed-read handling, totals and export boundaries |
| S-BETA-INTAKE | Public request intake through New inquiries and correct household/patient handoff |
| S-BETA-OPERATIONS | Scheduler results, safe retries, care/invoice reminder suppression, backup/restore and alert ownership |
| S-BETA-DEVICES | Actual staff phone microphone, barcode scanner and private document download |
| S-BETA-RELEASES | Records requests, selected release sources, frozen preview, revoked/expired links and cross-patient denial |

For S-BETA-TIME, use two signed-in browser sessions: one staff session and one administrator session. Correct or delete an open shift while the staff member clocks in/out. Confirm one consistent resulting duty state, a visible stale-edit refusal where appropriate, and an attributed audit record. Never infer payroll-period totals from the Denver dashboard’s rolling time windows.

For S-BETA-OPERATIONS, inspect the scheduler receipt and resulting task/reminder state. A worker HTTP 200 or an empty queue is not proof that eligible work was processed. Verify a source change cancels or blocks obsolete work, and that retry does not duplicate it. Outbound-disabled tests must not claim recipient delivery.

For S-BETA-DEVICES, use the actual staff phone and scanner labels. Desktop browser emulation cannot sign off microphone permission, camera focus, real label readability or download handling.

## Provider and clinic boundaries

Live-provider activation, actual recipient round trips, physical opening stock and clinic operating procedures remain explicit commissioning steps. This walkthrough does not authorize purchases, live payments, client messaging or invented stock. Native manual lab/imaging workflows can be accepted independently of IDEXX/Antech partner access.

The owner confirmed housecalls target **late 2027**. The approved emergency instruction is: “If you can’t reach us, contact your nearest local 24-hour emergency veterinary service.” These values are implemented in the shared practice configuration; they are not an assertion that appointments are open.
