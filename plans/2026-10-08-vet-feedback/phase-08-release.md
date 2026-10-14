# Phase 8 — All-features release acceptance

**Status:** Planned. **Priority:** required final gate. **Dependencies:** every required matrix row, including iPhone scanning and the agreed Gusto exchange. No reduced-scope launch is authorized by this plan.

## Engineering checks

1. Refresh from current main and resolve concurrent work before final checks. Identify changed functions and migrations explicitly; retain generated-type ownership and existing Router 7 behavior.
2. Inspect ignored `.env`/`.env.local` and other local config before any build; never overwrite them with synthetic values. Use a dedicated local/staging test environment with synthetic fixtures.
3. Run targeted checks during each package. On the final integrated revision, run the repo's required `npm run check`, Playwright suite, Edge type checks and isolated database suite, including relevant race tests. Dependency changes also require `npm audit`. CI jobs in `.github/workflows/ci.yml` are the source for exact commands/runtime versions.
4. Update migration-inventory tripwires in `tests/prescriptions/native-disposable.py`, `tests/ezyvet/attachment-metadata-disposable.py` and `scripts/restore-rehearsal/run.py` when adding migrations; confirm actual paths/count contracts before editing. Prove additive upgrade on populated synthetic data, plus backup/restore of new artifacts and ledgers.
5. Test responsive UI and keyboard flow in the real Patient 360/Schedule layout; explicitly test camera behavior on a real iPhone. Synthetic browser mocks cannot establish hardware/provider acceptance.
6. Run the cross-phase failure cases in [shared contracts](implementation-contracts.md): concurrent death/attempt start, controlled movement/register rollback, snapshot/render/upload recovery, provider uncertainty/replay, exact production rounding and Gusto duplicate prevention. Test the actual transaction boundaries, not only sequential UI flows.

## One integrated rehearsal

Use a synthetic household with two pets and two eligible staff identities:

1. Create a contact-complete client and both pets; upload a photo. Show rejection of missing contacts and orphan-patient creation.
2. Import representative MWI/Midwest products; scan a product on iPhone; receive real-shaped lot/container data in staging.
3. Book reviewed appointment types, confirm reminders and daily facilities tasks, complete a visit and schedule the next one.
4. Record SOAP, reactions, vaccine/medication/service, dental/QOL/body-map observations and manual diagnostic results. Show Whogot's accurate recipients and compatible result graphs.
5. Exercise controlled-drug movement/witness/count with two identities. Verify ordinary stock and the drug register reconcile.
6. Import an anesthesia record and a VetRocket test study/report from the actual approved interfaces. Review AI SOAP, recap, call summary and dental suggestions without overwriting signed history.
7. Produce diagnostic/certificate/selected-record PDFs. Fulfill an incoming and an outgoing records request; send exact reviewed artifacts to authorized test recipients by email and texted document link.
8. Issue an invoice, demonstrate financing handoff/settlement, partial payment, overdue reminder cancellation and refund. Reconcile doctor production including discount and refund exactly once.
9. Exchange the approved Gusto staff/time/production/payroll test data through the supported route. Review returned draft/status; do not execute real payroll as an integration test.
10. Mark one pet deceased after a care message is queued. Confirm its routine message is blocked and the living sibling's eligible reminder is unaffected. Daily communications shows truthful outcomes.

## Rollout and completion

- [ ] Each N01–N25 and H01–H20 row links to an acceptance result, revision, reviewer and date. No requirement is marked complete merely because a screen exists.
- [ ] Dr. Edler records clinical/witness/template acceptance; Dave records operational/compensation/provider choices. Preserve any exclusions visibly.
- [ ] Deployment inventory confirms the selected staging/primary project, migration order, correct function bundles/JWT settings and frontend compatibility.
- [ ] Stage additive schema first, then dependent workers and UI; verify after each step. Production follows the reviewed release procedure and Dave's PR merge. Keep provider/live activation decisions distinct from code deployment.
- [ ] Rollback can disable each new adapter/automation without deleting ledger history or signed clinical records. UI rollback is allowed only while schema/contracts remain compatible; use forward corrections for persisted events.
- [ ] Observe failed/uncertain deliveries, reminder suppression, PDF jobs, supplier exceptions, unmatched diagnostic studies, pending drug witnesses and Gusto reconciliation errors. Each queue has an owner and a documented recovery path.
- [ ] No vendor access remains assumed, and no unresolved required feature is silently replaced by a manual workaround.

## Evidence files

Update `/Users/davidedler/Developer/lrv-feedback-plan-20261008/docs/clinical-staff-acceptance-register.json` and create `/Users/davidedler/Developer/lrv-feedback-plan-20261008/docs/launch-evidence/<release-date>-full-feedback-acceptance.md` with links to test results and operational sign-offs. Record evidence without copying real patient, financial or credential data into this public repository.

This planning task itself did not run these implementation checks or modify production. They are the required work for the eventual release.
