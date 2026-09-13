# Phase 3c — Outside prescription history

Status: implementation contract; not implemented or commissioned. Baseline: integrated vaccination review branch `73abb6a`, including migrations through5400 and payment-trigger hardening9000. The full [Phase 3 scope](phase-03-complete-migration.md) remains required, including attachment transport and migration reconciliation.

Implementation started locally: `prescription-reconciliation.ts` compares source item references with observed IDs, preserving missing/unexpected/duplicate/malformed evidence and distinguishing absent versus empty lists. Five focused tests pass. The helper is not yet connected to runtime intake or review; no prescription resource has been enabled, no provider read performed and no completion gate below is closed by this helper alone. Migrations5300/5400 have since been deployed to staging; the older deployment note at the end is historical.

The adapter now implements bounded prescription/animal and prescription-item/parent reads, validates returned associations and preserves unresolved source values. All33 ezyVet tests, targeted lint and application TypeScript checks pass. The HTTP handler explicitly rejects these two resources until scoped database claims/staging exist, even if configured. This work remains local and incomplete; database recovery, review, UI, releases and actual local HTTP/database integration are still required before deployment.

Migration5500 now adds patient-scoped prescription-header runs, immutable page receipts and observed revisions, administrator recovery/discovery and restricted service claims. It blocks generic prescription and item claims; item staging remains unavailable pending its parent-bound contract. A disposable schema-only local database, augmented with5200/5300/5400/9000 and5500, passed19 new prescription,59 clinical-history and81 vaccination-intake assertions. The owned test database was removed. The foundation's migration receipts lag its actual schema, so this is a combined-schema regression check, not a full migration-history upgrade rehearsal. No hosted migration or HTTP activation occurred. Item intake, concurrency, real local HTTP, review, UI and release integration remain pending.

Migration5600 adds prescription-item runs pinned to the same-site patient mapping, parent snapshot, payload hash and observed head version. Fresh pages revalidate the parent; exact committed receipts recover before mutable-source checks. Its81 SQL assertions pass, including generic/legacy bypass denial, wrong-parent/site denial, source revision changes, discovery and immutable receipt recovery. Combined disposable checks now total240 assertions (81 items,19 headers,59 clinical,81 vaccination). The HTTP handler remains disabled for both new resources pending gateway integration and actual HTTP/database tests. No hosted changes, live reads or clinical approval occurred. Concurrency, full upgrade/restore, UI, review and release work are still required.

The local HTTP handler and Edge gateway now call the scoped header/item RPCs and use only database-derived provider IDs. Input validation requires the complete item parent context and rejects parent fields on unrelated resources. Stale/legacy context errors return409 with `retry_safe:false`; missing gateway implementations fail closed. All16 handler tests pass (five new prescription cases), the17 adapter tests and five reconciliation tests passed before the final header-only test addition, and targeted lint, application TypeScript and frozen Deno entrypoint checks pass. These use simulated gateways, not actual HTTP/Auth/PostgREST evidence. No deployment or hosted configuration changed; default read resources remain contact/animal. Real local HTTP, concurrency and the remaining full workflow gates are still open.

The executable `supabase/tests/ezyvet_prescriptionitem_runs_concurrency.py` now passes53 real PostgreSQL contention checks, observing lock holders/waiters. Cases include simultaneous exact retries, parent source changes in both orders, a three-session stage/reclaim/parent-write race, reversed overlapping item pages and household changes in both orders. Its81 item assertions and215 prior import/weight/clinical assertions also pass. Two harness defects were corrected: session tags exceeded PostgreSQL's identifier length, and refreshed source selection needed an explicit `is_current` predicate. No import implementation change was needed during this check. The owned disposable database was verified and removed. CI now runs this harness. This covers intake concurrency only; approval/correction/release concurrency is still required once those workflows exist.

Actual local HTTP/Auth/PostgREST intake now passes43 checks via `python3 tests/ezyvet/prescription-disposable.py --run-synthetic-local`. It creates a fresh local Supabase stack, applies every checked-out migration, runs the real handler against real Auth/RPCs and a synthetic loopback upstream, and verifies teardown. Evidence is in `docs/evidence/prescription-intake-runtime-local-20260913.json`. Cases include parent/header intake, wrong-parent rejection independently in SQL, lost committed acknowledgment, continuation and terminal recovery, current source changes, anonymous/table access denial and unchanged clinical/billing/inventory/outbox state. Zero ezyVet requests occurred. This proves local intake only, not whole-prescription review, UI, release export, hosted commissioning, full backup restoration or clinical acceptance.

Administrator header and medication-item intake screens are now integrated into the existing ezyVet page, with typed response validation, mapped patient selection, current-parent selection, bounded source/run pagination, original-intent recovery and shared navigation protection. Sign-out/actor changes clear both new run-reference prefixes. All25 focused browser cases pass (10 prescription,9 vaccination,6 clinical), along with a focused actor/session cleanup test, TypeScript and targeted lint. These browser cases simulate backend responses; the separate43-check local runtime evidence above covers actual intake APIs. Whole-prescription reconciliation/review, patient chart history and releases are not implemented by these screens and remain required. No deployment or live source activation occurred.

## Required outcome

An administrator imports prescriptions for a reviewed patient mapping and imports the associated medication items through verified same-site prescription observations. A veterinarian reviews the outside prescription and its selected items together. Active staff can read the approved history in that patient's chart and explicitly select it for medical-record releases. Source changes and local corrections remain visible; retries recover the original operation.

An outside prescription does not authorize a local prescription, refill, dispensing, stock movement, charge, certificate or outgoing message. Preserve this distinction in the chart and exported history, without omitting the requested historical prescription workflow.

## Verified public source contract — September 13, 2026

The official [prescription](https://developers.ezyvet.com/#get-prescription) and [prescription-item](https://developers.ezyvet.com/#get-prescriptionitem) sections were retrieved directly and parsed after the web reader exceeded its content-size limit. This was a public-documentation read, with no practice API request or patient data access.

| Resource | Documented read and association | Preserved source fields |
| --- | --- | --- |
| Prescription | `GET /v1/prescription`, `read-prescription`; `animal_id` and `consult_id` filters; endpoint says up to10 records | `id`, `active`, `created_at`, `modified_at`, `animal_id`, `consult_id`, `prescribing_vet_user_id`, `date_of_prescription`, `prescription_item_list` |
| Prescription item | `GET /v1/prescriptionitem`, `read-prescriptionitem`; `prescription_id` filter | `id`, `active`, `created_at`, `modified_at`, `prescription_id`, `product_id`, `qty`, `remaining`, `instructions`, `date_start`, `serial_number` |

The prescription query parameter is named `prescribing_vet_user`, while the illustrated response uses `prescribing_vet_user_id`. Do not silently rename response evidence or use the query label as an inferred clinician identity. Documentation describes dates as epoch time but does not establish the practice's date interpretation or quantity units. The response illustrates scalar values as strings and item-list values as numbers. Keep originals and review unknown values explicitly. Use an application page cap of10 for both resources; only the prescription cap is described by the public text as a provider limit.

Public documentation does not prove the issued account has these scopes, that every field is populated, or that a paginated scan is a consistent export. Authorized practice samples and Dr. Edler's acceptance remain required.

## Intake identity and recovery

1. Add explicit `prescription` and `prescriptionitem` contracts and scope validation. Default configured resources stay `contact,animal`; do not activate new practice reads as part of implementation.
2. Prescription intake uses the approved animal mapping and server-derived animal ID. Freeze origin/site, patient/household, mapping and actor in dedicated run context. Reject any returned prescription associated with another animal. A nonempty consultation reference must resolve to a current patient-scoped same-site consultation before clinical review; missing or unresolved references remain inspectable intake evidence, never silently approved.
3. Item intake requires a current, scoped prescription snapshot, payload hash and observed head revision. Resolve the upstream prescription ID on the server. Do not accept a browser-supplied arbitrary provider ID or rely on a generic snapshot. Recheck the parent and patient for every fresh page. Reject the whole page if any item belongs to a different prescription.
4. Preserve dedicated page observations for both resources. Reuse the existing immutable snapshot/head mechanism, provider cooldown and bounded lease protocol. Generic claim/stage paths must reject these resources, including legacy run UUIDs, so direct SQL calls cannot bypass patient/parent validation.
5. Recovery returns an exact committed receipt before requiring current source eligibility. Fresh writes require the original actor, current authority, original context and valid lease. A source A→B→A reversion still invalidates an old observed revision. Reject changed payloads, order or completion flags on receipt replay.
6. Provide administrator run discovery and resumable page state after browser-pointer loss. Keep scans per resource within the existing shared cooldown rather than adding competing background scans.

## Whole-prescription review

Use additive immutable review-request, approved-prescription and approved-item evidence, not the refill-request or treatment tables. Review is active-DVM-only; chart discovery is active-staff-only. Private tables and internal helpers remain inaccessible to API roles. All writes derive their actor from authenticated server context.

Freeze the parent original and observed revision, current scoped consultation reference when supplied, selected item originals and observed revisions, optional reviewed catalog matches with product versions, the outside prescriber reference, explicitly interpreted prescription/start dates and status, and a review rationale. Keep source instructions and quantity/remaining values verbatim as plain text; any local interpretation must be a separate attributed field. Do not calculate remaining refills, dose, local authorization or unit conversions from these values.

Reconcile the source `prescription_item_list` against observed item IDs. Missing, duplicate, unexpected or malformed references must be visible with their exact source identity. Do not label a prescription's items complete based only on the item endpoint's final page. Unknown or conflicting source-list semantics require an explicit unresolved state and clinical review rather than an invented normalization. An approved partial historical account must disclose what is missing; it must not claim complete migration.

Use prepare → explicit review → approve, preserving actor/patient/UUID and a hash of the exact frozen payload. Identical approvals must not duplicate history. Changed source evidence or interpretation appends a correction linked to the expected latest predecessor. Original receipts remain recoverable when current eligibility changes, but only under the original actor's current required authority. Durable request discovery and explicit abandonment must cover ambiguous responses and browser-storage failures.

Lock mapping/patient/parent/item heads in a documented canonical order compatible with the existing patient4700 release lock. Observe contention in both orders against source ingestion, consultation changes, household reassignment, catalog changes and competing corrections. Do not infer deadlock safety from sequential tests.

## Chart and medical-record release integration

Integrate a clearly attributed outside-prescription history panel into the existing patient chart. Show source site, outside prescriber reference, original instructions/quantities, reviewed interpretation, missing items, currentness and correction history. Escape all source content. Keep late responses and retained drafts scoped to actor and patient, and retain the existing shared navigation protection.

Extend the current schema7 release format additively to include explicitly selected reviewed prescriptions and their frozen items. Preserve rendering and recovery for schemas1–7. All print, email and linked-document paths must use the same validated projection. Changed parent/item/consult source revisions and corrected approvals invalidate affected pending packages. Preserve the existing original-file byte verification for mixed packages; do not weaken it because prescription evidence is structured JSON.

Clinical approval of the new release format is separate from implementation. Do not enable a release policy, send documents or claim Dr. Edler's acceptance during development.

## Implementation and verification order

1. Implement additive scoped intake SQL, adapter/handler validation and exact service-role receipts. Test wrong patient, parent, site, scope, cursor, malformed pages, stale revisions and legacy bypasses through both SQL and actual local HTTP.
2. Add administrator intake/recovery/discovery UI and actual browser flows. Verify interrupted acknowledgments, stale chart responses and navigation retention.
3. Implement whole-prescription DVM review, correction and chart discovery with explicit unresolved-item accounting. Verify permission changes, duplicate/correction races and no treatment/refill/stock/billing/outbox side effects.
4. Integrate source-aware releases and backward-compatible rendering; test mixed selected records, original byte validation and invalidation from each linked source.
5. Extend disposable upgrade/restore fixtures with parent/item observations, incomplete runs, prepared requests, approved corrections and release provenance. Verify exact records survive restoration and cleanup removes only owned synthetic resources.
6. Retain sanitized evidence and synthetic clinical examples. Commission scopes and real patient samples separately, then perform supervised reconciliation and obtain Dr. Edler's decision.

Migrations5300/5400 are pending staging deployment at this planning checkpoint; do not assume their hosted presence. The unrelated9000 hardening migration already exists there. Allocate new migration names without reusing applied versions and apply reviewed migrations explicitly rather than blindly pushing an out-of-order history.

## Completion evidence

- [ ] Scoped prescription and item intake with exact durable recovery works through actual local HTTP/Auth/database calls.
- [ ] Whole-prescription review, chart reading and corrections work for authorized staff, with wrong actor/patient/site/role and source-change cases denied.
- [ ] Missing and conflicting item evidence stays visible and migration completeness remains accurately reported.
- [ ] Historical import creates no local prescribing, refill, inventory, billing or communication side effects.
- [ ] Explicit medical-record selection and all delivery renderers preserve original evidence, backward compatibility and source invalidation.
- [ ] Combined checks and populated upgrade/restore evidence pass on the integrated release revision.
- [ ] Authorized practice samples, scope entitlement, date/product/prescriber mappings and clinical acceptance are verified before commissioning.
