# Backup and restore procedure

This is an operational runbook, not a claim that production restoration has been rehearsed. The foundation work replays the schema and tests permissions locally; data/file restore acceptance remains a launch gate.

1. Identify the exact source project, backup timestamp, database backup coverage and private Storage object inventory. Set recovery objectives with the practice owner.
2. Restore into an isolated destination with outgoing messages and scheduled jobs disabled. Do not restore over a live practice as an experiment.
3. Apply required schema versions and restore application rows, preserving IDs and relationships. Restore Storage files separately and compare checksums/object counts; a database backup alone is not proof that file bytes were restored.
4. Validate client/patient/encounter/document relationships, invoice totals, stock ledger, signed-note history, Auth identity mapping and RLS using dedicated test accounts.
5. Reconfigure server secrets, Auth redirect/SMTP settings, provider webhooks and jobs. Do not copy live delivery enablement blindly.
6. Exercise a synthetic login and complete visit; check files, audit history and failed-job visibility. Record elapsed restoration time and data completeness.
7. For an incident cutover, freeze writers and dispatchers, reconcile records created since the backup, switch endpoints, then enable a single worker set. Keep the old system read-only until reconciliation is complete.
8. Rollback after new writes requires reconciliation back to the old destination; simply changing an environment URL can lose those writes. Record the decision owner and exact transition time.
