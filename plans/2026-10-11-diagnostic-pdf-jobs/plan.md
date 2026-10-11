# Package 3B1 — durable diagnostic PDF jobs and immutable byte capture

Baseline: merged/deployed PR #239, `cd51799bac47e2a4860d727b08bd145563daebaa`, 174 canonical migrations. [Previous rollout](../../docs/launch-evidence/2026-10-11-manual-diagnostics-rollout.md). All 45 launch requirements remain required.

## Concrete scope

Atomically queue each newly finalized diagnostic version; allow active staff to request a job for historical versions and explicitly recover failed/offboarded work. Freeze exact reviewed version/source identity and patient display fields. Keep job/attempt/retry histories private, bounded and immutable. Service-only workers claim expiring leases with monotonic fences, recheck the actual request actor after waits, and capture exact bounded bytes once before any upload boundary. SQL derives the capture size/hash from actual bytes. Recovery reads the saved bytes rather than invoking the renderer again.

**This package does not declare a PDF ready, validated or exportable.** Captures remain explicitly unverified and unuploaded. Worker policy is empty/off by default. The renderer, narrow PDF admission/structure validation, private Storage registration/readback and staff PDF review are required in 3B2/3C. Current UI continues to show PDFs unavailable; records manifests retain explicit diagnostic exclusions. No paid Sandbox, scheduling, release/provider/financial activation or hosted rollout occurs without the concrete later review.

## Design constraints

- Five private RLS ledgers: jobs, attempts, captures, staff action receipts and revisions; separate private worker policy with no seeded acceptance.
- Automatic queue is part of the diagnostic finalization transaction. Stable version/job identity and exact immutable snapshots; correction creates another job without altering its predecessor.
- Active staff request/retry with server actor stamps, bounded reason/expected version and actor-owned immutable action receipt. Historical retry receipt stays separate from current job status. Transfer from an inactive owner preserves original review/capture evidence.
- Service-only explicit-job claim/receipt/context/failure/capture/read APIs. No general database credential enters a renderer. Expired/superseded workers cannot mutate; permanent conflicts use PT409, not 40001.
- Exact bytes are bounded to 3 MiB (base64 plus metadata fits below ordinary 4.5 MB Function body limits), with canonical encoding and SQL-derived digest. Format marker checks are not a security/structure validator. No invented page count or readiness. No byte reserialization.
- Current source snapshot captures one reviewed result and its patient identity. Longitudinal PDF graph context, pinned HTML/settings/font/image provenance and validated page metadata must be frozen in 3B2 before generation; none is inferred from mutable current roots.
- A future coordinator may consume these captures only through the fenced/private contract. Service-role Storage writes must use immutable unique paths and exact actual-byte registration/readback; do not infer upload fencing from existing staff-JWT RLS. Referenced artifacts survive cleanup and restore.

## Files and proof

Create a CLI-generated additive migration; update every deliberate canonical migration tripwire. Add strict Zod job/capture/claim schemas and hand-written RPC interfaces; leave generated types unchanged. SQL proves queue atomicity, historical binding, inactive/role boundaries, receipts, lease races, fences, byte identity/recovery and private ACLs. Real owned local Auth proves service/staff boundaries and capture/recovery against actual bytes; restore must retain queued jobs and captures. Required frontend/Edge/database CI must pass on the submitted head. Stop before merging the new PR until Dave explicitly approves its number.

## Runtime research

Existing Mac PDF spike proves a 16-page output but not OS isolation. Current Vercel Sandbox documents Firecracker filesystem/network isolation and deny-all DNS/network; require a pinned linux/amd64 image, explicit Chromium sandboxing, no secrets, fixed inputs, killable time/memory bounds and no paid provisioning until actual access/cost is reviewed. The existing team is Pro, verified read-only. Node pdf-lib 1.17.1 is a permissive parser, not a complete validator; a bounded syntax admission policy and isolated structural checks remain required before readiness. The new policy stays off.
