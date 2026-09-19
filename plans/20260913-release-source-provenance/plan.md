# Selected lab and external-original provenance in medical releases

Status: implementation and local integration checks completed; PR104 CI is green; clinical acceptance and hosted/provider commissioning remain open.
Base: PR102, `a07f07f`; migrations through4600. This is an extension of the requested ability to select and send medical records/lab results, not an ezyVet or Antech API adapter.

## Outcome

Staff can explicitly select a verified lab report version or approved ezyVet manual-export version, inspect its exact original and source/replacement/acknowledgment details, and freeze that evidence into a schema5 release. Email and document-link materialization must verify downloaded bytes against the source capture digest before freezing delivery artifacts. Existing schema1–4 releases remain immutable and recoverable.

## Evidence and decisions

- Current schema4 includes legacy resulted lab orders, document metadata and reviewed weight provenance. It omits4100 lab report versions and4200 external-record versions.
- Existing email/link materializers check MIME/size but not the4100/4200 captured SHA256. Newly computed delivery hashes do not prove the original capture matched.
- Use explicit `lab_report_ids` and `external_record_ids`; each requires its exact original in `document_ids`. No silent source inclusion or automatic clinical conversion.
- Use schema5 and versioned discovery/preview contracts. Do not append data to old snapshots or regenerate their frozen payloads.
- Historical versions remain selectable with clear supersession labels. Staff approval, byte verification and exact-version DVM acknowledgment are separate facts.
- Fresh provenance-backed releases must not bypass the new disclosure through a legacy schema or omitted source selection.
- Extend clinical policy acceptance to5 without enabling it. Dr. Susan Edler and the disclosure reviewer must review the new format before confirmation is commissioned.

## Phases

1. [Database snapshot and lifecycle](phase-01-database.md) — implemented and locally verified. Versioned selection, source projection, locks, invalidation and compatibility.
2. [Rendering and exact-byte delivery](phase-02-artifacts.md) — implemented and locally verified. Shared schema5 renderer and both materialization/capture paths. Can proceed alongside phase1 after the frozen contract is agreed.
3. [Staff workflow and acceptance](phase-03-workflow.md) — implemented; clinical acceptance pending. Explicit source/original selection, recovery, browser/runtime evidence and clinician review examples.

## Delivery sequence

Use isolated worktrees for database, shared renderer/transport, and staff UI. Assign file ownership; only one agent may mutate the shared local database at a time. Root integrates and runs end-to-end checks. Stack additive draft PRs on PR102; do not merge main, alter hosted schemas, enable policy acceptance or send messages during implementation.

## Completion evidence

- Old schema1–4 snapshots/hashes/rendered bytes and exact committed recovery survive the upgrade.
- New sources cannot be confirmed without matching originals, current provenance and schema5 acceptance.
- Actual concurrent confirmation versus correction, acknowledgment and voiding is safe in both orders.
- Same-length substituted bytes fail email and link materialization/capture; no delivery attempt is created.
- A synthetic staff workflow covers selected sources through actual private Storage, immutable release, frozen email/link artifacts and stale-source denial.
- New clinical/disclosure review examples are generated with production renderers; acceptance stays pending.

## Open external gates

Antech onboarding/API contract, ezyVet account/API entitlement and structured import, anesthesia vendor, actual provider delivery, hosted deployment and clinical approval remain separate requirements. None blocks implementation of this local verified-original release extension. No external API fields or provider authenticity may be invented.
