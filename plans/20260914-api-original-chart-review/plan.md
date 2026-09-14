# Reviewed API originals in the patient chart

Status: implemented and locally verified; see [validation evidence](../../docs/features/reviewed-api-originals.md#validation). Base: merged PR128, `705d7a1`; canonical 87 migrations through 7000.

## Outcome

An administrator explicitly admits an owned, verified API original to its patient's chart. Active staff can inspect immutable source and review history. A DVM separately downloads verified bytes and acknowledges an exact chart version. Corrections and withdrawals preserve prior evidence. No provider traffic is required for this workflow.

## Decisions

- Keep the private original and its `ezyvet_api_attachment_original_v1` receipt; do not copy into `patient_documents` or reinterpret it as a manual export.
- New admission requires current mapping/patient membership and the reviewed patient version. An older attachment observation can be admitted as historical evidence with its original timestamp and source status clearly shown.
- Replacements are explicit and compare the previous chart version; they never inherit a prior DVM acknowledgment.
- Recovery uses actor-owned immutable UUID-bound arguments before retry. Unknown responses cannot silently become a new operation.
- Add separate authorized DVM chart download; preserve original-owner capture access.
- Keep release selection and delivery unchanged. API-original release support is the next integration contract; chart admission cannot bypass its provenance requirements.

## Work and ownership

1. Freeze [RPC and UI contract](../../docs/plans/attachment-original-review-contract.md).
2. Database worker: additive 7100, SQL permissions/idempotency/currentness/lineage tests, observed lock races, 88-migration restore inventory and populated fixture.
3. UI worker: strict state/API adapters, patient chart panel, shared clinical draft guard, browser recovery and role tests.
4. Runtime worker: authorized chart-byte handler, exact private path and immutable digest validation, no-provider tests.
5. Root: integrate isolated commits, actual local Auth/PostgREST/Storage acceptance, CI wiring, documentation and stacked PR.

## Acceptance

- ADMIN admission and DVM acknowledgment remain distinct; wrong patient, capture, actor or hash is rejected.
- Lost mutation replies recover exact receipts; replacements/withdrawals serialize and preserve history.
- Private Storage remains inaccessible directly; DVM downloads verify content and revoke browser URLs on exit.
- All history pages and actor-owned recovery remain accessible after current-source changes.
- Admission creates no patient document, clinical treatment, billing, reminder, release, outbox or provider side effect.
- Unit, browser, SQL, contention, frozen Edge, actual HTTP/Storage and populated restore checks pass before publishing review evidence.

## Remaining wider scope

Release integration, additional source parent types, source commissioning, clinician acceptance by Dr. Susan Edler and full migration reconciliation remain open. This increment does not claim completion of those workflows.
