# Local authenticated staff review — 2026-10-24

The existing staff workflow prepared, explicitly confirmed and recovered one synthetic stock-adjustment review against genuine local GoTrue password sessions and PostgREST/PostgreSQL. The outer runner exited successfully in 133.343 seconds; the browser phase took 15.505 seconds. The signed receipt, actor, operation UUID and request commitment matched an independent server read and committed database rows.

The browser sent exactly three POSTs: prepare, execute and read. Its test adapter deliberately lost the first successful execute response. The frozen driver's successful assertions establish that reload sent no new RPC, preserved the original recovery pointer, and explicit recovery returned the saved receipt without another execute. No independent per-transition trace is retained. The wrapper separately made 28 Python HTTP requests. CORS OPTIONS were excluded and unmeasured.

Independent review passed 14 composite checks: exact source/tool inventories, 133-function/13-table installation metadata, all preexisting rows, declared permanent-row deltas, canonical stock 19, exact Auth/public audit effects, browser/server request and receipt coupling, observed process identity and normal browser/Vite/service/network cleanup. No emergency process termination was used.

## Included test sources

- `local-authenticated-review-input.ts` restricts the input to fixed local services and disposable synthetic reviewer identity. It parses JWT claims but does not verify their signature; the actual local server performs authentication.
- `record-review-authenticated-fixture.{html,tsx}` composes the existing production transport, lifecycle, pointer store, scoped stock-movement evidence validator and staff workflow. A test-only adapter translates a dummy production-shaped origin/public key to the fixed local gateway; bearer and request bodies remain unchanged.
- `run-local-authenticated-review.mjs` drives explicit staff actions and retained recovery. Its 120-second cutoff is a success deadline, not an autonomous termination guarantee. It must only be launched by the separately reviewed owner/process supervisor after exact source and backend admission. Do not run it as a general-purpose browser test.
- `record-review-local-input.test.ts` checks the local input restrictions.

The sanitized JSON companion contains aggregate results and artifact hashes. Raw credentials, JWTs, Auth responses, private input, process arguments and screenshots are deliberately excluded. These test sources and the summary alone do not recreate the separately bound backend/supervisor experiment.

## Release boundaries

No production route or default evidence gate is mounted. Selection IDs still come from the local harness's accepted publications, not the future detail endpoint. This experiment does not establish production origin/key integration, full evidence admission for every native kind, global private-write security, all protocol cases, natural expiry/contention or populated restore. All corresponding acceptance flags remain false. Hosted writes and provider requests were zero; clinical activation remains disabled.
