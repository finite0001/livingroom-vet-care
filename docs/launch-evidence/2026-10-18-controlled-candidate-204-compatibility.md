# Controlled candidate compatibility with migration 204

A separate owned local run integrates quote-anchor commit `2455907f72efaa7ad8f3473540c2595044a19ced` with the exact corrected PR259 head `0f1197ffc2cdb03703adbdfcd77b69b1e4fd1862`. It retains the 204-migration guard, byte-pinned original 189 reference, untouched-baseline refusal and four atomic drift/rollback probes. Existing 189/203 receipts remain historical and unchanged. No canonical SQL or candidate protocol/grant changes were needed; the current SQL assertion expectation is 7,338.

The actual run used Supabase CLI 2.118.0 and owned Postgres image `public.ecr.aws/supabase/postgres:17.6.1.171`. It passed 166 canonical SQL suites / 7,338 assertions with the candidate installed, 24 native managed actions, eight observed lock queues, eight restored isolation refusals, four restored context checks and 456 exact restored relation fingerprints. All ten canonical writer definitions remained unchanged.

The probe's raw `api_checks: 133` means **133 combined genuine Auth/PostgREST response and SQL setup/state/cleanup assertions**. It is not an HTTP-only count or an HTTP request count. A separate static audit of the successful code path reconciles 105 HTTP-derived `check()` calls plus 28 SQL `check()` calls; those are not independently instrumented runtime counters. The restore/isolation/context assertions use SQL fixtures and remain separate from genuine Auth/PostgREST coverage.

All 395 source hashes still matched after completion. Owned actors/sessions were retired, and containers, volumes and private working files were independently confirmed removed. Hosted operations and provider requests: zero. The protected earlier attempt, which passed all 166 SQL suites but stopped on a provisional assertion-count mismatch before native/Auth probes, remains separate in the machine receipt.

Sanitized result SHA-256: `a8ee20e2b380959c655b84e30279815e7632cde09ac6559c37c9d16f00148b59`. Protected runner-log SHA-256: `4ed7354e0629658245e9b1c000bdaaa5198ab1da76959c362d40b959502e1cca`. [Machine evidence](2026-10-18-controlled-candidate-204-compatibility.json) preserves the complete source inventory and cleanup checks.

This proof does not install a production controlled engine or complete C1b production acceptance, C2 workflows, C3 actual practice rules/counts/Susan approval, physical post-backup reconciliation, Storage binary restore or clinical activation. Exact-head CI and independent production migration review remain separate.
