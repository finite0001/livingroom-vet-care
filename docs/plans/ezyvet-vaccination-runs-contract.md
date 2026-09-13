# Consult-scoped vaccination intake — 5200

This contract imports source evidence only. It does not create treatments, due plans, certificates, prescriptions, stock movements, charges, reminders or messages. Living Room Vet remains the primary record system. No policy activation or production-source acceptance is implied.

## Service ingestion

`claim_ezyvet_vaccination_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text,p_animal_link_id uuid,p_consult_snapshot_id uuid,p_consult_payload_hash text,p_consult_observed_head_version integer)` returns import-run JSON, including its private service lease, plus:

- `animal_link_id,animal_external_id,pet_id,client_id`
- `consult_snapshot_id,consult_payload_hash,consult_observed_head_version,consult_external_id`

The resource must be `vaccination`. The browser supplies the selected snapshot UUID, lowercase 64-character SHA256 and positive PostgreSQL integer revision, never a trusted consult external ID. SQL derives that ID through a same-site approved animal mapping and a validated clinical consult page observation. The consult's snapshot and observed revision must both equal the current identity head. Generic consult observations cannot establish this association. A source A→B→A transition does not revive an older scoped observation.

A UUID permanently belongs to its original active ADMIN, mapping, origin/site, resource and exact consult selection. Terminal exact claims recover before mutable patient/consult revalidation. A UUID originally created through generic vaccination ingestion requires a new run, including terminal UUIDs. Generic public `claim_ezyvet_import` now refuses vaccination, and the public stage wrapper refuses legacy vaccination pages before any mutation. Historical generic snapshots remain available without acquiring scoped eligibility.

`stage_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb)` remains the shared service entrypoint. Non-vaccination calls delegate directly to the existing private pre-vaccination wrapper, preserving prior contracts.

Vaccination pages contain at most **10** objects and at most 2 MiB of JSONB text. Ten is the application safety bound; the source documentation's default page size is not asserted to be a provider maximum. Each object contains `external_id` and raw `payload`; payload ID must match external ID and payload `consult_id` must match the server-derived consult. Source IDs and optional non-null `product_id` accept numbers or canonical numeric strings, from zero through 9,007,199,254,740,991, without leading zeroes or decimal/exponent string syntax. Product references remain unresolved. Optional qty, administration/next date, outside author, created and modified fields accept string, finite number or null. Description/notes accept string or null; active also accepts boolean. Missing values remain missing. Other source values are retained without assigning clinical date, unit, author or certificate meaning.

Every fresh page independently validates the active original owner, immutable context, lease, cursor, current mapping/household and current scoped consult. Missing, cleared, expired or wrong leases fail. One invalid or duplicate item rejects the entire page and leaves snapshots, heads, cursor and receipts unchanged. Empty intermediate pages fail through the shared core. Shared source/resource cooldown and 1,000-page bound remain unchanged.

An immutable SHA256 fingerprints the original ordered JSONB items and completion flag. Exact committed replay recovers before mutable lease, consult and household eligibility checks, while still enforcing active original owner and context. Altered order, contents or completion fail. Sorted execution does not relax ordered replay identity.

## Administrator reads and recovery

All exposed reads require an active authenticated ADMIN. Private projection/helper functions and direct access to the three new tables are denied to anon, authenticated and service roles.

- `recover_ezyvet_vaccination_run(p_id uuid,p_animal_link_id uuid,p_consult_snapshot_id uuid,p_consult_payload_hash text,p_consult_observed_head_version integer)` returns safe run or null. Only the original actor can recover it; immutable identity mismatches fail. Matching legacy runs have `legacy_unscoped` scope and cannot resume.
- `list_ezyvet_vaccination_runs(p_animal_link_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)` returns `{runs,has_more,next_cursor}`. It discovers the original actor's mapped runs and same-site legacy vaccination runs. Consult selection is not a discovery filter, so browser state loss does not hide earlier runs.
- `list_ezyvet_vaccination_candidates` takes the same query arguments and returns `{animal_link_id,resource,candidates,has_more,next_cursor}`. These are ADMIN-readable source observations, not actor-private clinical records.

Limits are 1–50, with paired descending `(created_at,id)` cursors. `next_cursor` contains `before_at,before_id` only when another page exists. Safe run fields are `id,requested_by,resource,source_origin,source_site_uid,status,next_page,retry_after,last_error_code,created_at,updated_at,lease_active,scope,animal_link_id,animal_external_id,pet_id,client_id,consult_snapshot_id,consult_payload_hash,consult_observed_head_version,consult_external_id`. Scope is `consult_scoped|legacy_unscoped`; mapping/consult fields are null for legacy rows. No lease token is exposed.

Candidate fields:

- Original snapshot: `id,payload,payload_hash,external_id,resource,source_origin,source_site_uid,created_at`.
- Vaccination freshness: `head_version,current_snapshot_id,observed_head_version,is_current,is_current_snapshot,current_head_scoped`.
- Frozen patient association: `animal_link_id,pet_id,client_id`.
- Consult evidence: `consult_snapshot_id,consult_payload_hash,consult_observed_head_version,consult_external_id,consult_head_version,consult_current_snapshot_id,consult_is_current`.
- `eligible_for_review`: both source revisions current and original household membership still valid. This is a source-evidence indicator, not clinical approval or permission to promote data.

Each snapshot appears once, using its latest scoped vaccination revision and then latest pinned consult revision, with receipt time/run/page tie-breakers. `is_current` and `current_head_scoped` describe only vaccination freshness; `consult_is_current` is independent. Stale consults and changed household membership do not erase historical associations. `created_at` is first snapshot storage time, not an administration timestamp. Raw strings must be escaped in UI.

## Errors and concurrency

- `22023 VACCINATION_RUN_REQUIRES_NEW_CONTEXT`: legacy/generic UUID cannot be reused; create a new scoped intent.
- `40001 SOURCE_CONSULT_STALE`: selected consult no longer current or lacks the exact scoped observation; select a current consult and create a new intent.
- `42501`: wrong owner, mapping, site, source/hash or immutable identity, or inactive administrator.
- `23514`: unsupported resource, malformed context/page, mismatched IDs, invalid references or pagination.
- `40001`: altered committed request, changed household/mapping or invalid lease/cursor.
- `55P03`: existing source/resource lease or cooldown.

Claim lock order is vaccination UUID advisory gate → mapping SHARE → patient SHARE → consult head SHARE → shared source/resource claim gate → import run UPDATE. Stage order is the same vaccination UUID advisory gate → import run UPDATE → mapping SHARE → patient SHARE → consult head SHARE → canonically sorted vaccination snapshot/head writes. The consult SHARE lock is retained through receipts and vaccination head updates. Existing consult staging also reads mapping/patient with SHARE before its consult head write. Mapping/patient readers are compatible; native patient writers do not request import run locks. No vaccination code acquires another consult run lock. The shared UUID gate excludes a queued consult writer from a three-way claim/run/consult cycle. This prevents run/consult inversion while serializing a source update against the pinned association.

New context, page and observation rows are append-only, RLS enabled, and unavailable for direct API-role access. Page receipts and observed head revisions commit atomically with shared staging. Indexed snapshot and mapping lookups support candidate/run discovery.

## Validation

The focused SQL file runs inside a rollback transaction. The concurrency runner clones only schema into an owned local disposable database, applies 5200 if absent, runs the focused pgTAP assertions, and observes actual lock holders and waiters. It checks the exact database ownership marker before removal and confirms cleanup. Synthetic fixtures include owner-only legacy runs and adversarial simultaneous leases; no source request or hosted mutation occurs.

Run `python3 supabase/tests/ezyvet_vaccination_runs_concurrency.py --project-config <local Supabase config>` against a verified local project. Actual Auth/HTTP, Edge/browser, prior import regressions and canonical upgrade/restore are separate integration evidence owned by the parent workflow.

Local verification on September 13, 2026: **81 focused SQL assertions**, **215 existing import/review/weight/clinical assertions**, and **53 runner checks** passed. The runner observes holders/waiters for both real consult-stage orders, same-UUID claim/stage/replay, reversed overlapping vaccination pages, both household-writer orders, and a three-session stage/reclaim/consult-writer sequence. The final migration SHA256 is `f5e52dffeb5e074d8f09496e968cb4392d098d27cad983600b88746115d11238`. Cleanup was verified; no provider request, hosted mutation or clinical policy activation occurred.
