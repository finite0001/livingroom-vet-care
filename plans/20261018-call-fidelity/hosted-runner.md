# Phase 3B.3 — protected hosted evaluation runner

Continue from merged PR 275, preserving the twelve frozen evaluation inputs and all ten exact request bodies. Root owns this plan, pricing/reservation evidence, release receipts and README. The transport worker owns the planner, probe template, Python runner/hosted adapter and focused tests. No product, migration or permanent function change is needed.

## Implementation and acceptance

1. Extend the transport fingerprint inventory to bind every new runner/test file. Generate a fresh ticket, nonce and fixed expiry only during preparation; do not reuse the expired offline candidate or treat a rerun as recovery.
2. Keep admission validation ahead of credentials or mutations. Bind the exact candidate, ten cases, staging project, deadline and token reservation. Use an exclusive permanent private receipt and a journal persisted before every potentially successful mutation/invocation.
3. Obtain only the staging administrative credential through captured CLI output. The existing OpenAI key stays inside Edge. Permit only fixed project/management, Storage and synthetic probe operations; no SQL, clinical RPC, patient endpoint, key rotation or activation.
4. Baseline function configuration, secret names/digests and bucket metadata. Create only owned resources. Deploy ten JWT-required probes, independently verify gateway metadata and exact downloaded import-relative files/locks, then attest all ten exact requests and unchanged existing flag digests before dispatch.
5. Reserve each case before its sole serial request. Preserve bounded raw outer-response bytes, partial prefixes and safe provider-side evidence. Complete upstream HTTP failures remain complete HTTP evidence even when billing is uncertain. Separate body completeness, dispatch uncertainty and billing uncertainty; stop later cases after an uncertain result. Never retry or resume generation.
6. Preserve full request-ID evidence within explicit bounds: prefix, original hash and truncation state. Redact known credential echoes before any local persistence. OpenAI secret echo handling remains inside the protected probe.
7. Always attempt owned-function cleanup, including attempted deployments whose acknowledgements were lost. Independently confirm absence; retain durable guards until fixed expiry plus 70 seconds. Cleanup-only works after expiry, may retry cleanup/readbacks, and cannot invoke generation.
8. Prove unchanged baseline metadata and flags where observable; record gaps without a clinical row-equality claim. Retain every raw outcome and failed/incomplete cleanup receipt. Import into the unchanged offline packet generator; clinical adjudication remains pending.

## Required local tests before hosted use

Inject CLI/Storage/probe transports to test wrong target/source/JWT/flag baselines, admission before credentials, duplicate receipts/dispatch, lost mutation acknowledgements, interrupted or oversized outer bodies, credential echoes, complete 503/408 responses, uncertainty stopping, no budget refunds, expired cleanup and ambiguous function deletion. Check actual generated callbacks, all generated Deno entrypoints with cached/frozen dependencies, strict TypeScript, Python tests and repository checks. Run ordinary CI without accounts or paid requests.

## Bounded execution

The owner has authorized continuing the protected provider-evaluation step. Before any request, retain the exact reviewed candidate and execution scope, the [documented reservation](provider-pricing-evidence.md), source/profile hashes and the local test receipt. Use at most ten wholly fictional requests, zero retries, no tools/counting/availability requests, no production access and no real call activation. The conservative token reservation is $0.60 per case / $6 total under published PAYG assumptions; it is not an account-verified or provider-enforced bill cap. Ordinary temporary staging infrastructure usage is separate and must be recorded as such. No clinician or practice-policy approval follows from engineering execution.

Status: hosted adapter and injected validation in progress; actual requests not yet attempted. PR 275 merge/deployment receipt will accompany this increment. Older PRs 233/238 are historical evidence reconciliation; draft PR 259 needs a separate current-migration hardening forward-port.
