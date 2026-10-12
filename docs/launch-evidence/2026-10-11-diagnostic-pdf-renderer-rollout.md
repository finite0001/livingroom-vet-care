# Isolated diagnostic renderer — approved #241 rollout

Dave approved #241 specifically. The approved head `b54d4428219526c090cfe0841e8380b88332f44c` merged as `9456f515613cc3a132583763d55007161e1cedfc` at 2026-10-12 03:54:01 UTC (October 11 locally). All required exact-head checks passed: [CI](https://github.com/finite0001/livingroom-vet-care/actions/runs/38185801275), [receipt](2026-10-11-diagnostic-pdf-renderer-ci.json).

The Git-connected production deployment is READY at the exact merge commit. A fresh browser loaded the public sign-in page with HTTP 200, zero page errors and `/assets/index-Dd1CZU7O.js`; no staff session or provider message was used. The approved renderer changes do not change the frontend bundle. [Rollout receipt](2026-10-11-diagnostic-pdf-renderer-rollout.json).

#241 requires no new migration or Edge Function deployment. Both application backends remain at the previously verified 175-migration baseline. The approved private renderer image remains pinned; no clinical worker policy, scheduler, staff PDF download or release was commissioned by this rollout. Private artifact registration continues in [3B2B](../../plans/2026-10-11-diagnostic-pdf-registration/plan.md).
