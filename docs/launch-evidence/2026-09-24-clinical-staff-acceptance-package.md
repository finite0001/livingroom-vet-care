# Clinical and staff acceptance package readiness

Date: 2026-09-24  
Scope: commercial-readiness Stage 5 package for named clinical and staff reviewers before public phone-number selection and CloudTalk commissioning  
Environment target: hosted Supabase project `mgadheotkdnrsatfivjy`, after the two pending readiness migrations are applied and refreshed

## Summary

The pre-phone/CloudTalk clinical and staff acceptance package is prepared for named reviewers, but no reviewer decision has been recorded.

The package gives Dr. Susan Edler, the owner/operator, and staff a concise way to record clinical review, operator acceptance, known exceptions, and deferred launch gates. It does not approve public launch, provider commissioning, live messaging, CloudTalk, or emergency-contact wording.

## Reviewer entry points

- [Pre-phone/CloudTalk clinical and staff acceptance checklist](../pre-phone-cloudtalk-acceptance-checklist.md)
- [Dr. Susan Edler clinical acceptance review pack](../clinical-review/README.md)
- [Clinical forms and decisions](../clinical-review/forms-and-decisions.md)
- [Standalone clinical review examples](../clinical-review/review-examples.html)
- [Certificate example](../clinical-review/certificate-example.html)
- [Invoice example](../clinical-review/invoice-example.html)

## Evidence to attach during review

- [2026-09-24 current-stack DB replay and pgTAP](2026-09-24-current-stack-db-replay-pgtap.md)
- [2026-09-24 no-live-send local workflow drill](2026-09-24-no-live-send-local-drill.md)
- [2026-09-24 integrated synthetic local workflow proof](2026-09-24-integrated-synthetic-local-workflow.md)
- [2026-09-24 hosted readiness inventory](2026-09-24-hosted-readiness-inventory.json)
- [2026-09-24 commercial readiness summary](2026-09-24-commercial-readiness-summary.json)

## Review decisions still required

Clinical reviewer decisions:

- SOAP/signing/addenda for housecall visits.
- Serious alerts and critical history display.
- Vaccine/treatment administration records.
- Preventive due/overdue/unknown/suppressed/completed states.
- Vaccine/rabies certificate templates.
- Record-release selection and client disclosure rules.
- Invoice/payment language and client-facing balance/status wording.
- Reminder wording and delivery-state labels.

Staff/operator acceptance:

- Staff invite, password recovery, sign-in, deactivation, and session loss.
- Household/patient creation.
- Housecall scheduling through `/hub/schedule`.
- Visit charting, signing, addenda/corrections, stale-save behavior, and navigation guards.
- Synthetic inventory, invoice, payment, certificate, selected-record package, and delivery workflow.
- Delivery failure/retry/cancel/unknown inspection.
- Provider callback simulation in disabled/test mode.

## Current status

Prepared:

- Local database replay and focused pgTAP proof.
- Local disabled/test-mode delivery/callback proof.
- Local integrated synthetic clinical/inventory/billing/payment/certificate/delivery proof.
- Clinical/staff acceptance checklist with explicit pending rows.
- Detailed clinical review pack and examples.

Still pending:

- Hosted apply of `20260924120000_canonical_housecall_appointment_contract.sql`.
- Hosted apply of `20260924130000_inbound_sms_service_rpc_security.sql`.
- Readiness refresh after hosted apply.
- Named clinical approval decisions.
- Named staff/operator acceptance run.
- Owner-approved public phone, email, and emergency content.
- CloudTalk, voice, voicemail, and live phone-number commissioning.

## Guardrails for reviewers

- Record `Accept`, `Accept after correction`, `Reject`, or `Not in pilot scope` for each clinical row.
- Treat `Accept after correction` as pending until the corrected revision is rerun.
- Record operator, date/time, frontend URL, Supabase project, commit/deployment, outbound mode, and known exceptions before staff acceptance.
- Keep outbound delivery disabled or test-only unless a separate provider commissioning step explicitly approves live use.
- Do not publish guessed public contact content.
- Do not use CloudTalk, live phone, voice, voicemail, or live SMS as a workaround for acceptance gaps.
