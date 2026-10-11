# Diagnostics PDF engine feasibility — local proof

Baseline: merged PR #237 (`3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`). [Phase 3 package plan](../../plans/2026-10-11-diagnostics-pdfs/plan.md). This is a local engineering experiment, not an installed clinical feature, verified hosted worker, real patient record or practice approval.

A representative schema13 numbered review was rendered from the existing escaped report renderer and synthetic fixtures, with eight long SOAP encounters/addenda, retained problem/weight/treatment history, original/replacement provenance, issued rabies certificate, dental/QOL/anesthesia sections, a 45-row table, inline SVG body-map graphic and selected-original manifest. The prescription arrays are intentionally empty here; prescription/return/reconciliation coverage and the largest admitted package remain separate corpus cases.

## Measured result

| Measurement | Result |
|---|---|
| Engine | Repository lockfile Playwright 1.63.0; Chromium 153.0.8010.12 |
| Environment | macOS, Node 26.10.0, local system fonts (un-pinned) |
| HTML bytes | 36,883 |
| PDF | 16 Letter pages; 179,075 bytes; PDF 1.4 |
| Input HTML SHA-256 | 064dd89537ca256755ef441c41e0835ccf9bf0c307388e4d060e8ddafa9fc959 |
| PDF SHA-256 | b6d040504dce9714d059257ce4496853f1d122132602c2c7c8932e197358f771 |
| Two renders + challenges | 681 ms, including browser launch |
| Node RSS at receipt | 125,742,312 bytes; excludes browser child RSS |
| Isolation challenges | JavaScript did not execute; two external requests aborted before network |
| PDF validation | pypdf 6.20.0 strict parse plus Poppler extraction; all pages Letter; no PDF actions, external URI actions or embedded files |
| Provider requests | Zero |

Final SOAP/table row, literal numeric zero, `µmol/L`, `°C`, certificate title and SVG context survive extraction. Private Storage-path/authority-note markers are absent. Every page was rasterized and reviewed across four contact sheets. No text overlap, missing rows, broken glyphs or clipped table/chart was found. Layout refinements remain: clinical PDF headers should repeat patient/release identity; keep encounter headings/context with following content; optimize the current two-page certificate projection. This synthetic engineering artifact is not a final clinician-accepted report template.

The same local source produced identical bytes twice in the final run; **this is not a deterministic fresh-render guarantee**. Chromium metadata/fonts/build can vary. Capture/reuse registered bytes for recovery and delivery instead of rendering again under an existing artifact identity.

## What is and is not proved

The manifest validates exact UTF-8 input length/hash and rejects changed input. The proposed experiment bounds are 2 MiB HTML, 8 MiB PDF and a 60-second browser-close timer; they are not commissioned production budgets. The script accepts no caller HTML/URL and exposes no service endpoint. It receives no hosted credentials and never queries sources, writes clinical rows or queues communication.

The first external-resource challenge reused the renderer page, whose restrictive CSP had already blocked requests before the interceptor observed them. The proof now uses a fresh page to independently verify the interception layer. This is browser-level defense, **not OS network isolation**. General file/data resource denial, pinned fonts/container, browser-child resource measurement, largest-package corpus, hard process deadline, hosted process launch/binary transport and durable private artifact upload/registration/fencing/recovery remain required. The final deployment design is still provisional.

## Reproduce

From the isolated worktree, with the reviewed repository dependencies and Chromium installed:

```sh
node --experimental-strip-types scripts/diagnostics/pdf-spike.ts
uv run --with pypdf==6.20.0 python scripts/diagnostics/verify-pdf.py
pdftoppm -r 85 -png output/pdf/diagnostics-proof/synthetic-records.pdf tmp/pdfs/diagnostics-proof/page
```

The verifier pins 16 pages to force fresh visual review when pagination changes. The script creates only local synthetic outputs in `output/pdf/diagnostics-proof/`: PDF, escaped HTML, input/output receipt and validation receipt. Do not deploy this spike script as a public renderer. No dependency, migration, frontend route, Edge Function, provider configuration or hosted service was changed by the experiment.
