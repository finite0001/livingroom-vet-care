# Native prescription release integration map

Audit of the schema9 baseline used to implement schema10 in migration120. Items below describe required consumers; the native release evidence checkpoint records verification and remaining acceptance limits.

## Database composition and dispatch

- `20260914070000_canonical_api_release_preview.sql`: `release_preview_v9_internal` composes inherited families, selection and final hash. Introduce v10 composition that also accepts native-prescription-only selection; do not require older selected content simply to pass an inherited nonempty check.
- `20260914090000_canonical_api_release_confirmation.sql`: extend policy/schema/source-kind constraints, confirmation and read dispatch, source registry mapping and final staff rechecks. Preserve inherited provenance/weight invalidation functions currently gated through9; add native authorization/event/fill invalidation. New policy acceptance10 is explicit, never inferred from acceptance9.
- `20260914080000_canonical_release_original_verification.sql`: schema10 must retain API-original and inherited provenance-byte verification. A schema9-only branch must not send10 down an incompatible legacy fallback.
- `20260914100000_canonical_api_release_discovery.sql`: add native family discovery, bounded pagination/select-all and new policy reporting.
- `20260913220000_release_email_delivery.sql`: `release_email_context(uuid)` compares acceptance dynamically with the saved snapshot version; preserve this rather than forcing all historical releases to10.
- `20260913280000_document_links.sql`: `document_link_source(text,uuid,uuid)` makes the same dynamic policy comparison and calls `release_read_internal`; `document_link_current(uuid)` checks the frozen source hash/recipient. Preserve post-lock actor/expiry checks patched by `20260914090000`.
- `20260913480000_release_source_byte_binding.sql`: `capture_release_email_payload` and `capture_document_link` invoke **`verify_release_source_original_v5(jsonb,jsonb,bytea)`**. Despite the name, its current definition is in `20260914080000`; extend that actual schema9 branch to10, retaining frozen grant source bundles and legacy1–9 behavior. Do not modify an assumed unsuffixed function.
- `authorize_record_release` in `20260913130000` checks enabled policy and delegates to read; it does not alone enforce schema acceptance. Keep downstream acceptance checks.
- Bounded follow-up audit found no additional hardcoded9 gates in the inspected email/link migrations. Prove behavior with both email and SMS-link runtime tests: policy9 rejects10, accepted10 permits eligible10, older9 remains usable, and mixed-package byte tampering fails.

## Shared TypeScript consumers

All files below are in `supabase/functions/_shared/`:

| File | Required change |
|---|---|
| `record-release-renderer.ts` | Snapshot union, known-version list, native fields/selection counts, validation and rendering |
| `record-release-source-provenance.ts` | Inherited version guards and API-original exception |
| `record-release-imported-history.ts` | Explicit v10 inherited validation/render guards |
| `record-release-imported-vaccinations.ts` | Explicit v10 inherited validation/render guards |
| `record-release-imported-prescriptions.ts` | Explicit v10 inherited validation/render guards; retain historical-only meaning |
| `record-release-api-attachments.ts` | Existing schema9-only guards must support inherited originals in10 |
| `release-email-payload.ts` | Preserve original-byte SHA verification currently gated by `[5,6,7,8,9]`; omission of10 would silently skip the check |
| `document-link-artifacts.ts` | Preserve `sourceByteBound` for10; omission would silently drop inherited byte binding |

Do not accept arbitrary future schema numbers. Frozen schemas1–9 retain their original hashes and meaning. New native rendering must distinguish signed authorization from actual dispensing and from outside historical evidence.

## Browser consumers

`src/hub/features/record-releases/api.ts`: candidate/selection family types and current `policy_v9_accepted` field. `selection.ts`: family labels/keys. `PatientRecordReleases.tsx`: response/family validation, bounds, exact-schema preview checks, policy/confirmation gates and native previews. Artifact/history/original download paths must handle mixed old and new saved records.

## Acceptance coverage

Retain existing fixtures and assertions in `e2e/record-release-workflow.spec.ts`, `tests/record-releases/api-attachment-fixture.ts`, `api-attachments.test.ts` and `prescription-fixture.ts`. Add native-only and mixed v10 selections, unselected drafts, canceled/replaced authorization and partial-fill disclosure.

Existing SQL/API-original, imported-prescription, discovery-boundary, source-byte-binding and document-link suites must still pass. Add byte tampering through both email and document-link artifacts, original verification for mixed v10, stale native sources between preview/confirm, frozen historical recovery, explicit policy10 acceptance, selection limits and exact patient/actor isolation.

Actual runtime regression entry points include `tests/ezyvet/attachment-original-local-roundtrip.ts`, `attachment-max-package-roundtrip.mjs` and `tests/record-releases/clinical-history-local-roundtrip.ts`. They protect retained historical artifacts; maintaining those contracts does not resume ongoing ezyVet integration development.
