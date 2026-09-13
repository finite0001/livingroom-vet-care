# Phase 3a — Consult-scoped vaccination intake

Priority: required next increment of Phase 3. Status: planned; no implementation or live-source acceptance claimed.

## Context and owner decision

The owner instructed us to proceed on the assumption of read-only ezyVet access. Dr. Susan Edler will ask the ezyVet representative about entitlement, the existing registration and any additional capabilities. This plan needs no two-way API and writes nothing back to ezyVet. Production source activation and authorized sample validation remain pending representative clarification; implementation can proceed with synthetic fixtures.

Living Room Vet remains the primary record system. This increment produces inspectable migration evidence only. It does not create local treatments, adopt vaccine due dates, issue certificates, decrement inventory, create charges or send reminders.

References:

- [Full Phase 3 scope](phase-03-complete-migration.md)
- [Existing source research](research/source-contracts.md)
- [Patient-scoped clinical ingestion contract](../../docs/plans/ezyvet-clinical-runs-contract.md)
- [Existing ingestion implementation](../../supabase/functions/ezyvet-import/adapter.ts)

The source research now records the Phase 1 consult/history limit-10 contracts. Recheck the official vaccination contract when implementing and record the date; do not treat public documentation as practice-sample acceptance.

## Smallest complete outcome

An active administrator selects an approved patient mapping, selects a current patient-scoped consult observation, starts a vaccination scan for that consult, recovers it after an interrupted response, and inspects raw staged vaccination candidates with their exact source association and freshness. Runs and candidates remain discoverable after browser state loss.

The documented source vaccination relationship is `consult_id`, not `animal_id`. Patient identity must follow the verified same-site chain: vaccination → scoped consult → approved animal mapping → local patient and household. Product references and source dates remain unresolved evidence in this increment.

One finished consult scan is not a complete patient migration or consistent source export. Display that distinction in the administrator workflow.

## Architecture and frozen boundaries

Use dedicated vaccination context/receipt tables and RPCs while reusing existing import runs, snapshots, identity heads, pagination, leases and provider cooldowns. Leave Phase 1 consult/history tables, CHECK constraints and API resource schemas unchanged. Simply adding vaccination to `patientScoped()` is incorrect: that helper currently sends `animal_id` and checks `payload.animal_id`.

Each vaccination run permanently binds:

- Original administrator, run UUID, source origin/site, resource `vaccination`.
- Approved animal-link ID, external animal ID, local patient and client IDs.
- Consult snapshot ID, payload hash, observed head version and external consult ID.

The consult must be a current validated scoped observation for that mapping, not merely a generic snapshot with a matching animal ID. A source A→B→A reversion cannot make an old scoped observation current. Freeze both snapshot identity/hash and observed revision.

## Implementation sequence

### 1. Freeze resource and request contracts

Confirm documented `GET /v1/vaccination`, `read-vaccination`, maximum 10 and `consult_id` filter against current primary documentation. Preserve administration/next-date, product, quantity and outside author fields as source values; do not infer epoch units, dose units, clinical date meanings or certificate eligibility. Require valid source identity/reference shapes; unknown or null optional clinical values remain visible rather than receiving fabricated defaults.

The browser request supplies run ID, resource, animal-link ID and the selected consult snapshot/hash/observed revision. It does not supply a trusted upstream consult ID. The claim RPC validates the selection and returns the server-derived consult external ID. Reject consult-selection fields on non-vaccination requests and require all of them for vaccination.

### 2. Add database context, staging and recovery

Create one additive migration with names finalized against the current migration inventory; do not edit historical migrations.

- Add `ezyvet_vaccination_runs`, `ezyvet_vaccination_pages` and `ezyvet_vaccination_page_observations`, mirroring existing append-only receipt protections. Enable RLS, revoke direct access from all API roles, and use explicit security-definer RPC grants.
- Add service-only `claim_ezyvet_vaccination_import`. Require active original ADMIN, matching same-site animal mapping and current scoped consult evidence. Preserve shared source/resource cooldown and lease handling through the existing private core.
- Freeze UUID identity before terminal recovery. Wrong actor, mapping, consult, resource or site must never rebind an existing UUID. Legacy generic vaccination UUIDs require a new scoped run, including terminal runs.
- Block `vaccination` in public generic `claim_ezyvet_import`; reject late pages from legacy generic vaccination runs before any cursor/head changes. Keep old snapshots available as historical evidence without granting scoped eligibility.
- Extend the public `stage_ezyvet_import_page` wrapper to dispatch vaccination validation, leaving prior private helpers inaccessible. Validate at most 10 objects, exact payload ID/external ID agreement, consult ID agreement, page size bound, active owner and immutable context independently of the Edge handler.
- Fingerprint original ordered items and completion flag. Exact committed replay recovers before mutable lease, consult freshness or household eligibility checks; altered replay fails. Fresh pages revalidate all dependencies and the lease/cursor.
- Lock and revalidate the pinned consult head while committing the page; retain this lock through source snapshot/head updates. Acquire vaccination head locks in canonical external-ID order. Document and test the claim/stage lock order against consult staging and patient writers; compatible mapping/patient SHARE locks must not introduce run-lock inversion.
- Atomically persist receipts and observed vaccination head revisions with snapshot staging. A failed item rejects the whole page; no partial cursor/head mutation.
- Add ADMIN-only run projection, `recover_ezyvet_vaccination_run`, `list_ezyvet_vaccination_runs` and `list_ezyvet_vaccination_candidates`. Keep run discovery actor-owned; apply paired descending timestamp/UUID cursors and bounded limits. Never expose leases.
- Candidate projection includes raw payload, source identity, vaccination snapshot/hash/observed and current head revisions, pinned consult identity/revision, mapping IDs, and separate vaccination/consult freshness indicators. A stale consult keeps its historical association visible but makes the candidate ineligible for future use. Generic-only observations never qualify.

No clinical-policy activation is required. No direct clinical writes or automatic side effects belong in these functions.

### 3. Extend Edge ingestion

- In `adapter.ts`, add the explicit vaccination resource contract and a distinct consult scope. Build the query from claimed consult context, validate every returned consult reference, and enforce the maximum-10 response shape. Preserve the existing GET-only provider boundary, read-scope allowlist, token handling, host allowlist, bounded response and retries.
- In `handler.ts`, add strict vaccination request validation, `claimVaccination` gateway and claimed `consult_external_id`. Select the appropriate scope explicitly; keep generic and patient-scoped behavior unchanged.
- In `index.ts`, wire the new service claim RPC and handle Supabase errors. Reuse staging/failure entrypoints. Source responses, credentials and raw database exceptions must not leak in errors.
- Preserve server commissioning gates. Adding code does not enable the vaccination resource or authorize production requests.

### 4. Add administrator intake and candidate UI

Create a dedicated `vaccination-api.ts` with runtime-validated request, run, candidate and pagination schemas; use `EzyVetVaccinationImports.tsx` for the workflow and mount it in `EzyVetImportPage.tsx` alongside existing clinical imports.

Reuse approved mapping search and consult candidate reads. Selection requires a current scoped consult, with source ID and description shown as escaped text. Store the original intent before a request and recover that exact UUID before any retry. Add server run discovery for browser-pointer loss; an uncertain response must not silently start another run.

Show source/consult identifiers, raw product reference, raw administration/next-date values, quantity/author references when present, page progress and freshness. Label unknown fields explicitly. Preserve historical candidates after source changes with a stale status. Do not add treatment, reminder, certificate or clinical-approval controls.

Handle empty mappings/consults, legacy runs, disabled source access, scope denial, provider cooldown, partial scans, page limit, stale consult and lost-response recovery. Guard against late async responses after patient/consult selection changes. Use semantic tokens, accessible labels/status messages and mobile-first layout.

### 5. Validate and record evidence

Run targeted unit/SQL/browser tests, actual disposable Auth/HTTP flow, observed-lock contention checks and the existing import regressions. Wire new necessary runners into CI. Refresh the restore rehearsal's frozen migration inventory and verify the additive schema survives upgrade/restore. Record synthetic evidence separately from source acceptance.

## File ownership map

Base directory for all paths below: `/Users/davidedler/livingroom-vet-staging-commissioning`.

| Action | File under base | Responsibility |
| --- | --- | --- |
| Modify | `supabase/functions/ezyvet-import/adapter.ts` | Vaccination contract and consult-scoped fetch/validation |
| Modify | `supabase/functions/ezyvet-import/handler.ts` | Request validation, dedicated claim and claimed scope |
| Modify | `supabase/functions/ezyvet-import/index.ts` | New service RPC gateway |
| Create | `supabase/migrations/<next_version>_consult_scoped_vaccination_import.sql` | Immutable context, staging protection, read/recovery RPCs |
| Create | `src/hub/features/imports/vaccination-api.ts` | Runtime-validated API contracts |
| Create | `src/hub/features/imports/EzyVetVaccinationImports.tsx` | Complete ADMIN intake and source view |
| Modify | `src/hub/features/imports/EzyVetImportPage.tsx` | Mount intake component |
| Modify | `tests/ezyvet/adapter.test.ts`, `tests/ezyvet/handler.test.ts` | Resource/handler failures and regressions |
| Create | `supabase/tests/ezyvet_vaccination_runs.test.sql` | SQL invariants, recovery and grants |
| Create | `supabase/tests/ezyvet_vaccination_runs_concurrency.py` | Observed-lock races in owned disposable database |
| Create | `tests/ezyvet/vaccination-local-roundtrip.ts` | Actual disposable Auth/HTTP acceptance |
| Create | `e2e/vaccination-imports.spec.ts` | ADMIN workflow and interrupted-response coverage |
| Modify | `.github/workflows/ci.yml`, `scripts/restore-rehearsal/run.py` | Appropriate CI and canonical migration inventory |
| Modify | `plans/20260913-ezyvet-clinical-import/research/source-contracts.md` | Current contract audit and correction of stale repository findings |
| Create | `docs/plans/ezyvet-vaccination-runs-contract.md` | Final signatures, projections, errors, locks and local evidence |

No deletions. Coordinate shared-file edits with the root agent; implementation workers must use isolated worktrees.

## Required failure and acceptance tests

| Boundary | Required assertions |
| --- | --- |
| Provider contract | Exact limit10/consult filter; no animal filter; GET-only resource fetch; configured read scope required; missing or malformed consult context makes zero source requests; 11 items, duplicate/invalid IDs, bad cursor and mixed-consult page fail. |
| Identity | Wrong actor, inactive ADMIN, wrong origin/site, missing or foreign mapping, foreign-patient consult, generic-only consult, wrong hash and stale observed revision fail in SQL even when Edge validation is bypassed. |
| Source revisions | Consult A→B→A remains stale until fresh scoped observation; vaccination A→B→A retains exact observed revision; generic-first vaccination snapshot becomes scoped only after an actual valid page without duplicating snapshot bytes. |
| Legacy bypass | Generic vaccination claim fails; existing generic run cannot stage a late page or rebind its UUID; no cursor/head/receipt change on rejection. |
| Leases and replay | Missing, null, expired and wrong leases fail fresh pages; resource cooldown works across consults; committed exact replay recovers after cleared lease or changed consult/patient eligibility; changed payload order or completion flag fails. |
| Atomicity | One wrong-consult item rejects entire page with unchanged cursor, snapshots and heads; oversized and malformed pages leave no partial receipt. |
| Contention | Observe both orders of consult-head update versus vaccination stage; verify frozen association/currentness; simultaneous claim on one UUID cannot rebind; reversed overlapping vaccination pages complete without head-lock deadlock; patient eligibility update serializes safely. |
| Discovery and authorization | Original actor recovers after local intent loss; other actors cannot recover that run; ADMIN candidate access only; direct tables/private core denied; stable cursor pagination without duplicates. |
| Browser workflow | Select mapping/current consult, stage, recover lost ACK, resume from discovery; stale response cannot replace another patient's view; disabled/scope-denied/cooldown states actionable; raw source strings escaped and unknown dates not synthesized. |
| Side effects | Compare before/after treatment, reminder, stock, invoice, certificate and outbox counts: no changes. No clinical acceptance policy enabled. |
| Runtime and restore | Actual synthetic Auth/HTTP flow and private-data authorization pass; prior consult/history/weight ingestion tests pass; additive migration and receipts survive canonical upgrade/restore. |

## Completion checklist

- [ ] Current primary-source read contract recorded; all clinical values retained without inferred meaning.
- [ ] Scoped service claim/staging and ADMIN reads enforce immutable patient/consult provenance.
- [ ] Generic/legacy vaccination bypasses closed without changing prior clinical contracts.
- [ ] Administrator workflow includes raw candidate inspection and durable recovery/discovery.
- [ ] Targeted, contention, actual local and regression evidence passes; CI/restore inventory updated.
- [ ] No clinical or provider side effects; no production-source acceptance claimed.

## Risks and subsequent work

The primary risk is an apparently plausible patient association backed only by generic or stale consult data; independent SQL checks and revision-pinned receipts address it. Date and quantity semantics remain outside this intake contract. Shared resource cooldowns intentionally serialize competing scans; do not add parallel per-consult provider jobs here.

Later Phase 3 work still requires reviewed product mapping, interpreted historical vaccinations/due dates, prescription history, authenticated attachments and whole-migration reconciliation. Those requirements are not completed by this slice. Any native clinical adoption and certificate eligibility requires its own reviewed contract and Dr. Edler's clinical approval.

Unresolved external dependencies: representative confirmation of existing read-only access/partner configuration, securely commissioned production source, authorized vaccination samples including null/date/reference variations, and supported source export/cutover semantics. These do not prevent synthetic implementation, but remain prerequisites to live-source acceptance.
