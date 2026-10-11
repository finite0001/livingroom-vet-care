# Phase 3 — diagnostics and generated clinical PDFs

Baseline: merged [PR #237](https://github.com/finite0001/livingroom-vet-care/pull/237), `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`. Both hosted backends have 173 migrations. [Verified 2C rollout](../../docs/launch-evidence/2026-10-11-records-requests-rollout.md). All 45 original launch requirements remain required; these packages divide implementation/review, not launch scope.

## Package sequence

| Package | Concrete result | Completion boundary |
|---|---|---|
| 3A | Structured manual diagnostic panels, clinician-reviewed finalized versions, corrections, compatible trends and selected-release schema14 | SQL/API/browser/concurrency evidence, exact-head CI and its own merge approval |
| 3B | Server-owned PDF jobs, pinned isolated renderer, private artifact capture/recovery | Engine and deployed runtime proof, hash/fence/restore tests, visible failure/recovery; its own merge/rollout approval |
| 3C | Staff review of exact registered PDF, certificates/selected records, email/protected-link transport | Browser → worker → private artifact → frozen payload; no unapproved real recipients; practice layout acceptance |

The local engine feasibility experiment is underway in `scripts/diagnostics/pdf-spike.ts`; it cannot prove hosted worker provisioning, OS isolation, Storage recovery or clinical acceptance. Package 3A can progress while the 3B runtime proof proceeds, but finalized manual diagnostics are not shareable as generated PDFs until the verified artifact path is complete.

## Findings and design decisions

`patient_lab_orders` tracks tests/dates/order status, reminders and optional report files. `lab_report_versions` stores verified originals, source-account/patient/order mappings, exact byte-capture identity and DVM acknowledgment. Neither is an analyte/panel model. Preserve those workflows: manual findings must not claim vendor provenance or manufacture an uploaded original.

Add a native diagnostic chart family anchored to the authoritative patient, with optional same-patient lab order, encounter and original document references. Reuse active staff drafting, server-stamped actors, `PT409` stale-version failures, operation UUID recovery, parent locks and immutable revision evidence. DVM-only finalize/correction follows existing original-report clinical acknowledgment; ADMIN alone does not become a clinician. No medical defaults, reference intervals, abnormal flags, diagnoses or unit conversions are inferred.

Current release schema13 explicitly enumerates families in SQL and several TypeScript validators. A new family requires a deliberate schema14 upgrade across discovery, confirmation, original verification, renderers and numbered-request capture. Do not append a display section while leaving capture/eligibility unaware of it. New acceptance is never seeded by migration.

## 3A: draft, review, correction and trends

1. Create an additive migration using `supabase migration new diagnostic_panels`. Do not invent timestamps or regenerate `types.ts`. Keep actor FKs to retained `profiles` identities.
2. Private model: versioned panel root/draft; immutable finalized snapshot with reviewer/time/hash; append-only correction against an explicit predecessor/reason; immutable actor-owned operation receipts and revisions. Root `current_finalized_id` updates only through bounded RPCs. Finalization/correction locks the root and rechecks active DVM after waits. Two concurrent corrections cannot fork the current head.
3. Panel captures test/panel label, collection/observation and report times, specimen, method/device and manual-source label. Observation captures explicit analyte identity and original label; `kind=numeric|qualitative`; a finite number **or** text value; original unit; optional finite reference bounds/text and manually recorded source flag. Zero survives parsing; blank stays missing; dimensionless units are explicitly identified. Validate exact keys, lengths, byte sizes, observation count and chronological consistency. No seeded catalog/ranges.
4. Optional original/transcription linkage must bind ready same-patient document and exact version. Retain original availability separately from immutable reviewed source metadata. A manual result without an original stays visibly manual. Never use the provider-account workflow as an artificial prerequisite for in-house entry.
5. Typed APIs in `src/hub/features/diagnostics/{model,api}.ts`: Zod input/response contracts, narrow hand-written RPC interface, `if (error) throw error`. Draft save/finalize/correct use stable action ID + exact submitted intent, immutable receipt lookup and unchanged retry after lost responses. A conflicting save preserves the local draft.
6. UI under existing Patient 360 lab workflow: in-house panel list/editor/review/history. Integrate the single patient unsaved guard and peer-editor restrictions; actor/patient changes must not reuse stale drafts. Staff can draft, active DVM reviews exact values and finalizes; corrections show prior values, reason and reviewer. No automated interpretation.
7. Trend grouping uses explicit analyte identity **and exact specimen/method/unit**. Do not silently normalize aliases or convert units. Every point links to the reviewed panel/version, original entered value and reference context. Text findings show dated events. Missing numeric values produce no point; zero does. Incompatible series remain visibly separate. Bound/paginate histories and graph points without silently omitting older selected results.
8. Add `diagnostic_panel_ids` to schema14 source discovery and complete census. Only finalized versions qualify; unsigned drafts are excluded visibly. Full/custom include selected diagnostics; lab subset includes diagnostic panels whose explicit category is laboratory, without expanding to unrelated imaging interpretations. Freeze current finalized version and complete correction history, not a mutable draft. Preserve exact source/original dependency groups and conservative package budgets.
9. Integrate source-change invalidation when correction/current source state changes, retaining old release snapshots/artifacts. Respect existing lock order: patient release advisory gate → sorted chart/order roots → original documents. Do not add an inverse request lock that conflicts with final communication authorization.
10. Regression matrix: all old prescription/return/reconciliation/import/source families must still validate under schema14. Existing clinical/disclosure acceptance remains off unless a real review is separately recorded.

## 3B: renderer and immutable artifact contract

First candidate: pinned Node/Playwright Chromium outside Supabase Edge. It reuses escaped HTML/CSS/inline SVG. Gotenberg behind a narrow wrapper and network deny policy is an alternative; WeasyPrint introduces another layout engine/native stack. Select deployment only after proving actual process sandboxing, bundle size, memory, cold/warm time and private binary transfer on the chosen host. Current Vercel project is a static SPA; a local browser print is not an installed worker.

The renderer accepts only trusted coordinator-generated HTML with immutable manifest via bounded IPC. No user-uploaded markup, arbitrary settings/URLs, original-document parsing, source queries or general Supabase credentials. Manifest binds job ID, requesting actor, release/finalized-result identity, source hash, schema, numbered manifest/package context, HTML UTF-8 length/hash, renderer/browser/font/image identity, fixed print settings hash and bounds. Snapshot/source identity and HTML/PDF byte digests are separate fields.

- Proposed experiment limits: HTML ≤2 MiB, PDF ≤8 MiB, 60-second deadline, one process/job. Measure before choosing actual production bounds; reject whole oversized jobs, never truncate.
- Fresh context/job, JavaScript and service workers disabled, external/file/data resources forbidden except explicitly supported inline SVG. Network-denied renderer process plus no secrets; interception alone is weaker proof. Pin browser and fonts independently of npm install scripts.
- Finalize snapshot + durable pending render job atomically. Do not hold clinical/request locks through rendering. Claim via expiring lease and monotonic fence; store exact input/settings before invoking worker. Duplicate/lost job acknowledgments recover the existing registry identity first.
- Private Storage is the required final file path for this phase. Reserve immutable opaque path; conditional upload; coordinator downloads actual bytes and validates PDF structure, length/hash/page count and manifest/renderer identity before registration. Browser/worker checksums and Storage metadata alone cannot mark it ready. Registration verifies actor/source/job/fence under lock and returns an immutable receipt. Identical-byte replay returns that receipt; changed bytes under the same identity fail closed.
- Crash after snapshot commit leaves a retryable job. Crash after upload before registration recovers the same path/bytes; do not regenerate under the same artifact/provider identity. Stale worker fences cannot register or remove a winner's output. Orphan cleanup must prove unreferenced path/job/fence and use existing cleanup conventions; referenced PDFs survive cleanup/restore.
- Rendering failure preserves the finalized result and shows preparing/failed with responsible owner and exact retry/recovery. Correction creates a new finalized version/job/path; original finalized data and previously shared PDF remain immutable. Fresh Chromium renders need not be byte-identical: once captured, always reuse registered bytes.
- Reuse immutable estimate artifact capture/recovery and patient-photo actual-byte verification patterns. Do not reuse estimate HTML grammar unchanged: it intentionally rejects SVG. Define a bounded clinical grammar for supported inline SVG rather than weakening estimate validation.

## 3C: actual PDF review and sharing

Read/download the registered private artifact through staff-authorized endpoints bound to patient and current session. Staff reviews the **actual PDF**, then attests its exact artifact hash/version. Canonical HTML remains evidence; HTML review is not silently treated as PDF review. Generate vaccine/certificate PDFs from already selected/issued certificate snapshots; historical vaccine records do not acquire a new rabies signature.

Use registered PDF as the one outward report alongside exact selected originals, preserving the current 25 total attachment/24-original and 32 MiB encoded limits. Adding both HTML and PDF would require a separately reviewed capacity change. Protected text links serve the same registered bytes. Recheck request cancellation, authority/revocation, current source eligibility, actor, lease/fence, payload hash and provider gates at final authorization. Preparation/registration/queue acceptance never claims provider delivery or recipient reading.

## Files and verification

Implementation worktree: `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011`.

| Action | Absolute path or directory | Responsibility |
|---|---|---|
| Create | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/src/hub/features/diagnostics/` | Typed panels/actions, DVM review/correction, compatible trend series |
| Modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/src/hub/features/lab-work/PatientLabWork.tsx` | Native diagnostics entry and dirty-state integration |
| Modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/src/hub/features/patients/PatientPage.tsx` | Existing guard/refresh wiring only if necessary |
| Create | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/supabase/migrations/` | Additive panels/schema14 and artifact job/registration migrations |
| Modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/src/hub/features/record-releases/` | New family/snapshot validation, current eligibility and exact PDF review |
| Modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/supabase/functions/_shared/record-release-*.ts` | All schema-enumerating family validators, charts and renderer |
| Modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/supabase/functions/_shared/release-email-payload.ts` | Registered PDF instead of regenerated report; unchanged selected originals |
| Modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/supabase/functions/_shared/document-link-artifacts.ts` | Verified private PDF manifest/retrieval |
| Create after runtime proof | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/workers/record-pdf/` | Pinned isolated worker; deployment location remains provisional |
| Create/modify | `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/tests/diagnostics/`, `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/supabase/tests/`, `/Users/davidedler/Developer/lrv-diagnostics-pdf-20261011/e2e/` | Genuine scoped end-to-end, SQL, concurrency and compatibility evidence |

Required proof: wrong patient/order/original, inactive/ADMIN/DVM roles, offboarding during waits, zero vs missing, incompatible unit/specimen/method grouping, draft conflicts, exact retries, competing corrections, source invalidation, schema14 retaining every old family, >100-source numbered closure, PDF structure/text/page visuals, hostile escaped text, network/file rejection, no PDF scripts/actions/embedded files, render/upload/register crashes, stale fences, original PDF unchanged after correction, private read denial, frozen exact email/link bytes, cleanup and restore.

Rollout each approved package staging first, prove hosted backend/functions before frontend promotion, then primary. Keep clinical/provider/financial commissioning untouched. Actual Dr. Edler layout/clinical workflow review is required before launch.

## Remaining inputs

No new answer is needed to start manual documentary results. Device/provider export samples are needed for later adapters. Real practice reference intervals/comparison mappings, report/certificate layout acceptance and final hosted worker availability/cost are commissioning inputs; no medical defaults or paid service is activated by this plan. OS-isolation, private upload/registration/recovery and hosted runtime proof remain required before fixing the 3B deployment design.
