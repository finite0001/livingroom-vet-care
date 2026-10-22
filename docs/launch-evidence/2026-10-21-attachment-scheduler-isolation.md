# Attachment clone scheduler isolation — October 21, 2026

Base: `b376f480cd349d779ffe8f345b0a17f2ab328783` (merged PR #290).
Scope: local synthetic test isolation only. No application/database migration,
hosted configuration, provider delivery or clinical activation change.

## Problem and bounded diagnosis

Post-merge CI run `39693926249` failed its database job when the attachment-originals
rehearsal's final exact source comparison detected a change. Its execution crossed
a scheduled-job boundary. The failed run did not preserve the two differing source
snapshots, so its exact changed component and cause cannot be proven afterward.
The complete decoded failure log is retained privately (151,382 bytes, SHA-256
`910949de4e5d87dac38e817cf1eb4840783c0155ed4fd574fba1319026460077`).

A separate owned local rehearsal reproduced the timer race with a real one-second
pg_cron job. Only its deliberately created probe relation changed. The unchanged
source comparison rejected that change; no relation was excluded from comparison.

## Change

Both attachment clone entrypoints require explicit synthetic-run consent and a
local project config. The isolation helper admits only a local Unix Docker socket,
verifies config bytes, container name/project/workdir labels and immutable container
ID, and pins that endpoint/ID for SQL, dump, contention and cleanup operations.

Before the source baseline, it refuses scheduler dispatch credentials or queued HTTP
work, pauses automatic jobs and observes bounded drain. It preserves cron schedule
rows and compares the full original source after clone cleanup. On success or
failure it restores the original effective scheduler setting and the original
`postgresql.auto.conf` override presence/value. It will not restore against a
substituted container/config. Diagnostics identify changed component/relation names
and counts without printing source rows or raw catalog contents.

The old controlled-runtime scheduler helper, all 205 canonical migrations, frozen
stock artifacts and independent expectations remain unchanged. The change neither
captures a new expected seal nor weakens any source-equality assertion.

## Completed local verification

- 370 local concurrency harness tests passed.
- Actual owned timer/clone proof passed in 220.870 seconds within its declared
  900-second workload budget and 180-second cleanup reserve.
- Unpaused actual timer mutation was rejected and identified only the probe relation.
- Paused full source snapshots were identical; original scheduler setting/override
  provenance and schedule rows were restored; the timer then resumed.
- Attachment metadata: 362 SQL assertions and 44 harness checks passed.
- Attachment originals: 1,135 SQL assertions and 321 harness checks passed.
- Both rehearsals retained exact complete parent source snapshots before/after.
- All 531 original, retained and current proof input files matched.
- Owned runtime cleanup was verified. Raw metadata and count/hash fingerprint snapshots, commands, inputs and results
  are retained privately; this is not an archive of every source row. No original
  or unrelated runtime was removed.

Result SHA-256: `84aa2dc7b48ee925113920981d445bcca9b79b6a3d36401c838e32ce1468c080`.
Source-map SHA-256: `3db6d6ad94595298b3d9f4cef8dbe361951ea3535e0a4d4417a3917f9741bb16`.

Reproduce in an owned synthetic local environment:

```sh
python3 -B -m unittest discover -s supabase/tests -p 'test_*_harness.py'
python3 -B supabase/tests/probe_attachment_scheduler.py --run-synthetic-local
```

Independent source and final runtime/evidence review passed. Exact-head PR
CI/preview and specific owner merge approval remain separate release gates. Final
PR receipts will record those outcomes without rewriting this dated local receipt.
