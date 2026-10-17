# Native source-cited recap — local and staging verification

Date: October 16, 2026 (Pacific). Base: merged main `bef6d4ee`.
Migration: `20261017015543_clinical_record_recap.sql` (canonical migration 199).
See the [machine-readable source hashes and receipts](2026-10-16-clinical-record-recaps.json)
and [staff workflow](../features/clinical-record-recaps.md).

## Delivered scope

Patient Medical now offers an independent records recap: signed native SOAP,
every selected encounter's addenda, and optional eligible native active/resolved
problems. Server-resolved immutable manifests keep identity, versions, dates,
membership and hashes. Every proposed claim needs literal field citations;
review preserves proposed and edited wording separately. Retaining a recap
changes only private recap persistence. It never updates/signs clinical records
or prepares publication/delivery.

Source selection, preview and citation reads do not invoke a provider. Generation
uses one-shot dispatch, exact-result persistence replay, explicit bounded retries,
originating-session checks, independent policy approval and a default-off flag.
Source-only changes can retain visibly stale evidence; changed policy/session
cannot retain raw generated claims. Source audit details remain accessible while
clinical excerpts and human-readable dates lead on desktop and phone screens.

## Completed local verification

- `npm run check`: lint passed with four existing warnings, TypeScript passed,
  **1,577 unit tests passed**, production build passed.
- Complete canonical SQL regression: **163 files / 7,101 assertions passed**.
  Recap-specific coverage is 99 core plus 49 boundary assertions and an actual
  RPC isolation preflight. Exact/oversized selection, character/byte limits,
  Unicode, timezone stability, permission boundaries and missing epochs are covered.
- Frozen functions-only Deno checks and bundles passed for audio, template notes
  and recap without root Node dependency resolution.
- Owned real local Auth/PostgREST/handler/Patient360 proof: **88 API checks,
  13 browser checks, six restore checks**, eight fake provider requests and
  **zero real provider requests**. Three committed browser responses were
  deliberately dropped and recovered without duplicating work.
- Eleven actual waits were observed using `pg_stat_activity`, ungranted
  `pg_locks` and expected `pg_blocking_pids`: writer-first/reader-first sources,
  appended addenda, originating and distinct job/attempt session revocation,
  claim/cancel competition, finish lease expiry, revoked review authority,
  ADMIN demotion, and a real patient insert outside the protected backfill lock.
- A populated dump/restore preserved **428 relations**, canonical row
  fingerprints, routine definitions/owners/settings/grants, RLS, policies,
  constraints and trigger definitions. Restored frozen output/review reads passed;
  verification reads left the original rows unchanged. Grant comparison expands
  PostgreSQL default ACLs; constraint comparison uses canonical pretty deparsing,
  avoiding false differences from equivalent dump/restore representations.
- Desktop and 390px screenshots were visually inspected; phone overflow,
  frozen excerpt highlighting, unsaved-navigation protection, stale-edit
  preservation, and absence of clinical wording in recovery storage passed.
- All **225 pinned proof inputs** matched after the run. The labeled runtime,
  owned restore clone, containers and volumes were removed.

Independent review found and resolved a post-wait finish lease check and a
committed-review receipt/version recovery issue. Upgrade review added explicit
`BEGIN`/`COMMIT` and a patient-table lock before backfill, preventing a patient
from slipping between the backfill snapshot and initializer installation. The
same lock was exercised against a native patient writer; arbitrary composed
maintenance transactions and production load are outside that test boundary.

## Staging verification

Target: **`kothoqicubowyhwfsrte`**, verified staging. Only migration 199 was
pending in the reviewed dry run, then applied. The single new
`clinical-recap-process` function is ACTIVE version 1 with JWT verification on.

- Existing **381 public tables** and **1,259 routines/ACLs** were preserved;
  the five expected source triggers are the only old table metadata additions.
  Scheduler runs/results each appended one row while existing prefixes remained
  identical. No other old row or metadata change was accepted.
- New delta: **10 private RLS tables, 42 functions** with narrow owner/staff/worker
  execution grants, five source triggers, initialized epochs and one draft policy.
  No hosted patient/job fixtures were created.
- All six uploaded function assets match local bytes/SHA256. All **52 existing
  Edge Function metadata records** and **40 secret names/value digests** were
  preserved. Audio, template-note and recap processing remain off.
- Unauthenticated POST returned **401**. No authenticated hosted clinical/model
  acceptance is claimed.
- Advisor delta: 10 INFO private RLS tables without direct policies, and 16 WARN
  authenticated SECURITY DEFINER RPCs. These match the deliberate RPC-only
  boundary: direct table privileges are revoked; each staff RPC checks current
  actor/role/session. No other advisory was added or removed.

## Remaining release and activation gates

Primary recap migration/function/frontend release awaits exact-head CI and
specific PR merge approval. No primary recap rollout was performed by this
receipt. Susan's independent recap policy and clinical presentation approval,
bounded real synthetic-model evaluation, and clinical fidelity review remain
pending. Structural quotation membership is not evidence of medical entailment.

Uploaded/scanned documents, OCR, outside-record ingestion, additional native
structured adapters, automatic note background, export/email and real iPhone
hardware acceptance remain separately scoped. The design acceptance matrix is
an inventory of targets; this receipt names the checks actually completed and
does not assert that every conceivable race or clinical case was evaluated.
