# Coordinated stack integration checkpoint

Read-only GitHub inspection on 2026-09-16 found independent clinical/estimates and communications PR chains. These are not yet one accepted deployable migration inventory.

| Version | Clinical chain | Communications chain |
|---|---|---|
| 20260916100000 | PR151 native return reconciliation releases | PR152 conversation attachment uploads |
| 20260916110000 | PR154 native dispense finance | PR153 conversation email preparation |
| 20260916120000 | The uncommitted estimate candidate originally chose this version; now renamed to 20260916120716 | PR156 inbound attachment capture |

Estimate SQL contents were unchanged by the rename. The local disposable run copied the earlier filename and ended at an existing browser navigation timeout before estimate acceptance. Its containers and volumes were removed. Final-source CI must validate the renamed inventory. Neither this checkpoint nor independent PR CI authorizes deploying duplicate migration versions.

Before the coordinated rollout:

1. Establish the exact reviewed canonical PR heads and ancestors; do not merge alternate historical import implementations solely because they remain open on GitHub.
2. Check hosted migration inventories read-only and concurrent deployment ownership. Never rename a version already applied to a hosted target without a separately verified repair/upgrade plan.
3. In an isolated integration branch, reconcile unapplied version collisions while preserving dependency order and both implementations. Update exact inventory manifests and test overlays together.
4. Integrate shared household navigation, communications and clinical changes; preserve all independently verified workflows and saved artifacts.
5. Run the complete combined migration build, SQL/contention, frontend/browser, actual Auth/HTTP/Storage and populated restore suites. Isolated green PRs do not prove integration.
6. Publish the combined reviewed source manifest and execute the authorized staged/hosted rollout. Clinical, provider and full staff rehearsal gates remain required.

This is an engineering integration task, not a request for the owner to resolve migrations manually. No hosted mutation or provider call occurred during this inspection.
