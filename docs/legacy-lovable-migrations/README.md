# Legacy Lovable schema history

The old Lovable backend applied `20260913031849` as a copy of the clinical-core migration. The canonical stack already creates those objects in `20260912210000_clinical_core.sql`. This preserved historical copy must not run after that migration: it would create the same columns, tables, functions and triggers twice. Its only substantive SQL difference is `DROP CONSTRAINT IF EXISTS` for the patient household foreign key.

This archive does not modify any hosted migration ledger or certify that the old backend can be upgraded with the canonical stack. Production remains the explicitly selected `mgadheotkdnrsatfivjy` project; backend readiness must be verified before public hub rollout.
