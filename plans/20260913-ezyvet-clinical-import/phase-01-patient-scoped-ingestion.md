# Phase1 — Patient-scoped consult/history ingestion

Priority: high. Status: implemented and locally verified; PR106 database, Edge and frontend CI passed at `e80cf62`. Real source commissioning remains pending. Depends on PR104 and the [source audit](research/source-contracts.md). This phase delivers API-backed patient history staging and review access; it does not yet create native clinical entries.

## Contract and architecture

1. Extend `ezyvet-import` to accept `{run_id,resource,animal_link_id}` for consult/history, alongside the existing healthstatus contract. The server derives external patient, source origin and site from the immutable approved animal mapping; callers never supply upstream filters or alternate URLs.
2. Add `claim_ezyvet_clinical_import` with an explicit resource allowlist of consult/history. Bind each run once to its animal mapping. Keep the current actor/site/resource leases, cooldown, page limits and completed-run behavior. Do not introduce parallel import loops or a background scheduler.
3. Reject fresh generic consult/history claims. Preserve already-staged generic observations as historical evidence, but do not treat old unscoped runs as patient-scoped runs. Define explicit legacy in-flight behavior: continuation fails with a stable explanation requiring a new mapped run; no silent rebinding, reset or replay. Preserve legacy leases/cooldowns until normal expiry; a replacement run cannot bypass them.
4. Use documented history limit10 and explicit resource contracts. Consult requests should use a conservative10 until issued-site limits are verified. Send the server-derived `animal_id`; validate each returned ID/relationship, payload shape and page bounds before storage. Keep existing contact/animal/reference and weight behavior compatible.
5. Extend the SQL staging wrapper to require the matching clinical-run context, recheck actor/source/mapping and verify every returned record's animal identity. A mixed-patient page must commit nothing, including cursor/head changes. The service API is not trusted to supply correct relationships merely because the Edge adapter checked them.
6. Preserve original JSON snapshots in administrator-only staging, including opaque history category/chain/date/author references. Treat source prose as untrusted data. Display escaped text; no HTML execution, SOAP interpretation, source signature or diagnostic classification.
7. Add bounded candidate discovery scoped to the approved mapping and resource, with snapshot ID/hash, current head version, source identity, source status and pagination. Only observations with a validated scoped page/run association satisfying the same patient binding may appear. A deduplicated snapshot first seen in a generic scan may become eligible only when actually observed in a valid scoped run; matching JSON alone is insufficient. Do not bypass it via generic client-side filtering of all snapshots.
8. Add administrator UI to choose an approved mapped patient, inspect required scopes and run consult/history scans with retained UUIDs. Recover runs after lost responses and page reload; distinguish scan completion from clinical approval. Show unmapped/disabled/scope-denied and legacy-run states. Do not expose keys or raw upstream errors.

## Files and ownership

Absolute base: `/Users/davidedler/livingroom-vet-ezyvet-clinical-plan` (implementation worktrees will use the same relative paths).

- Database owner: create additive `supabase/migrations/20260913490000_ezyvet_clinical_runs.sql` after revalidating the latest version; create focused SQL/contention tests. Modify only scoped generated RPC types in `src/integrations/supabase/types.ts`.
- Adapter owner: modify `supabase/functions/ezyvet-import/adapter.ts`, `handler.ts`, `index.ts`, `tests/ezyvet/adapter.test.ts`, `handler.test.ts`; create actual synthetic HTTP/Auth/PostgREST coverage. No real ezyVet requests.
- UI owner: modify `src/hub/features/imports/EzyVetImportPage.tsx`; create `EzyVetClinicalImports.tsx` and typed API helpers in the same folder plus `e2e/clinical-imports.spec.ts`. Reuse mapped patient search through a neutrally named wrapper rather than copying unrestricted table queries.
- Root: update `docs/ezyvet-staged-import.md`, CI and migration rehearsal inventory after reviewing49; integration tests and draft PR. No files deleted. Never edit migration2300 to retrofit deployed behavior.

## Database safety

Use active administrator checks and actor-bound run ownership consistently with existing ingestion. New context tables have RLS and no direct browser mutation. Revoke private helper execution from all API roles; grant only named public/service entrypoints. Confirm full request identity before recovering a run. Document lock ordering against run leases, mapping, patient and source heads, preserving weight behavior. Keep pages atomic and prove that mapping/actor changes cannot alter an existing run.

## Acceptance

- [x] Actual adapter requests use animal filters and history limit10; response envelopes, IDs and paging reject malformed/mixed-patient input.
- [x] SQL independently rejects forged scope, wrong site/patient, missing mapping, changed actor, altered retry and legacy generic bypass.
- [x] A generic-only snapshot is ineligible; identical bytes actually observed in a valid scoped run become eligible without cloning the snapshot. Generic run UUIDs, including terminal ones, cannot acquire scoped context; late legacy pages cannot advance cursor or heads.
- [x] Lost page response, durable continuation, terminal-run recovery and source reversion preserve correct snapshots/head versions without duplicates.
- [x] Concurrency observes real blocking/leases; competing runs and mapping checks cannot race into another patient or duplicate cursor advancement.
- [x] Browser covers mapped patient selection, bounded paging, escaped history, disabled upstream, wrong scopes, retained UUID recovery and navigation/account-switch guards.
- [x] Actual local Auth/HTTP/PostgREST fixture exercises both resources against a synthetic upstream; no live source access or clinical policy activation.
- [x] Native notes/problems/treatments/prescriptions/stock/charges remain unchanged in this ingestion phase. Phase2 must then make the reviewed data usable in the chart.
- [x] Repository check, frozen Edge checks, focused regressions and updated69-migration local upgrade/restore rehearsal passed.
- [ ] Required implementation PR CI must pass.

## Remaining gates

Real account entitlement, approved source scope and representative response samples are required for commissioning. Page traversal is not a transactional source export; this phase cannot claim complete migration based on `review_ready` alone.

Integrated evidence: [runtime and restore validation](../../docs/ezyvet-clinical-runtime-acceptance.md), [database contract](../../docs/plans/ezyvet-clinical-runs-contract.md). All clinical promotion remains in phase2.
