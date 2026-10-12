# Package 3B2A — isolated diagnostic renderer and PDF admission

Baseline: merged PR #240, `14be15205456af9ce98930b4d62b5c4ee3adff09`; both hosted backends have 175 verified migrations. [Hosted recovery receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-jobs-rollout.md). All 45 launch requirements and practice acceptance remain required.

## This package

1. Build deterministic, escaped medical HTML from the reviewed diagnostic/job snapshot and an already-frozen, single-patient history census through the source review time. Preserve zeros, qualitative findings, original units/references/flags, attribution, corrections and source versions. Plot only comparable series using the app's existing rules; label axes and retain all point values. State history truncation explicitly.
2. Run fixed code in a pinned Linux amd64 Playwright image. The Vercel control plane uses root for SDK setup; the clinical worker requires UID 12001, denies sudo elevation and receives no application credentials. Require actual Chromium namespace and seccomp telemetry, with no unsafe fallback. Clinical HTML has JavaScript disabled; a separate trusted internal context reads `chrome://sandbox`.
3. Use a fresh Firecracker VM: deny-all networking, no exposed ports/drives, persistent false, one vCPU/two GB, 60-second whole-VM deadline. Synthetic network proofs allow 120 seconds. Bound HTML/input/output transfers; verify returned VM policy/resource configuration; stop in finally and confirm stopped/no snapshot via metadata reads without resume.
4. Admit the observed classic Chromium PDF 1.4 subset, with exact xref/offset/object inventory, decoded unique dictionary keys, resolved references, bounded depth/streams/inflation and a valid Letter page tree. Reject actions, annotations, attachments, encryption, AcroForm, xref/object streams, incremental updates and unsupported structures. Permit SVG Form XObjects, which are different from interactive AcroForm.
5. Corroborate unchanged actual bytes with isolated read-only qpdf, strict exit-zero admission and bounded text checks. The validator does not repair, rewrite or certify arbitrary PDFs. Cap input at 512 KiB HTML/1 MiB JSON; output at 3 MiB/40 pages, 5,000 objects, 2 MiB per inflated stream/16 MiB total. Confirm hashes before/after validation and on bounded control-plane readback.
6. Verify a genuine native hosted synthetic report, raw DNS/TCP/metadata denial, non-root/sudo checks, a detached descendant followed by whole-VM expiry, and a 100-finding/Unicode/multi-page report. Retain exact source/image/binary/font digests. Native amd64 CI independently builds and runs the restricted Docker proof and malformed-PDF counterexamples. ARM emulation cannot pass as native sandbox evidence.
7. Keep clinical activation and all hosted policies empty/off. No new SQL migration, service coordinator, Storage upload, artifact registration, download button or delivery activation in this PR. Obtain Dave's approval for the concrete PR number before merge.

## Why the split

Real execution exposed SDK/custom-image, hostname resolution, environment and emulation differences. Settle execution and admission first (3B2A), then build private processing and registration (3B2B) against that proven boundary. This keeps the renderer proof distinct from patient-record readiness. Existing #240 captures remain `captured_unverified`, unuploaded and non-exportable.

## Next package — 3B2B

- Freeze and persist the exact history census/HTML and runtime/template/font/settings/validator provenance before execution; use immutable sources rather than current mutable roots.
- Preserve #240's immutable captured bytes and actor; add separate private processing leases/fences, immutable validation receipts, hash-bound upload intents and artifact registration.
- Recheck current active request owner, worker policy and time after locks. Validate before first capture and revalidate saved-byte recovery without regenerating captured bytes.
- Upload exact bytes with `upsert: false` to private immutable paths, bounded-download and hash-check the actual object, then register its actual ID/creation time/MIME/size. Recover lost replies against the same bytes/object. Stale workers cannot register; delayed privileged uploads remain private and recoverable.
- Prove lock/offboarding/expiry/correction/stale-worker races, uncertain upload/register acknowledgements, actual local Auth/Storage/renderer round trips and full exact-byte restore.
- Keep delivery gates off. Staff review/download (3C) and schema-14 record release integration (3A2) still follow.

## Evidence

See [renderer implementation and native proof](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-renderer.md). Required exact-head frontend, Edge, database and native-renderer CI must pass before this PR is presented for merge approval.
