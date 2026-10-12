# Diagnostic PDFs — private processing and artifact registration

Package 3B2B adds an operator-invoked, default-off coordinator and additive migration `20261012035948`. It connects the approved isolated renderer to immutable captures and actual private Storage. #241 is [merged and production READY](2026-10-11-diagnostic-pdf-renderer-rollout.md). The repository has 176 migrations; hosted backends remain at 175 pending this package's specific merge/rollout approval.

## Resulting behavior

A reviewed diagnostic job freezes its patient display, exact source version, historical-panel census, deterministic escaped HTML, expected texts and accepted executable/font/settings provenance before rendering. A lost preparation reply recovers that same manifest. The trusted renderer admits actual PDF bytes before the first immutable capture; recovery always revalidates those saved bytes and never generates them again.

A separate 90-second processing claim records its own owner and monotonically increasing fence. Registration takes locks in job → profile → ordered authoritative role rows → worker/runtime policies → processing → Storage order, then rechecks expiry. Original capture attribution survives an authorized owner handoff. Offboarding, role removal, policy withdrawal, stale workers and expiry during an observed lock wait cannot advance processing.

The coordinator reserves `diagnostic-pdfs/PET_UUID/JOB_UUID/BYTE_SHA256.pdf`, uploads with `upsert: false`, bounds the actual HTTP download before allocation and compares its bytes to the immutable capture. Registration binds the actual object's UUID, creation/update time/body generationstamps, bucket/path/MIME/size and exact downloaded byte hash. Lost upload or registration acknowledgements recover without an overwrite or duplicate artifact. A saved receipt is historical evidence; current `object_present` and `registered_unavailable` distinguish a changed/missing object. Neither state grants release or staff download access.

Failures store bounded generic codes only when a live authorized processing claim permits it. A lost registration reply may already be committed, so the stored claim cannot be overwritten as failed. The manual worker prints only a coarse status; guest VMs receive fixed source inputs and PDF bytes, no DB/control-plane credentials. Generation and recovery both use an exact non-resumable SDK session. An actual command submitted after a 15-second VM deadline was rejected and left the VM stopped without a snapshot: [expiry proof](2026-10-11-diagnostic-pdf-registration-session-expiry.json). There is no public API, queue consumer or scheduler deployment.

## Verification

- `npm run check`: 1,336 unit tests, TypeScript/lint/build; 16 new protocol counterexamples cover wrong patients/owners/claims, altered deterministic HTML, wrong recovered/readback bytes, unknown artifact fields, unbounded HTTP responses and missing-object status. Existing lint/chunk-size warnings remain.
- Canonical owned-local SQL regression: 143 files / 5,834 assertions, including 43 new registration authorization/serialization checks. SQL marker bytes and manually inserted object metadata test database guards only; they are explicitly not renderer admission or real Storage evidence.
- Genuine local Auth/PostgREST/Storage with the accepted native Vercel Sandbox renderer: see the [runtime receipt](2026-10-11-diagnostic-pdf-registration-runtime.json). Real PDF generation, independent capture/recovery admission, actual private upload and bounded readback; lost preparation/capture/upload/registration replies; offboarded-owner handoff; stale-worker rejection; staff direct ledger/claim/download denial; same-object update and deletion readiness guards. Generation occurs exactly once. All 25 new synthetic trial VMs were independently verified stopped/nonpersistent/deny-all without snapshots: [audit](2026-10-11-diagnostic-pdf-registration-vm-audit.json).
- Eight observed-lock checks cover profile revocation, authoritative role removal, runtime-policy withdrawal and lease expiry while blocked. They observe `pg_stat_activity` and blocking PIDs rather than infer concurrency from sleeps.
- Seven populated-restore checks compare actual capture base64/hash plus manifests, attempts, upload intents and artifact registrations in a separately marked database. This proves ledger/captured-byte restoration; it does **not** claim that database backups restore provider object bodies.
- CI adds the same genuine local pipeline using a native amd64, credential-free Docker renderer with read-only root, no network/ports, dropped capabilities, bounded scratch and whole-container cleanup. Final exact-head frontend, Edge, database, native renderer and Vercel checks are required before merge.

## Scope and rollout

No clinical runtime policy is seeded or enabled. The existing private image remains pinned to the approved #241 digest; accepted template/parser/worker hashes are checked against committed source. Both worker and runtime policies must match it explicitly before the manual operator command can process clinical work. Applying the migration alone keeps processing off and adds no public object policy.

After specific PR approval: inspect both target backends, obtain backups, apply staging first, run bounded synthetic read/write/cleanup checks, then primary with default-off policies. Deploy no Edge Function for this package. Keep provider delivery and Stripe commissioning separate. No writes target retained legacy Lovable Supabase.

3C still needs clinician-facing review/download/retry behavior; 3A2 still needs selective record-release integration. Object cleanup, object-body disaster recovery, release invalidation, operational monitoring and clinical worker commissioning remain explicit follow-ups. All 45 launch requirements and Susan's practice acceptance remain required; private registration alone does not complete the patient PDF feature.
