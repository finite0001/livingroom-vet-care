# Operational migration exclusions and reopen decisions

Status: **implemented and locally verified**. The canonical identity/weight stack is integrated. Scope and observation exclusions/reopening, exact recovery, history, strict API validation and guarded UI are implemented. [Local evidence](../../docs/evidence/canonical-migration-resolutions-20260916.json) records 616 unit tests, 51 browser tests and 756 disposable checks. [Restore evidence](../../docs/evidence/migration-resolutions-restore-20260916.json) separates successful verification from the cleanup error and its verified recovery. A separate test-only supplemental run passed 465 checks, including all three additional planned contention cases; overlapping counts are not additive. No hosted deployment or supervised cutover acceptance is claimed. The contract below remains the acceptance checklist.

Parent requirements: [full implementation contract](implementation-contract.md), especially phases 2–3; [overall plan](plan.md); [ledger map](ledger-map.md). This increment completes the operational disposition workflow only. The owner has retired the remaining integration/report roadmap. See [standalone direction](../../docs/standalone-platform-direction-20260916.md); historical follow-up requirements below do not authorize further integration work.

## Current evidence and design choice

The checked implementation has immutable manifests/scopes, replaceable append-only child bindings, durable child attempt events, bounded source observations and per-resource receipt adapters. At planning time, no operational resolution or migration report table/API existed; this phase adds the resolution contract only. Original scope exclusions are immutable manifest declarations. Existing clinical approvals, corrections and acknowledgments have separate authority and must remain unchanged.

Use append-only `exclude` and `reopen` decisions for **both scopes and exact observations**. An item-only tool cannot address a required scope with no run, an unavailable resource or a failed scan with unseen records. A mutable status column would lose decision history and exact retry identity. A global “resolved” flag would conflate clinical approval with administrative exceptions.

`exclude` means operationally omitted from this migration. It does not mean clinically rejected, deleted, imported, reviewed or safe. `reopen` supersedes an exclusion; it does not resume a scan or undo any clinical record. Original required/excluded/unsupported scope declarations remain visible. Excluding a required scope creates an explicit coverage exception and **never establishes complete migration coverage**.

## Data contract

Create append-only `ezyvet_migration_resolutions` with:

| Field | Contract |
|---|---|
| `id` | Caller-generated request UUID; immutable exact-recovery identity |
| `actor_id` | Server-derived `auth.uid()`, active ADMIN and manifest owner |
| `migration_run_id`, `scope_id` | Exact owned immutable manifest/scope |
| `target_kind` | `scope` or `observation` |
| `binding_id`, `page`, `ordinal`, `snapshot_id`, `evidence_hash` | All required for observation target; all null for scope target |
| `action`, `reason` | `exclude` or `reopen`; trimmed reason, 1–2000 characters |
| `request_hash` | Versioned digest of exact normalized operation inputs, including expected context hash and predecessor |
| `reviewed_context`, `reviewed_context_hash` | Explicit versioned server-derived operational context; references and necessary safe summaries only |
| `replaces_id`, `version` | Exact preceding decision for same target; sequential target-local version |
| `record_hash`, `created_at` | Immutable receipt digest and server timestamp |

Stable target key: scope UUID for scope decisions; binding UUID plus fixed occurrence identity/hash for observation decisions. Do not include mutable currentness in the chain key. A changed source must supersede or stale a decision, not manufacture another root.

Enforce one root per target, unique predecessor replacement, predecessor ownership/target membership and sequential versions. `reopen` requires a preceding `exclude`; repeated exclusions may supersede stale exclusions with fresh evidence/reason. Scope decisions may address an original excluded/unsupported scope, but reopening them only reopens operational review: it cannot make an unsupported contract importable or change the immutable manifest. The UI must explain that a new supported manifest is required to change the original scope contract.

Enable RLS, revoke direct table privileges from PUBLIC/anon/authenticated/service_role, use the existing immutable-history trigger and narrowly granted owner/admin RPCs. Index target history and scope history by `(created_at DESC, id DESC)`; index predecessor uniqueness and root uniqueness. Never add worker execution permission.

## Evidence identity and mutable dependencies

The current source-item `evidence_hash` is a fixed v1 **occurrence identity**. It does not include current heads, current household, binding replacement or scan progress. Keep it unchanged and introduce a separate `operational_context_hash`.

Build the context from explicitly named fields with canonical JSONB and a version field. Do not hash `to_jsonb(row)`: future columns must not silently invalidate old receipts. Retain nulls where evidence is unavailable.

Common context pins:

- Resolved immutable manifest hash and exact scope identity/original disposition.
- Current binding ID and immutable binding context hash, or explicit no-binding state.
- Saved mapping ID, snapshot/head, source origin/site and saved local household/patient identities.
- Current mapping-source and parent-source head snapshot/version; absent heads represented explicitly.
- Current client/pet IDs and versions and current patient-to-household relationship, including missing targets.
- Current child status, next page, durable retry/error state and latest immutable attempt-event sequence; null child fields when no binding exists.

Observation context additionally pins exact binding/occurrence hash, page/ordinal/snapshot, source identity, current source snapshot/head, recorded observation head or null, and applicable attachment file/raw/stable metadata identities. A historical binding can be inspected and receive a decision explicitly marked historical; it cannot inherit the current binding's authority or affect that new binding's occurrences.

Do not hash wall-clock `observed_at` or a time-derived `lease_active` flag. Persist durable lease-boundary values only if they are actually part of the displayed review contract; do not expose lease tokens. A change in actual child attempt sequence already invalidates reviewed progress.

This hash is **not** a clinical-outcome or frozen-report digest. Clinical approvals, corrections, extraction receipts and original-byte verification remain independently displayed, and are not certified by an operational exclusion. Include explicit response flags `clinical_approval_performed: false` and `complete_coverage_verified: false`. Report acceptance must later bind clinical receipt/capture digests separately. New clinical approval alone does not undo an intentional operational exclusion.

A scope context pins its declared extent and current attempt progress, not every unseen source record or every clinical approval. Its exclusion cannot imply all underlying observations were individually reviewed. Failed/unfetched pages remain unknown coverage.

## RPCs, recovery and concurrency

1. `read_ezyvet_migration_resolution_context(target)` returns canonical context/hash, exact current resolution head and safe staleness facets. Validate owned scope and, for observation targets, the exact canonical observation and resource-specific scope. Never trust browser-computed hashes.
2. `save_ezyvet_migration_resolution(id, target, action, reason, expected_context_hash, replaces_id)` appends one decision. Normalize and validate exact fields; reject unknown/partial target inputs and unsupported actions.
3. `read_ezyvet_migration_resolution(id)` returns an owned immutable receipt or null. Historical recovery must not depend on evidence still being current.
4. `list_ezyvet_migration_resolutions(scope, optional target, before_at, before_id, limit)` returns bounded history, latest/superseded state and independent current-context comparison. Default 20, maximum 100, sentinel pagination, paired cursor fields and microsecond precision.

Save sequence:

1. Check active owner and bounded inputs; compute request hash.
2. Acquire request advisory lock, then recheck active owner.
3. If that request exists, require exact actor/target/action/reason/predecessor/expected-context identity. Return the original receipt even after source drift. Changed same-UUID inputs fail. Recovery is not a new decision.
4. For a new request acquire `ezyvet-migration-scope-binding:<scope_id>` (the existing binding writer's lock), then a target-resolution advisory lock. Use this order in every new resolution writer. Never call child claim/resume functions while holding these locks.
5. Recheck active owner after waits, validate exact current predecessor and target membership.
6. In one post-wait statement snapshot, recompute canonical operational context, compare the expected hash and append the receipt only on equality. Stale evidence/predecessor returns `40001`; invalid inputs `23514`; unauthorized identity `42501`.
7. Recheck active ADMIN before returning. No source, native record, binding, cursor, lease, stock, invoice or outbox mutation is performed.

**Linearization limit:** the post-wait statement snapshot is the decision's evidence point. Another source writer can commit immediately afterward; the saved decision is then historical/stale on fresh inspection. This is acceptable for a nonclinical operational receipt and must be explicit. Returning a receipt does not guarantee all mutable evidence remains unchanged until commit or afterward.

Do not claim stronger isolation from a new advisory lock used only by resolution RPCs. Native writers do not take that lock. Avoid ad hoc patient/head row locks: existing source and clinical writers take those locks in different orders. A stricter commit-wide guarantee would require a separately designed shared lock protocol across affected writers, with real deadlock/contention tests. Report sealing/acceptance must design its own consistency protocol rather than inherit an overstated guarantee here.

## Operator interface and draft state

At `/hub/tools/ezyvet`, add a scope decision section inside `ScopeBindings` and an observation decision section inside expanded `SourceEvidence`. Preserve existing controls, per-resource evidence and patient/household links.

The review screen must display target extent, source/site, saved patient/household, immutable required/excluded/unsupported disposition, current warnings, prior decision, proposed action and reason. Require explicit confirmation that exclusions leave coverage incomplete. Retain unknown head fidelity for legacy records. Label failed/unseen coverage as unknown, not zero.

Use a strict API/state layer. Compose dirty state with binding/resume forms and existing route/unload guards. Disable competing scope/binding/observation changes while a draft or uncertain mutation exists. Selecting a new target/actor creates fresh keyed state; sign-out clears private state and late replies cannot restore it.

On save, freeze request UUID and exact payload. A transport failure enters recovery-first state and locks editing. Read recovery validates the original receipt completely. Null recovery permits an identical retry, not a new UUID. Confirmed database rejection unlocks review with refreshed context; success clears draft and refreshes target/history. Do not persist reasons, clinical data or full request bodies in browser storage; optional persisted pointers must be actor-scoped opaque IDs only. Server history restores committed decisions after browser state loss. Unsaved drafts are not advertised as durable.

History distinguishes superseded decisions, stale reviewed context and current operational exclusion. Never hide an underlying approved record because an operational item is excluded. Never silently carry a single-occurrence decision to another occurrence, source version or replacement binding. Scope exclusion and observation decisions may overlap; display precedence as scope exception plus item facts, not additive migrated totals.

## Files and implementation sequence

Repository root for this planned work: `/Users/davidedler/livingroom-vet-migration-decisions` (all paths below are beneath it). No existing files are to be deleted.

| Action | Path | Purpose/dependency |
|---|---|---|
| Create via Supabase CLI | `/Users/davidedler/livingroom-vet-migration-decisions/supabase/migrations/<new-version>_ezyvet_migration_resolutions.sql` | Table, context helper, bounded owner RPCs and grants; reserve version only after rechecking canonical branches/ledger |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/supabase/tests/ezyvet_migration_resolutions.test.sql` | Real schema/receipt/access/side-effect assertions |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/supabase/tests/ezyvet_migration_resolutions_concurrency.py` | Observed lock waits, predecessor/request races, binding/source changes and role revocation |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/src/hub/features/imports/migration-resolution-api.ts` | Strict request/response/hash/owner/cursor validation |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/src/hub/features/imports/migration-resolution-state.ts` | Exact frozen-request recovery and stale-response isolation |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/src/hub/features/imports/MigrationResolutionForm.tsx` | Target review, reason, exclusion/reopen, uncertainty recovery |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/src/hub/features/imports/MigrationResolutionHistory.tsx` | Bounded immutable decision history and currentness facets |
| Modify | `/Users/davidedler/livingroom-vet-migration-decisions/src/hub/features/imports/EzyVetMigrationRuns.tsx` | Scope/item composition and combined dirty guards |
| Create | `/Users/davidedler/livingroom-vet-migration-decisions/tests/ezyvet/migration-resolution-api.test.ts` and `migration-resolution-state.test.ts` in the same directory | Contract, pagination and exact recovery state tests |
| Modify | `/Users/davidedler/livingroom-vet-migration-decisions/e2e/migration-workspace.spec.ts` | Desktop/mobile lifecycle, historical exclusions and navigation guards |
| Modify | `/Users/davidedler/livingroom-vet-migration-decisions/tests/ezyvet/migration-local-roundtrip.ts` | Actual Auth/PostgREST create/read/list/retry and preserved effects |
| Modify | `/Users/davidedler/livingroom-vet-migration-decisions/tests/ezyvet/attachment-metadata-disposable.py` | Deliberate canonical inventory/source hashes; preserve full fixture sequence |
| Modify | `/Users/davidedler/livingroom-vet-migration-decisions/scripts/restore-rehearsal/run.py` and its populated fixture/verification SQL | Preserve populated resolution chains, hashes, permissions and existing private Storage |
| Modify | `/Users/davidedler/livingroom-vet-migration-decisions/.github/workflows/ci.yml` | Run new observed concurrency gate using existing owned test conventions |
| Create after verification | `/Users/davidedler/livingroom-vet-migration-decisions/docs/evidence/canonical-migration-resolutions-<date>.json` | Exact revision/hash/command/results/limitations receipt |

Implement sequentially: reconcile canonical stack → SQL contract and observed races → strict API/state → guarded UI/history → real runtime/full sequence → populated restore → independent review and stacked PR. A database-only or happy-path-only change does not complete this workflow.

## Validation and completion gates

- [ ] Same UUID exact retry; changed same-UUID payload rejected; historical recovery after source/head/household drift; lost replies recovered without duplicate decisions.
- [ ] Simultaneous roots and same-predecessor decisions produce one chain; rejected contender gets an explicit conflict.
- [ ] Observed request/target lock waits demonstrate role revocation, binding replacement and source/page advancement are rechecked. No sleep-only concurrency claims.
- [ ] Foreign owner/site/patient/binding/observation/hash denied; active non-admin, inactive admin, anon and service denied; no direct table mutation.
- [ ] Required scope with no binding, failed/page-limited/unfinished scan, unsupported scope and missing provider total remain incomplete after exclusion.
- [ ] Exact occurrence targets preserve duplicates; source A→B→A and legacy unknown observation head remain truthful; decisions do not migrate to replacement bindings.
- [ ] Reopen preserves earlier exclusion; superseded/stale history remains readable; no clinical promotion/signing/prescribing or native record/stock/invoice/Storage/outbox effects.
- [ ] Keyset history handles timestamp ties/microseconds, sentinels, wrong identities and malformed responses.
- [ ] Browser checks at 390px and 1440px cover error/empty/loading, draft navigation, uncertain save, identical retry, server recovery, actor change and sign-out during pending response.
- [ ] `npm run check`; relevant browser suite; new SQL/observed concurrency suites; exact disposable `--fixture all` against the final canonical stack. Inspect every result; record counts by suite rather than conflating mocks and live API evidence.
- [ ] Populated backup/restore preserves resolution roots/predecessors/context hashes, earlier migration/clinical records and physical Storage; complete canonical count/hash checks updated deliberately.
- [ ] Independent review and an evidence receipt distinguish local acceptance from hosted rollout. No provider calls are needed for these tests.

## Rollout, risks and follow-up

This plan authorizes no hosted changes. Later coordinated deployment must re-read the canonical migration ledger, create/verify the required backup and deploy compatible SQL/API/UI increments. On a rollout issue, hide/disable the new decision UI while retaining immutable receipts; do not delete approved history or rewrite old migrations. Existing import/review flows continue to use their original authority.

Primary risks: confusing exclusion with completed migration, treating observation identity as current evidence, silently retrying with a new UUID, cross-target predecessor chains, source-change races overstated as serialization, and unguarded scope switching during uncertainty. The contracts and gates above address each directly.

Historical follow-up, retired by the standalone direction: complete global distinct-identity/version/outcome accounting; frozen report requests with bounded continuation and exact resolution-head digests; report sealing and stale-evidence acceptance; supported source/export and cutoff strategy; disclosed exclusions/unsupported coverage; Dr. Susan Edler's clinical review and owner cutover acceptance. A reviewed operational exception cannot substitute for any of these.

Unresolved external inputs: authorized source subset, cutoff/overlap strategy and which exceptions the owner will accept for cutover. They do not block synthetic implementation. Stronger commit-wide source isolation is deliberately not claimed here; if demanded by report acceptance, specify the shared writer protocol before implementing that guarantee.
