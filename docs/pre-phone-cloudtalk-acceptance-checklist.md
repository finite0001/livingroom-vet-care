# Pre-phone/CloudTalk clinical and staff acceptance checklist

Date: 2026-09-24  
Scope: acceptance package for the remaining commercial-readiness work that can be completed before public phone-number selection and CloudTalk commissioning.

This checklist does not approve launch by itself. It gives Dr. Susan Edler, the owner/operator, and staff a concise way to record the acceptance decisions that are still required after the local database replay and before the final phone/CloudTalk gates.

## Preconditions

- Hosted backend selected: `mgadheotkdnrsatfivjy`.
- Local database replay evidence exists: [2026-09-24 current-stack DB replay and pgTAP](launch-evidence/2026-09-24-current-stack-db-replay-pgtap.md).
- Generated readiness evidence currently blocks on:
  - hosted apply of `20260924120000` and `20260924130000`;
  - owner public phone/email/emergency content.
- Local disabled/test-mode delivery evidence exists: [2026-09-24 no-live-send local workflow drill](launch-evidence/2026-09-24-no-live-send-local-drill.md).
- Local integrated synthetic clinical/inventory/billing/payment/delivery evidence exists: [2026-09-24 integrated synthetic local workflow proof](launch-evidence/2026-09-24-integrated-synthetic-local-workflow.md).
- Package-readiness evidence exists: [2026-09-24 clinical and staff acceptance package readiness](launch-evidence/2026-09-24-clinical-staff-acceptance-package.md).
- No live email, SMS, voice, voicemail, phone number, or CloudTalk path is required for this checklist.
- Outbound delivery must remain disabled or test-only unless a separate provider commissioning step explicitly approves otherwise.

## Clinical review decisions

Record each row as `Accept`, `Accept after correction`, `Reject`, or `Not in pilot scope`.

| ID | Review area | Reviewer | Decision | Evidence / requested change |
| --- | --- | --- | --- | --- |
| C-PILOT-01 | SOAP/signing/addenda for housecall visits | Dr. Susan Edler | Pending | Link exact patient/example/revision. |
| C-PILOT-02 | Serious alerts and critical history display | Dr. Susan Edler | Pending | Confirm severity wording and correction path. |
| C-PILOT-03 | Vaccine/treatment administration records | Dr. Susan Edler | Pending | Confirm required fields, correction policy, and source separation. |
| C-PILOT-04 | Preventive due/overdue/unknown/suppressed/completed states | Dr. Susan Edler | Pending | Confirm no unapproved interval is hardcoded. |
| C-PILOT-05 | General vaccine/rabies certificate templates | Dr. Susan Edler | Pending | Confirm exact wording, signature, issued snapshot, and reissue policy. |
| C-PILOT-06 | Record-release selection and client disclosure rules | Owner + Dr. Susan Edler | Pending | Confirm what can be sent, to whom, and with which attestation. |
| C-PILOT-07 | Invoice/payment language and client-facing balance/status wording | Owner/operator | Pending | Confirm refunds, voids, credits, and sandbox-vs-live disclosure. |
| C-PILOT-08 | Reminder wording and delivery-state labels | Owner/operator + Dr. Susan Edler | Pending | Confirm wording before provider commissioning. |

Reference the detailed pack when a row needs deeper review: [Dr. Susan Edler clinical acceptance review pack](clinical-review/README.md).

## Staff acceptance run

Record the operator, date, environment, commit, backend project, and known exceptions before starting.

| Field | Value |
| --- | --- |
| Operator | Pending |
| Date/time | Pending |
| Frontend URL | Pending |
| Supabase project | `mgadheotkdnrsatfivjy` |
| Commit/deployment | Pending |
| Outbound mode | Disabled/test-only |
| Known exceptions | Phone number and CloudTalk deferred. |

### Required staff workflow

1. Staff account
   - Invite controlled staff account.
   - Complete password setup.
   - Sign in.
   - Recover password.
   - Deactivate staff and confirm old sessions lose access.

2. Client/patient setup
   - Create household.
   - Create patient.
   - Add housecall address/access notes.
   - Confirm no cross-household patient selection is possible.

3. Schedule housecall
   - Use `/hub/schedule`.
   - Assign active staff clinician.
   - Confirm route timing, busy window, gap, and planned-hours warnings.
   - Confirm `/hub/appointments` redirects to `/hub/schedule`.
   - Confirm reminder rows enqueue only as disabled/test evidence.

4. Visit and clinical record
   - Create SOAP/care-chart draft.
   - Save and reopen draft.
   - Sign record.
   - Add an addendum/correction.
   - Confirm unsigned edits, stale-save, and navigation guard behavior.

5. Preventive/inventory/billing path
   - Receive or select synthetic lot.
   - Attempt expired/insufficient stock and confirm block.
   - Record one approved administration/dispense.
   - Confirm one clinical record, one stock movement, one invoice line, and one due-plan/certificate impact.
   - Retry the action and confirm no duplicate stock or charge.

6. Invoice/payment path
   - Issue invoice.
   - Prepare payment collection in sandbox/test mode.
   - Verify signed webhook replay/idempotency using test evidence.
   - Confirm refunds/credits/voids are attributable and do not silently change issued snapshots.

7. Certificate/document delivery path
   - Issue certificate from frozen metadata.
   - Build selected record/package.
   - Prepare delivery in disabled/test mode.
   - Confirm delivery operations show queued, failed, retryable, canceled, and unknown states.

8. Inbound/provider simulation
   - Verify signed Resend delivery callback handling with synthetic payload.
   - Verify signed Twilio status callback handling with synthetic payload.
   - Verify inbound SMS STOP/START handling with synthetic payload.
   - Confirm no CloudTalk, live phone, live SMS, voice, or voicemail dependency is introduced.

## Acceptance result

| Gate | Decision | Evidence |
| --- | --- | --- |
| Clinical approval for pilot scope | Pending | |
| Staff workflow acceptance | Pending | |
| Acceptance package ready for named reviewers | Prepared; decisions pending | [2026-09-24 clinical and staff acceptance package readiness](launch-evidence/2026-09-24-clinical-staff-acceptance-package.md) |
| No-live-send provider callback drill | Local pre-hosted proof complete; hosted staff drill pending | [2026-09-24 no-live-send local workflow drill](launch-evidence/2026-09-24-no-live-send-local-drill.md) |
| Synthetic preventive/inventory/billing loop | Local pre-hosted proof complete; hosted/staff acceptance pending | [2026-09-24 integrated synthetic local workflow proof](launch-evidence/2026-09-24-integrated-synthetic-local-workflow.md) |
| Hosted migrations `20260924120000` and `20260924130000` applied and refreshed | Pending | |
| Public phone/email/emergency content | Deferred | Final owner/provider gate. |
| CloudTalk/voice/voicemail | Deferred | Final owner/provider gate. |

## Failure handling

- Record every failed step with environment, commit, operator, expected result, actual result, and whether data was written.
- Do not repeat a provider-facing operation after an uncertain result until delivery/payment logs are checked.
- Do not mark a row accepted after a code or template correction until the corrected revision is re-run.
- Do not enable live provider delivery, phone publication, or CloudTalk as a workaround for an acceptance failure.
