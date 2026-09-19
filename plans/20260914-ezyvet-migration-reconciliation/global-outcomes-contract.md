# Global outcome projection contract

Implementation design grounded in the canonical ledgers through weight candidate `a6c8638`. This document is not implementation or acceptance evidence. It extends Phase2 without removing operational resolutions, frozen reports or supervised cutover acceptance from scope.

## Membership and denominator

The existing binding mutation serializes each scope's predecessor chain and requires the exact current predecessor. The live summary therefore uses the terminal binding (no successor) of each required scope. Keep excluded, unsupported and required-but-unbound scopes in the denominator. Show historical binding counts separately; a replacement never deletes earlier evidence. Do not sum historical and terminal binding occurrence counts into one progress numerator.

Global source identity is `(source_origin, source_site_uid, resource, external_id)`. Global snapshot identity adds `snapshot_id`; an observed source version additionally includes its recorded head when available. The same child can participate in more than one scope, so count unique physical observation keys separately from scope membership. For attachment observations the physical key includes child/page/ordinal/snapshot; other ledgers preserve only child/page/snapshot. Preserve that fidelity label. Contact/animal observations are filtered to the manifest-selected external identity, as in the existing item RPC.

The live endpoint must evaluate membership, observations and approval/currentness joins in one SQL statement snapshot. Do not aggregate independently fetched frontend pages into a purported global snapshot. Count/JSON output must remain bounded to the manifest's maximum100 scopes and fixed resource/outcome categories, with indexed joins over observations. If the full statement cannot meet the performance budget on maximum-sized manifests, implement explicit durable chunked preparation rather than silently truncating rows or returning sampled counts. That preparation is also the basis for the later frozen report.

## Distinct measurements

Expose separate named metrics, never one additive completion total:

- Scope dispositions and bound/unbound required scopes.
- Terminal-binding scope memberships, unique child runs, physical observed occurrences, distinct source identities, distinct snapshots, and observed-version fidelity gaps.
- Scan traversal ended, unfinished, page-limited, cooling down and failed-attempt history. Unknown provider total remains null, including for zero observed rows.
- Approved evidence versions, latest unsuperseded evidence versions, exact observation-version matches, same-snapshot/unknown-observed-version matches, stale source contexts and independent local edits.
- Distinct native outcomes grouped by native type and ID. Do not add native records to imported-history approval versions or to observation counts.

Facets overlap. A receipt can be latest, stale and locally edited at once. An acknowledged source change can coexist with a stale original approval. No sum of these facets represents a population or a completion percentage.

## Resource joins and outcome credit

| Resource | Evidence and deduplication | Native outcome accounting |
| --- | --- | --- |
| Contact/animal | Exact declared immutable record link; retain unknown observed head even for equal snapshots. Mapping source currentness and current household association remain separate. | Distinct client/pet IDs, with create versus link receipt counts separate. |
| Healthstatus | Exact source identity, patient mapping and patient; one immutable weight approval plus separately counted source acknowledgments. | Distinct `weight_id`; two approved source identities linked to the same weight remain one local measurement. Acknowledgments add zero local outcomes. |
| Consult | Scoped observed consultation snapshot/head and its parent-context use in canonical review ledgers. No standalone consult-approval ledger exists. | No inferred encounter, consultation approval, or signature. Report `approval_not_applicable` for standalone consult approval, not pending fabricated clinical work. Coverage remains assessable independently. |
| History | Approved imported-history version, exact snapshot/head/hash, supersession and canonical currentness. Track problem-extraction provenance independently. | Distinct linked native problem IDs; several history sources or extraction receipts must not multiply one problem. Native edits remain visible. |
| Vaccination | Imported vaccination history versions with exact consultation and mapping evidence; preserve outside-status/date/product facets. | Do not infer administration, certificate or adopted due plan. Those require their own native provenance. |
| Prescription | Approved outside prescription history version, completeness and canonical whole-context currentness. | No local prescribing, dispensing, billing or inventory credit. |
| Prescription item | Selection/omission against the exact approved parent revision and selected item snapshot/head. Different parent/version and unobserved item remain distinct. | Selection does not create another prescription approval or medication outcome. Deduplicate parent approval versions shared across item observations. |
| Attachment | Exact metadata/file/raw/stable identity, owner-visible capture evidence, immutable byte approval version, supersession and canceled-unconfirmed decisions. | Ready captured bytes are not approval. Count distinct approved original-record IDs/versions separately from capture attempts; do not infer a native document unless canonical provenance proves it. |

A current-source check does not establish current local eligibility. Preserve local record changes, patient-household association, mapping/parent drift and clinical interpretation status as separate facets. Retain the existing item drill-down as the explanation for every summary category.

## Security and future report boundary

Authorize active administrator and owned manifest/terminal bindings/child runs before projection and recheck active status before returning. No raw source payloads, clinical prose, private request drafts, storage paths or provider credentials leave this summary. Reads must not claim leases, advance source cursors, approve clinical work, dismiss discrepancies, or enqueue delivery.

The response must say `complete_coverage_verified: false` and `cutover_accepted: false`. Live `observed_at` is not a source cutoff. Later operational resolutions must bind exact evidence hashes and preserve predecessors; they cannot erase required scopes. Frozen reports must persist the reviewed scope/binding/input digests, bounded complete chunk set and explicit coverage exceptions, then recheck exact evidence at acceptance. This live summary cannot substitute for those requirements.

## Acceptance matrix for implementation

Test repeated pages, overlapping scopes sharing one child, predecessor replacement, changed/reverted snapshots, same snapshot with unavailable observed head, unbound/excluded/unsupported scopes, empty scans without coverage proof, stale mapping/parent/household, canceled/superseded approval, two source weights linked to one measurement, multiple histories linked to one problem, shared prescription parent across items, partial/missing references, captured-but-unapproved original bytes, foreign/inactive administrators, concurrent source change during the statement, unchanged native records and zero provider/delivery effects. Check all supported resource categories; narrow weight tests alone cannot prove this global projection.


## Local source-layer checkpoint

The uncommitted114-migration candidate contains an internal, invoker-only `ezyvet_migration_terminal_observations` query. It selects terminal required bindings and returns canonical source identity/evidence hashes with scope membership preserved. All public/anonymous/authenticated/service-role execution grants are revoked. The disposable stack passed48 SQL assertions (30 existing identity assertions plus18 internal-projection/source-total assertions) and141 existing migration HTTP regressions; cleanup verified. The internal query has no HTTP grant and those141 checks do not establish global-summary behavior. Outcome joins/counts, all-resource projection coverage, summary endpoint/UI, performance validation, resolutions and frozen reports remain unimplemented. Do not deploy this partial migration as the global-summary feature.

The internal source-total query now separates resource scope dispositions, unbound required scopes, unique child runs, memberships, physical occurrences, source identities/snapshots and missing observed heads. Historical binding counts and unknown provider totals remain explicit. Neither internal function is exposed as a public summary RPC.


## Local standard-receipt checkpoint

The internal `ezyvet_migration_terminal_standard_receipts` now projects contact/animal approvals, weight approvals and separate source acknowledgments, imported history, vaccination and prescription-header versions. It preserves observation relationship, canonical currentness, supersession, native identity where applicable, local edits and household association. Invoker-only; all application-role grants remain revoked. Native problem extraction, prescription-item context and attachment receipts are still required before complete aggregation/public exposure.

Latest disposable validation:53 source/identity SQL assertions and63 weight/standard-receipt SQL assertions passed. The migration integration harness passed145 checks:141 existing checks plus four internal summary comparisons against approvals created through actual Auth/PostgREST (history source drift, vaccination without native administration, prescription corrections, no native prescribing credit). Cleanup verified; no provider calls. The privacy assertion now checks forbidden JSON field names instead of a numeric regex that could match random UUID characters. The116 SQL assertions include the reused canonical identity/weight fixture assertions, not116 wholly new scenarios. Evidence is `docs/evidence/migration-global-source-local-20260915.json`. The114-migration global candidate remains uncommitted, incomplete and undeployed; hosted backends remain113.


## Local context/native projection checkpoint

Internal context receipts now preserve approved parent prescription revisions with item selection/omission, parent agreement and currentness; attachment request/byte/approval/canceled-decision stages remain separate. Native outcomes retain client/pet/weight identities and exact problem-extraction provenance with later local-edit detection. No public grants or summary UI exist yet.

Validation passed53 source/identity SQL assertions,63 standard/weight assertions,55 attachment/context assertions and, in a separate disposable run,30 history/native assertions. Both runs passed150 integration checks:141 existing checks plus nine internal projection comparisons against canonical HTTP-created fixtures. All disposable cleanup verified. Artifacts are `migration-global-context-local-20260915.json` and `migration-global-native-local-20260915.json`. These include reused canonical assertions; counts are not wholly new scenarios. The second run used64421 because63421 was occupied; no unrelated process was stopped.

Approved attachment history now includes other authorized staff reviewers, while unfinished capture requests, captured-but-unapproved bytes and cancellation work remain private to their owner. Shared approval facets omit private request/capture identifiers. The canonical source-currentness check does not depend on capture ownership; tests cover both current and stale parent context without removing approved history or granting access to another administrator’s manifest. Remaining work also includes all-resource/global overlap aggregation, unknown/non-applicable facets, native edit versus patient-version distinctions, source/capture/reference coverage gaps, performance and concurrency acceptance, endpoint/UI, operational resolutions and frozen report acceptance. Local114 remains incomplete and must not be deployed as the global-summary feature.


## Shared approved-original visibility checkpoint

The cross-staff approval correction passed61 SQL assertions (including the reused canonical capture fixture) and150 integration checks:141 existing checks plus nine internal projection comparisons. The SQL checks verify approved history visibility across reviewers, private unfinished capture work, foreign-manifest denial, omitted private capture identifiers, and freshness before/after parent-head drift. All source and migration hashes in the sanitized receipt match the local files. Cleanup completed with zero provider requests. Evidence: `docs/evidence/migration-global-shared-approval-local-20260915.json`. This validates the internal projection only; the full aggregation/public endpoint, performance/concurrency acceptance, UI, operational resolutions and frozen report remain unfinished. Hosted backends are unchanged.


## Internal outcome aggregation

`ezyvet_migration_outcome_totals` combines standard and context receipts by `(receipt_kind, receipt_id)` before counting. This identity is shared by prescription headers and their item contexts, preventing a parent approval from multiplying across selected items. Source acknowledgments, capture attempts, captured bytes, original approvals and cancellation decisions retain separate kinds. Native totals group `(native_kind, native_id)` independently, preserving local-edit flags without adding source receipts to local-record counts. Exact-version match and unknown-observed-head snapshot match remain separate, potentially overlapping facets across bound observations. Unknown or foreign manifests return null rather than an empty success. The helper is invoker-only and application-role execution stays revoked. It is not the public summary; scan/source/context gaps, full mixed-resource coverage, performance/concurrency, endpoint/UI and frozen-report work remain.

Local aggregation validation passed70 standard/weight,36 history/native and68 attachment/context SQL assertions, plus150 integration checks (141 existing checks and nine internal projection comparisons). The SQL suites include reused canonical fixtures; these are not174 new scenarios. Source/migration hashes match the recorded receipt, cleanup succeeded and provider requests remained zero. Evidence: `docs/evidence/migration-global-aggregate-local-20260915.json`. The outcome-total assertions cover weight deduplication, independent acknowledgments, native problem edits, immutable history revisions and capture/approval separation. Mixed header/item aggregation, maximum-manifest performance and concurrency remain unproven. Local migration114 remains incomplete and undeployed.


## Prescription header/item aggregation

The outcome summary now reports prescription-item relations independently by disposition. Relations deduplicate `(approval_id, evidence_hash, disposition)` across scope membership, while approval totals deduplicate `(receipt_kind, receipt_id)` across headers and items. This preserves predecessor omissions and corrected selections without adding native prescribing credit. A combined two-scope manifest is created and bound through the actual authenticated API; internal totals are compared against those canonical approvals. The initial fixture incorrectly reused persisted scope objects as requests; strict request validation rejected the additional saved fields. The fixture now reuses the immutable request intent, retaining strict API validation.

Validation passed156 integration checks:141 existing checks and15 internal projection/aggregate comparisons against actual HTTP-created fixtures. The six added comparisons verify two shared approval revisions count once each, one latest revision, source drift on both revisions, separate omission/selection relationships, no native prescribing and foreign-manifest denial. Cleanup verified and zero provider requests; recorded source/migration hashes match. Evidence: `docs/evidence/migration-global-prescription-aggregate-local-20260915.json`. This run used65421 after64421 was occupied; no unrelated process was stopped. The remaining public-summary, performance/concurrency, UI, resolutions and frozen-report requirements are unchanged.


## Internal scan aggregation

`ezyvet_migration_scan_totals` selects terminal bindings of required scopes and deduplicates child runs before counting scan states, observed pages and canonical attempt events. Historical bindings remain in source totals rather than inflating current scan progress. Traversal-ended, unfinished, page-limited, cooling-down, active-lease and latest-error facets are separate and may overlap. Parent/household drift counts apply to scopes, while complete/missing attempt-history counts apply to unique children. Provider total stays null; ended traversal never sets coverage or cutover acceptance. The function remains internal with all application-role execution revoked. It does not claim leases, change cursors or enqueue delivery.

Scan validation passed62 SQL assertions (53 prior source/identity checks plus nine scan-summary assertions) and156 integration checks (141 existing checks and15 internal comparisons). Terminal child selection, predecessor page exclusion, traversal/coverage separation, page-limit and cooldown states, unknown-manifest null and private execution grants were verified. Cleanup succeeded with zero provider calls, and receipt source/migration hashes match. Evidence: `docs/evidence/migration-global-scan-local-20260915.json`. Failed-attempt deduplication, overlapping scope counts and mixed-resource performance/concurrency still require broader tests before public exposure; this is not full scan acceptance.


## Maximum scope-count shared-scan fixture

The initial duplicate-scope fixture was rejected by the canonical unique scope constraint. That safeguard remains unchanged. The corrected fixture uses100 distinct animal identity mappings,98 required scopes, one excluded and one unsupported;96 required scopes bind one generic animal scan and two remain unbound. Synthetic immutable identity links are seeded locally; manifest preparation, binding, source staging and failure/retry transitions use the actual HTTP APIs. Expected totals are96 selected observations, one scan, two pages, one failed page, three claims,96 mapping receipts and one linked local patient. All three aggregates are checked in one statement against a five-second local wall-clock bound. This is a sparse maximum-scope fixture, not maximum source-volume or hosted performance acceptance.

Validation passed165 checks:141 existing checks and24 internal comparisons, including nine new maximum-scope/shared-scan assertions. The sparse100-scope aggregate passed the five-second bound including command overhead; no exact duration is retained in this receipt. Cleanup succeeded, provider requests remained zero and source/migration hashes match. Evidence: `docs/evidence/migration-global-shared-scan-local-20260915.json`. This proves shared child/page/attempt deduplication across distinct identity scopes, not duplicated identical scopes (which the manifest forbids), full-volume performance or concurrent snapshot consistency.


## Weight patient-version and record-action facets

Outcome aggregation now compares weight approvals against the recorded patient version separately from immutable measurement equality and household association. `changed_patient_versions` is currently applicable only to weight approvals; zeros for other receipt kinds do not establish patient-version verification. Create/link receipt counts apply to identity mappings and weight approvals and never to source acknowledgments. Native outcome totals still deduplicate local record IDs independently. Public presentation must preserve these applicability limits rather than labeling every zero as unchanged or verified.

Validation passed77 standard/weight SQL assertions (70 existing plus seven patient-version/action assertions) and165 integration checks. Patient edits, measurement equality and household association remained separate; create/link and acknowledgment credit matched canonical receipts. The100-scope sparse performance check also passed after enrichment. Source/migration hashes match, cleanup succeeded and provider requests were zero. Evidence: `docs/evidence/migration-global-patient-context-local-20260915.json`. Hosted state is unchanged and full-summary acceptance remains incomplete.


## Observation review gaps

`ezyvet_migration_review_totals` deduplicates observed evidence hashes per resource, then separates observations without any approval, exact approved-version matches, snapshot-only/unknown-head matches, and current unsuperseded exact matches. Acknowledgments, pending requests and captured bytes are excluded from approval credit. Prescription selection/omission uses exact parent and item source evidence. Standalone consultation approval metrics are null with explicit `not_applicable`, including unbound consultation scopes. Scope resources with no observations remain represented; coverage and cutover stay false. These are overlapping observation facets, not approval-version totals or a completion percentage. The helper remains private and read-only.

Validation passed171 checks:141 existing checks and30 internal comparisons, including six review-gap assertions. Prepared attachments remain unapproved, snapshot-only weight approval stays distinct from exact version verification, acknowledgment cannot upgrade original approval, historical exact match survives drift without current credit, prescription revisions do not multiply an item, and an unbound consultation has no fabricated approval work. Source/migration hashes match; cleanup succeeded with zero provider requests. Evidence: `docs/evidence/migration-global-review-gaps-local-20260915.json`. The100-scope timing assertion still covers source/scan/outcome helpers only; review-gap large-volume performance and combined snapshot concurrency remain outstanding before public summary exposure.


## Combined read and concurrent source changes

The private stable `ezyvet_migration_global_projection` composes source, scan, outcome and review-gap helpers under the calling statement snapshot. It is not a public RPC: application-role grants remain revoked and a future public boundary still needs post-read authorization revalidation. The integration fixture holds an advisory lock in one real database connection, observes a second connection waiting on that lock inside its summary statement, commits source-head changes in a third connection, then releases the reader. It compares the held projection with a fresh projection for consistent pre/post-change currentness while preserving historical observation identity. No provider or hosted database is involved.

The combined response identifies the immutable request with `intent_hash`; it must not label that value as the resolved `scope_manifest_hash`. Those digests cover different evidence. A dedicated assertion verifies the distinction. The full combined projection, including review gaps, is now included in the sparse100-scope five-second check. This does not replace maximum-source-volume validation.

Combined validation passed243 SQL assertions across source62, standard77, context68 and native36 suites, plus176 integration checks (141 existing and35 internal comparisons). A verified advisory-lock wait proved the summary statement retained consistent pre-change source/parent currentness during an independently committed source-head update; a fresh statement reflected the update. Full combined projection passed the sparse100-scope five-second bound. Request intent digest labeling is asserted. Cleanup succeeded, provider requests were zero and source/migration hashes match `docs/evidence/migration-global-snapshot-local-20260915.json`. Maximum source-volume, source/reference/capture applicability gaps, public authorization recheck and endpoint/UI, operational resolutions, frozen reports and supervised cutover remain unfinished. No hosted deployment occurred.


## Approved prescription gaps

Outcome totals now carry bounded `prescription_review_gaps` counts deduplicated by immutable approved revision across header/item scopes. These preserve partial and latest-partial revisions, unresolved references, absent source lists, unfinished scans, missing/unexpected items, duplicate source/observed references, invalid references, and unknown reviewed date/status. Counts describe versions exhibiting each overlapping facet; they do not sum missing item IDs across revisions or disclose clinical prose/review reasons. Finished source traversal can coexist with missing references and partial approval. No prescribing, dispensing, inventory or billing credit is inferred.

Validation passed182 integration checks (141 existing and41 internal comparisons), including six new prescription-gap assertions against actual HTTP-created partial approval/correction fixtures. Header/item deduplication, latest partial revision, missing/unresolved references, duplicate source versus observed references, unknown date/status, completed scan with unresolved references and omission of prose were checked. Combined snapshot-concurrency and sparse100-scope timing checks also passed. Source/migration hashes match; cleanup succeeded with zero provider requests. Evidence: `docs/evidence/migration-global-prescription-gaps-local-20260915.json`. Large-volume validation, remaining applicability/capture facts, public endpoint/UI, resolutions, frozen reports and external commissioning remain open.


## Capture states and assessment applicability

Outcome totals now expose owner-private capture request counts by canonical status, stale request contexts, captured originals, approved-original versions and unconfirmed cancellations as distinct quantities. Shared approved history remains visible across reviewers without revealing their unfinished requests. The response explicitly says byte retrievability was not checked and `original_bytes_reverified` is false; database receipts cannot replace protected original download/verification. Patient-version and household-change facets now include assessed-version denominators, so an unassessed zero cannot be presented as verified unchanged.

Validation passed76 context and79 standard SQL assertions (including ten new capture/applicability checks), plus182 integration checks. Tests cover prepared/ready separation, request-source drift, one capture versus two approvals, explicit unverified retrievability, private other-reviewer request counts, shared approvals and patient-version assessment denominators. Combined concurrency and sparse100-scope timing also passed. Cleanup verified, zero provider requests, matching source/migration hashes. Evidence: `docs/evidence/migration-global-capture-states-local-20260915.json`. Original byte retrieval acceptance, maximum source-volume validation, public endpoint/UI, resolutions and frozen reports remain unfinished; no hosted deployment occurred.


## Full single-scan observation volume

The shared identity fixture bulk-seeds998 additional pages after its two canonical HTTP-staged pages:1000 pages and50000 physical observations total. Ninety-six bound identities yield48000 selected observations,96 immutable mapping approvals and one local patient. Combined projection completed inside a10-second statement timeout and wall-clock assertion, preserving all selected observations and snapshot-only unknown-head relationships. Validation passed186 checks (141 existing and45 internal comparisons), cleanup succeeded and provider requests were zero; receipt source/migration hashes match `docs/evidence/migration-global-full-scan-local-20260915.json`. Bulk-seeded pages are performance fixtures, not evidence of1000 actual provider fetches or corresponding lease/cursor/attempt transitions. This proves one full shared run, not100 independent full runs, mixed-resource maximum volume, hosted latency or supervised acceptance. Exact execution time is not retained; only the asserted bound.


## Maximum independent-run experiment

`supabase/tests/ezyvet_migration_maximum_volume.test.sql` seeds100 independent healthstatus runs at1000 pages and50 observations per page:5000000 rows total. It uses canonical owned manifests/bindings and synthetic approved mappings, seeds current heads once, and temporarily disables only the redundant identity-observation trigger while inserting repeated unchanged snapshots inside a rollback transaction. All other table constraints remain enabled. The query budget remains10 seconds; the fixture must not be treated as passing until the timed full projection succeeds. This is synthetic summary capacity testing, not provider traversal, clinical approval or cutover acceptance.

Maximum independent-run result: the fixture verified5000000 observations, but full projection exceeded the10-second statement timeout inside `ezyvet_migration_terminal_observations`. The SQL connection terminated and the runner stopped/removed its owned database container; no provider requests or hosted writes occurred. Sanitized failure evidence is `docs/evidence/migration-global-maximum-volume-failure-20260915.json`. This contradicts full-volume live-query acceptance. Do not widen the time budget or deploy the private projection as the completed summary. The required next implementation is bounded resumable preparation with explicit change detection, followed by complete chunk aggregation and frozen-report acceptance. Existing small/full-single-run successes remain valid only for their tested scopes.


## Bounded extraction implementation

`ezyvet_migration_observation_window` pushes binding and page predicates into each canonical observation ledger before evidence hashing. The private `ezyvet_migration_observation_chunk` validates a non-null manifest/binding, first page1–1000, and at most20 pages without crossing1000. It returns deterministic page/ordinal/snapshot ordering with canonical hashes and existing active-owner/terminal-binding guards. All application-role execution remains revoked. See [resumable preparation contract](resumable-preparation-contract.md) for durable state, consistency, finalization and acceptance still required.

The first combined run passed68 source/chunk SQL assertions and all three five-million-row fixture assertions (population count plus first/last1000-observation windows within10 seconds). Its later50,000-row full-projection integration check timed out, so that whole run is not accepted. A fresh isolated run is required to separate query regression from large rollback fixture effects; do not report the combined run as passing.

The fresh run reproduced the full-query slowdown. Restoring the direct full-projection body while retaining separate bounded extraction fixed it:68 SQL assertions and186 integration checks now pass, including the50,000-observation ten-second check. Evidence: `docs/evidence/migration-bounded-observations-local-20260915.json`. Both bounded function bodies were compared byte-for-byte with the retained migration from the five-million-row fixture and are unchanged; its three passing assertions are recorded separately in `docs/evidence/migration-bounded-maximum-volume-local-20260915.json`, explicitly not marking that original whole run successful. The full and bounded query bodies differ only in page/binding predicates. Durable progress/chunks, global deduplication, complete traversal and change-detection/finalization remain unimplemented.
