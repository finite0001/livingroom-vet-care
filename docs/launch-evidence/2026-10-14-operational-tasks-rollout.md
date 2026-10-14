# Operational tasks — hosted rollout

PR [#250](https://github.com/finite0001/livingroom-vet-care/pull/250) merged as `e4282c5a2d1fa1ac958ddab678f21208dfb1440b` on October14 UTC, under Dave's standing approval. All four required CI checks passed for reviewed head `db859ab3a8531f8199cc444073462d9c67457b07`. [Machine-readable receipt](2026-10-14-operational-tasks-rollout.json).

Staging and primary have exactly184 canonical migrations, no pending migration, and verified private table/RPC grants. Migration `20261014022511_operational_tasks.sql` has SHA256 `2f7ce0a079041cfddf1f20d4a1436425c5c07b9fb64b850b94612fe839aede1c`. Protected preflight backups preserve affected definitions, ACLs and constraints. No roles, seeds or Vault configuration were changed.

Both hosted projects passed78 transactional assertions with unchanged before/after snapshots. Staging additionally passed48 genuine API/access checks and24 browser assertions using real Auth/PostgREST. Two initial harness failures were retained honestly: JSON CLI boolean representation, then a browser Back check before route/render settlement. The corrected run passed. Every attempt's canonical cleanup closed synthetic bookings, uses and tasks, retired publications, archived the patient and deactivated users/sessions; all nine cleanup counts were zero. Immutable synthetic evidence remains.

The security advisor reports13 new authenticated SECURITY DEFINER notices for the intended staff endpoints; role/current-session checks and private helper grants were verified. Existing notices remain: one `pg_net` extension placement, eight anonymous-function notices,474 prior authenticated-function notices, and leaked-password protection. Do not describe the advisor as clean. No new anonymous notice appeared.

Production deployment `dpl_4Z3sTCaMD5p68dt7JB95hP71aa3K` is READY in project `prj_Dn1g9AIBEth78S7V3pqhYHueICl7`, on the exact merge SHA, with `thelivingroom.vet` assigned. The actual public browser passed login200, bundled task routes, three protected-route redirects, primary-backend configuration, zero page errors and anonymous diagnostic-download401. The route proof follows the code-split App chunk, not just the bootstrap bundle.

Generation remains off. Primary's fresh preflight had three pre-existing outbox rows; installation and rollback verification preserved them. Primary has no payment-provider profile; staging retains its existing sandbox profile. No provider request, legacy write, Edge deployment, worker activation or practice template commissioning occurred.

The bounded reconciliation worker is still required. All45 original requirements, actual vendor exchanges and Susan's clinical/configuration acceptance remain open as specified in [the full plan](../../plans/2026-10-13-operational-tasks/full-plan-status.md). Stripe is confirmed; the remaining provider/device details and financing route are not yet supplied.
