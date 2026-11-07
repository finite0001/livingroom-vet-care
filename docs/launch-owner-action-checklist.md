# Owner action checklist for beta and public launch

Reconciled November 6, 2026 against the repository. This checklist records decisions and evidence still needed; it does not declare live services unavailable solely because an older document said so. Engineering results belong in the [beta audit](beta-readiness-documentation-2026-11-06.md), and release steps in the [deployment runbook](deployment-runbook.md).

## Before project closeout: Antech follow-up

- [ ] Check whether Jennifer Woodmansee at Antech has supplied integration documentation, NDA/onboarding information and authorized test access requested through Susan's October 26 introduction. If not, Dave should follow up and record the response or next action. Owner confirmation on October 27 was that access was not available; current vendor status needs verification.

The request covers reference-lab ordering/results and imaging, with possible EKG submissions for radiology/cardiology review. See [Antech commissioning](antech-commissioning.md). Native manual diagnostic workflows can be tested independently; vendor selection and a prepared plan do not establish an automatic connection.

## Practice decisions

- [ ] Confirm the beta scope and whether it uses synthetic staging records or approved real practice workflows.
- [x] Owner confirmed housecalls target **Late 2027** on November 6; implemented in source. Both stages remain planned. Publish with the reviewed candidate; do not infer opening from the date.
- [x] Owner approved: “If you can’t reach us, contact your nearest local 24-hour emergency veterinary service.” Implemented as shared `emergencyInstructions`; a named hospital phone is not required for this approved guidance. Publish with the reviewed candidate.
- [ ] Record David Edler’s clinical and staff beta review decisions and rehearsal results in [the acceptance register](clinical-staff-acceptance-register.json). The expanded current register contains 18 clinical and 15 staff rows, all Pending. Use the [current walkthrough](beta-acceptance-walkthrough-2026-11-06.md); reviewer assignment is not sign-off.
- [ ] Approve any selected clinical note/audio/call processing policies, templates, recording/retention terms and actual device workflows before enabling processing. Captured audio or a generated draft does not constitute clinical sign-off.
- [ ] For narcotics operation, supply approved staff assignments, drug classifications, independent physical opening counts and clinic procedures. Do not use synthetic acceptance quantities as opening stock.

## Release evidence

- [ ] Recheck staging/production ledgers, deployed Edge source, frontend SHA/backend, scheduler receipts and configuration presence against the exact candidate. The [November 6 hosted metadata](evidence/beta-hosted-metadata-2026-11-06.json) shows production at 209 versions but staging at 204 and without `invite-staff`. Metadata is not deployed-source or functional proof. Use the [specialized release sequence](controlled-drugs/narcotics-release-sequence-20261028.md) from the actual prefix, not the September generic push instructions.
- [ ] Resolve or explicitly exclude the [November 6 runtime metadata](evidence/beta-backend-runtime-metadata-2026-11-06.json) findings: staging scheduler configuration is missing, production attachment cleanup returned 503 with “Attachment cleanup is disabled”, and task-reconciliation/invoice-reminder jobs are inactive on both targets. Verify new outcomes after repair; HTTP 200 alone is insufficient.
- [ ] Review complete exact-candidate test results, including current narcotics workflows. The CI historical-206 database job does not prove the newer 207–209 workflows.
- [ ] Confirm restore access, a tested recovery path, alert recipients and the PITR decision. Check actual hosted settings before changing them.
- [ ] Confirm authentication settings and a real staff invite/recovery/deactivation rehearsal on the intended target.
- [ ] Approve the specific PR merge and release once its evidence is ready. Agents never infer permission to merge.

## Provider acceptance

- [ ] Verify the selected CloudTalk number, outbound allowlists/mode, inbound threading, STOP/resubscribe behavior and delivery-state wording with approved test recipients. Twilio is retained code and is not the selected provider.
- [ ] Verify Resend outbound, AgentMail reply/attachment handling, signed delivery callbacks and failure recovery. Preserve Fastmail root MX/staff mail.
- [ ] Complete sandbox payment/refund/reconciliation and Affirm acceptance before any live-payment activation; verify live-account, return-origin and capability settings separately. Never install a sandbox payment profile in production.
- [ ] Verify reminder policies and per-record eligibility with disabled/test delivery before enabling real sends.
- [ ] Record vendor-specific acceptance for any automatic lab, imaging or device integration included in the beta. Keep excluded providers clearly unavailable.

Run `npm run public:readiness` after approved public-copy changes. Regenerate aggregate readiness only from evidence for the exact release/environment; its green checks do not replace the decisions above. Historical 3/6 scores, old DNS values and old secret-presence observations are retained in dated receipts, not treated as current launch status.
