# Diagnostic PDF renderer — package 3B2A

The renderer and strict PDF admission boundary are implemented for review. This package does not yet save generated PDFs to patient records. PR #240's recovery ledger is merged/deployed; both backends were verified at 175 migrations. No new hosted SQL or clinical worker activation is part of 3B2A.

## Implemented behavior

- `template.ts` accepts the reviewed job snapshot and an already-frozen single-patient history census, preserving exact medical text, zero values, original units/references/flags, source versions and staff attribution. It escapes every clinical field and uses existing comparable-series rules. Numeric charts have date/value labels; qualitative and one-point series retain documentary history without a misleading line. Limited history is explicitly identified.
- `sandbox.ts` supplies only bounded synthetic/clinical input and fixed commands to a fresh private VM. Image admission requires an immutable digest in the practice's renderer repository. The application must select that reviewed digest; no public route or scheduled consumer calls this code yet. VM configuration is checked before execution. Binary output uses streaming control-plane reads, avoiding the SDK user-reader's whole-file base64 allocation.
- `worker.mjs` requires Linux x64, UID 12001, denied sudo escalation and no credential-like environment names. Root is used solely by the trusted SDK setup/control plane. The worker launches sandboxed Chromium, checks actual namespace/seccomp status, disables JavaScript/service workers for clinical HTML and rejects resource requests. A separate internal browser context enables the script required to read Chromium's own sandbox status page.
- `pdf_admission.py` admits only the observed classic PDF 1.4 producer subset, not arbitrary uploads. It validates exact object/xref/stream/page-tree structure, decodes escaped names, rejects duplicate dictionary keys and active capabilities, and bounds decompression. qpdf must return zero with recovery suppressed. Hashes stay unchanged; output is never repaired or rewritten.

## Native proof

The public [proof receipt](2026-10-11-diagnostic-pdf-renderer.json) binds the final image/source hashes, actual output hash/length and independent structural validation. It includes a genuine 100-finding report with numeric zeros, qualitative results, Unicode, original incompatible units, multi-date compatible history and an explicit 4-of-5 history limit. The sample has 22 Letter pages; all pages were rendered for visual inspection, with table continuation, graph and provenance pages inspected at readable size.

The worker observed Chromium namespace and seccomp sandboxing, UID 12001, denied sudo, absent credential-like environment names and denied raw DNS, TCP and metadata connections. The adapter checked the provider-returned network/resource/persistence/mount settings. A separate native lifecycle proof started a detached synthetic descendant, verified it existed and observed whole-VM expiry with no snapshot. Command timeout alone is not treated as descendant-cleanup evidence. Every owned trial VM was inspected as stopped/nonpersistent with no current snapshot.

[Sample report](assets/2026-10-11-synthetic-diagnostic-report.pdf), [graph page](assets/2026-10-11-synthetic-diagnostic-graph.png). These are fake records for engineering proof, not clinical acceptance or released patient records. The source/snapshot hashes in their synthetic fixture are placeholders; this proof does not claim a database-frozen manifest.

## Repeatable verification

```sh
npm run check
python3 -B tests/diagnostics/pdf_admission_test.py
node --experimental-strip-types scripts/diagnostics/generate-synthetic-input.ts
docker build --platform linux/amd64 -t lrv-diagnostic-renderer:20261011 services/diagnostic-renderer
python3 -B tests/diagnostics/renderer_local.py --run-synthetic-local
```

The Docker execution proof requires a native x86_64 daemon. It enforces UID 12001, network none, read-only root, all capabilities dropped, no-new-privileges, private IPC, pinned seccomp policy, 2 GB/one CPU, PID/shared-memory/scratch limits and exact owned-container cleanup. Chromium's temporary XDG configuration/cache use the bounded scratch area so crash reporting can initialize without a writable root/home filesystem. The seccomp profile comes from Playwright 1.63.0; it additionally permits `chroot` inside Chromium's private user namespace without granting a host capability. ARM emulation failed closed because Chromium reported no seccomp protection; this is not represented as native success.

The `diagnostic-renderer` CI job runs the genuine native Docker proof and parser counterexamples. TypeScript checks include the renderer. Six unit tests cover escaped clinical text, cross-patient/future/duplicate/substituted sources, long-report contents, binary bounds and forged/substituted receipts. Twenty Python tests include escaped dangerous names, duplicate keys, malformed xref/stream/page references, decompression overflow and an unchanged real 16-page Chromium fixture. qpdf corroborates structure but does not prove all possible PDF content is harmless or that a clinical report is medically correct.

Root dependency audit remains at 18 existing findings (5 moderate/13 high; zero critical), with no new advisory attributable to the added SDK. No unrelated dependency updates are included. Existing lint/chunk-size warnings are retained.

## Runtime and retention

The reviewed image pins the actual immutable runtime, including browser, fonts and native validators. Dockerfile rebuilds can obtain newer apt packages; a rebuild must be re-inspected, re-proven and approved under its new digest before clinical policy selection. The repository is private. Temporary Docker login configuration was removed; global Docker configuration was hash-checked unchanged. No application environment file, DB key, real chart or clinical Storage object was supplied to the worker/image.

Synthetic proofs used existing Pro resources, without a new subscription or clinical worker commissioning. The two-minute configured VM upper-bound compute estimate was below $0.01, excluding registry/storage/network charges; remaining credits were not assumed. The final compressed image is approximately 926 MB. Eight exact owned obsolete image records were deleted after all 15 owned trial VMs were verified stopped/nonpersistent with no snapshot. Only the final reviewed manifest/index remain. No clinical artifact was deleted.

## Remaining work

3B2B must persist the exact rendering manifest, coordinate private processing leases and actual-byte capture/recovery, validate/upload/read back/register the actual Storage object and prove concurrency/restore behavior. Captured bytes do not become ready or exportable merely because this isolated renderer proof passes. Staff review/download and record-release integration follow separately. All 45 launch requirements and real practice sign-offs remain outstanding where not already accepted.

Primary documentation: [Playwright Docker](https://playwright.dev/docs/docker), [Vercel custom images](https://vercel.com/docs/sandbox/concepts/images), [Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference), [qpdf check behavior](https://qpdf.readthedocs.io/en/stable/cli.html), [Sandbox pricing](https://vercel.com/docs/sandbox/pricing), [registry pricing](https://vercel.com/docs/container-registry/limits-and-pricing).
