# Narcotics release sequence

This is the Living Room Vet implementation. GreenTree and VetConnect Hub are
separate projects. PR [314](https://github.com/finite0001/livingroom-vet-care/pull/314)
is a draft; its merge and hosted installation require specific approval.

## Observed production baseline

Read-only inspection on October 28, 2026 identified the primary project as
`mgadheotkdnrsatfivjy`, running PostgreSQL `17.6.1.166`, with **204** migrations.
The latest recorded version was `20261018150000`. All 204 version/name/statement
count/statement-array digest/byte-length receipts matched the finite encodings
derived independently from repository source. No production rows were changed.
This checks migration history; it does not replace schema, grant or backup checks.

## Ordered installation

After complete acceptance and specific PR approval, prepare an isolated official
CLI release directory. Preserve migrations 1–204 and their recorded history.
Install these five migrations in order:

1. **205:** original `20261020151157_controlled_stock_private_engine.sql`.
2. **206:** the independently reviewed hosted-source variant of
   `20261022010000_controlled_secondary_review_private.sql` from
   `scripts/narcotics-log/hosted-source/migrations/`.
3. **207:** `20261027223535_controlled_record_review_workflows.sql`.
4. **208:** `20261027223544_narcotics_count_and_stock_workflows.sql`.
5. **209:** `20261028170038_narcotics_register_exports_and_recovery.sql`.

The hosted-source variant handles the admitted original migration receipts; it
does not authorize editing an existing ledger row. Migration 205 must retain the
official CLI statement-vector receipt expected by the 206 gate. Do not replace it
with a whole-file managed-SQL receipt or repair the ledger to bypass that gate.
Recheck exact filenames and source pins when assembling the release.

Before installation, verify the selected project, current source-derived ledger,
schema and permissions, available backup and recovery procedure. Rehearse the
exact release directory before applying it to the primary. After installation,
compare the complete expected ledger and module properties, inspect grants and
advisors, preserve existing data and verify the deployed staff application's
authenticated reads and unavailable/available states.

## Engineering acceptance and clinic commissioning

Release requires successful real-Auth business workflows, discrepancy correction
and closure, populated restore and restart fencing, revoked-review replacement,
private export/file retrieval, and recovery after lost browser responses. Keep
the existing database, browser and cleanup deadlines. A diagnostic run cannot
stand in for normal acceptance.

Actual staff assignments, drug classifications, independently counted opening
stock, physical controls and clinic procedures remain future commissioning inputs
because the clinic is under construction. Installation must not invent those
facts or present synthetic evidence as a clinical opening balance.
