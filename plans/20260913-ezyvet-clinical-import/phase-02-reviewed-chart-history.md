# Phase2 — Imported history and reviewed problems/reactions

Priority: high. Status: implementation in progress on `codex/ezyvet-reviewed-history`, based on PR106 (`e80cf62`); acceptance remains unverified. Goal: make API-backed history usable in the patient's primary chart while retaining outside attribution and explicit local clinical authority. See [source contracts](research/source-contracts.md).

## Model and workflow

1. An active administrator prepares and approves an immutable imported-history version from a patient-scoped history observation. Require matching source host/site/animal mapping, snapshot hash and monotonic head version. Raw generic snapshots are not eligible without a corresponding validated scoped-page observation.
2. Preserve source history ID, original comments, category/chain/date/author references, active state and source observation identity. Do not translate unknown dates to import time or map categories to SOAP. If consult context is displayed as verified, resolve and freeze a same-site/same-patient consult observation and its head version. Missing/conflicting consults remain explicit unresolved work and block approval that depends on that context.
3. Keep source approval separate from DVM review. Expose only a bounded, approved patient-scoped projection to clinical staff; do not widen access to administrator staging JSON. Display “Source clinician reference” separately from “Imported/reviewed by.” Native SOAP signing and historical source authors remain unchanged.
4. An active DVM can create an explicit local problem/reaction from one or more selected imported-history versions, or link those sources to an existing same-patient problem. Fields are reviewed title, notes, onset (nullable), status and importance. Source text supplies evidence, not automatic classification. In link mode all local fields remain unchanged; differing desired fields require a separate ordinary clinical edit.
5. Each extraction has its own stable item/request UUID. One history can support several problems, so do not impose one-history-to-one-problem uniqueness. A required duplicate decision and bounded same-patient search prevent accidental duplicate entry without hiding legitimate multiple findings.
6. Preparation freezes source versions/hashes, current patient version, proposed fields, action, target version when linking, duplicate decision, actor and reason. Approval validates all exact values and writes the native problem and immutable provenance in one transaction. Exact committed recovery precedes fresh source eligibility. Changed retries fail.
7. Actor-owned prepared operations and committed receipts are discoverable without browser pointers. Explicit abandonment writes a tombstone so a delayed response cannot resurrect a discarded approval. An ambiguous request retains its original payload/UUID and blocks source/patient switching until safely recovered or abandoned.
8. A changed, inactive or reverted source creates discrepancy work. It never overwrites a local problem, erases an important reaction, resolves a problem or makes a new signature. Accepting a new source version and editing a native problem are separate decisions with separate provenance. Preserve the original extraction fields/version after subsequent local edits.

## Locking, authority and release compatibility

The existing problem/alert code serializes mutations through the patient row. The new approval must preserve that order before native problem/target changes. Freeze a consistent ordering for request, source heads, patient and target across approval, source staging, discrepancy review and release preview. Test actual waiters and both commit orders rather than inferring safety from single-session tests. Preserve provider cooldown locks from phase1.

Use active administrator authority for source ingestion/approval and active DVM authority for the new clinical extraction. All writes derive actors from authenticated sessions. No direct API table writes or impersonated outside staff. Use immutable ledgers and narrow RLS/RPC projections; raw staging, private reasons and source credentials are not exposed to recipients.

Native problems already enter medical releases. This phase must include a versioned release contract for selected imported histories and problem-extraction provenance, with explicit source/local-review distinction. Preserve all old frozen snapshots and exact recovery. Source/provenance-only changes need invalidation even when no native problem row changes. Do not silently add provenance to schema5. Choose the next snapshot version only after reviewing the complete projection; leave its clinical policy acceptance disabled.

## Files and ownership

Implementation base: PR106 (`e80cf62`); integration worktree `/Users/davidedler/livingroom-vet-ezyvet-reviewed-history`. See [the agreed implementation decisions](../../docs/plans/ezyvet-reviewed-history-decisions.md) for source selection, discrepancy review and schema6 disclosure.

- Create additive migrations and SQL/contention fixtures under `supabase/` for imported-history versions, prepared operations, approvals, extraction items and discrepancy review. Do not edit historical migrations or duplicate native problem validators.
- Create `src/hub/features/imports/PatientImportedHistory.tsx`, `ClinicalHistoryReview.tsx` and typed API helpers; integrate the patient chart and administrator import tools.
- Modify `src/hub/features/clinical/PatientProblems.tsx` for source provenance display and existing query invalidation hooks. Retain ordinary local editing.
- Modify versioned release API/selection, shared renderer and email/link builders only under an agreed frozen contract. Add matching SQL, browser and artifact tests.
- Root updates clinical review examples/register, import/release documentation and commercial-readiness evidence. No file deletions required.

## Acceptance

- [ ] Wrong patient/site/actor/source head and conflicting consult identity fail before any clinical write.
- [ ] Source A→B→A changes cannot make old preparations current merely because the payload hash repeats.
- [ ] Actual concurrent approval, source revision, local edit, patient change and treatment alert review preserve locking and clinical alerts.
- [ ] Lost approval responses recover exactly once; pointer loss, abandonment and delayed replies do not duplicate or resurrect operations.
- [ ] Multiple distinct problems can share a history; linking preserves local fields and duplicate decisions remain auditable.
- [ ] Imported prose/date/category/author references remain explicit and escaped; unknowns cannot become local signatures, diagnoses or timestamps automatically.
- [ ] Important-reaction creation refreshes the problem list, booking/treatment alerts and release candidates/history without remounting or losing unrelated drafts.
- [ ] Later source changes leave native fields untouched and create discoverable discrepancy work; local edits preserve the immutable original extraction.
- [ ] Frozen exports include the agreed provenance; schema1–5 legacy artifacts, exact recovery and final delivery source guards remain valid.
- [ ] Actual local Auth/HTTP/SQL workflow plus repository/Edge/browser/SQL/contention/restore checks and CI pass; Dr. Edler's actual acceptance remains separately recorded and pending until provided.

## Clinical decisions requiring review

Before commissioning, Dr. Susan Edler must approve the distinction between imported history and locally authored findings, handling of unknown/inactive source data, importance/status defaults, duplicate decisions, source-discrepancy handling and recipient disclosure. Technical tests cannot supply this approval.
