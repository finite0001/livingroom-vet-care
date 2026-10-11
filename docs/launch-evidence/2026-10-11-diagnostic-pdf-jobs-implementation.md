# Diagnostic PDF recovery foundation — package 3B1

Built from merged/deployed PR #239 (`cd51799`) on isolated branch `feat/diagnostic-pdf-jobs-20261011`. [Plan](../../plans/2026-10-11-diagnostic-pdf-jobs/plan.md) / [runtime research](../../plans/2026-10-11-diagnostic-pdf-jobs/reports/runtime-research.md). Prior [hosted rollout receipt](2026-10-11-manual-diagnostics-rollout.md) and its helpers are included so the next package has the concrete 174-migration baseline. This new implementation is not merged or hosted.

The additive 175th migration (`20261011203250_diagnostic_pdf_jobs.sql`, SHA-256 `c91203146119b8e5bc5689b58e4cc32433c9f07343eab61caeb33da0cda24543`) creates five private evidence ledgers plus an empty/default-off worker policy. New reviewed diagnostic versions queue atomically; historical versions can request a job with the exact source hash. Server-stamped staff request/retry receipts recover original acknowledgements. Service claims use 90-second leases and monotonic fences, rechecking owner/policy/time after waits. Exact bytes are captured once in a bounded private bytea journal; SQL derives hash/length. Changed retries fail, exact replies recover and owner handoff preserves original source/capture attribution. Whole schema/data restoration retains the original bytes, source and pending-work fence.

**Captures remain unvalidated/unuploaded/unavailable for release.** Marker checks do not prove safe PDF structure, page count or correct rendering. No validator output, private Storage registration, generated-PDF reader, readiness flag, schema14 release path or worker scheduler is invented. No policy seed, paid service or provider send occurs. Existing medical UI and explicit full-request diagnostic exclusions remain in force. The future 3B2 renderer/coordinator must freeze HTML/longitudinal graph context, prove OS/runtime isolation, derive structural validation from actual bytes, read back privately uploaded bytes and register exact immutable artifacts before 3C review/transport.

| Verification | Result |
|---|---|
| Canonical local replay | 175 migrations; fresh uniquely owned runtime |
| Full SQL | 142 files / 5,791 assertions pass; 46 PDF-job cases including historical requests |
| Unit / TypeScript / lint / build | 1,314 unit cases pass; TypeScript/build pass; zero lint errors, four existing warnings |
| Actual lock contention + full data restore | 34 checks pass; exact concurrent claim/capture, changed bytes, offboarding during job/policy waits, expiry during an observed wait, replacement fences and exact-byte restore |
| Genuine Auth/private originals/byte recovery/Patient360 | 54 assertions pass using actual staff/DVM/admin/service-role calls and real private bytes; no mocks or private browser keys |
| Standalone final rehearsal |full SQL plus 54 genuine assertions pass; owned containers/volumes removed; source/harness hashes pinned |
| Restore guard counterexamples | 10 Python cases pass |

Only owned disposable local runtimes were mutated; existing default/Ondara containers were untouched. Clone databases were independently marked and removed after proof. Captures and synthetic identities disappeared with the owned volumes; no hosted 175 migration, new worker config, real record, consent, outbox or financial write occurred. Source-generated types are unchanged. Required exact-head CI and Dave's specific new-PR approval remain the merge/rollout gate. All 45 requirements and real practice acceptance remain required before launch.
