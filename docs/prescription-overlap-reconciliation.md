# Prescription release overlap reconciliation

Canonical base: `a7cd319` (merged PR123). PR122 was compared read-only and was not merged or deployed by this change.

## Additive migration

Migration `20260913650000_prescription_release_reference_hardening.sql` replaces only the private `ezyvet_validate_reviewed_prescriptions` function. The deployed6300 migration remains byte-for-byte unchanged. Version6400 is deliberately absent because it belongs to PR122's incompatible alternative schema8 installation.

The helper now rejects null patients and malformed JSON references before UUID casts, and limits mapping/source-head locks to records belonging to the requested patient. It still locks every observed item (including omitted items), every referenced consultation, and the parent in the canonical order. Currentness and latest-review predicates are unchanged. Execution remains revoked from PUBLIC, anon, authenticated and service_role; staff use the existing authorized release RPCs.

This is reference-validation and lock-scope hardening, not a new authorization boundary: existing currentness already checks patient identity, and public preview already translated invalid UUID casts.

## Changes deliberately excluded

PR122's replacement6300 and new6400 cannot be applied over the deployed6300 schema:6400 recreates existing functions/triggers and assumes earlier dispatch bodies. Its renderer relaxes reconciliation checks; its selection UI omits partial-history candidate disclosures. Its restore implementation predates the destination default-ACL fix and post-restore canonical privileges/RLS comparisons. All canonical safeguards remain.

The additional three-session and reversed-product contention scenarios from PR122 remain optional future test coverage; existing parent/item/consult ingestion and correction contention tests cover this helper's unchanged lock protocol. Attachment metadata work does not depend on merging PR122.

## Local validation

- 441 existing SQL assertions plus27 focused reference/currentness/grant assertions passed.
- Existing contention run passed162 checks, including actual parent/item/consult ingestion versus release confirmation in both orders and correction races; owned scratch database removed.
- `python3 supabase/tests/prescription_reference_upgrade.py` passed: a populated canonical6300 schema (84 migration sources before6500) retains every public table row and every unrelated function definition/grant after6500. The same approved prescription remains available and all27 focused assertions pass afterward. This schema test does not manufacture hosted migration receipts.
- The new27 assertions are included in the normal concurrency runner, which applies6500 after canonical6300.
- Restore manifest now explicitly expects85 migrations: the prior84 plus6500, without6400. Fresh populated51-to85 restore verification is recorded below when complete.

No hosted deployment, clinical acceptance, source read, message delivery or PR122 mutation was performed.
