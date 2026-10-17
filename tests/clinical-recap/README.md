# Source-cited native records recap verification

The independent recap lane captures signed native SOAP encounters, every addendum
of those encounters, and an optional complete eligible native problem group. It
does not ingest documents or publish, sign, send, or update clinical records.
The recap policy is seeded draft and the Edge processing gate defaults off.

Run the synthetic owned-runtime proof from the repository root:

```sh
python3 -B tests/clinical-recap/disposable.py --run-synthetic-local
```

Add `--include-sql-regression` for the complete canonical SQL suite, or
`--sql-only` to omit Auth/browser/restore scenarios. The runner reserves its own
loopback ports, creates a uniquely labeled Supabase stack, verifies ownership,
disables scheduled jobs, and removes only its own containers and volumes. It
never connects to a hosted project or calls a real model. Private command logs
stay in a separate temporary evidence directory; ignored `tmp/clinical-recap-*`
files contain synthetic receipts and screenshots.

The HTTP proof uses actual local Auth, PostgREST and recap RPCs with the actual
generation handler and a fake provider dependency. It covers exact reservation,
cancellation tombstones, one-shot dispatch, exact received-result replay, frozen
citations, original versus reviewed text, changed sources, and policy/session
revocation. Concurrency checks observe `pg_stat_activity`, ungranted `pg_locks`
and the expected `pg_blocking_pids` before releasing each barrier. Short-lease
expiry uses a newly inserted private synthetic attempt; it never edits an
immutable attempt identity or a canonical source to simulate expiry.

The browser proof opens real Patient 360 at desktop and 390px widths, deliberately
drops committed reservation/generation/review responses, and recovers their
original durable identities. It checks source-conflict edit preservation,
navigation protection, frozen citations, and absence of clinical review text in
browser recovery storage. A populated dump/restore compares table fingerprints,
routine definitions and security, triggers, constraints and policies, then reads
the restored immutable output/review without regenerating it.

Shared contract/handler and browser-model tests also run in `npm test`:

```sh
node --experimental-strip-types --test tests/clinical-recap/*.test.ts
python3 -B scripts/verify-clinical-audio-edge-isolation.py
```

These checks establish structural citation membership and workflow behavior.
Clinical entailment, real OpenAI output fidelity, and Susan's independent recap
policy approval remain separate activation requirements. Fictional fixtures and
fake provider responses are not evidence of medical accuracy. See the bounded
evaluation plan in
`plans/20261016-vetrec-authenticated/recap-model-evaluation.md`.

## Eight-case real-provider baseline

The initial authorized run is complete: structural 8/8; the fidelity gate is **not
met**. B/C/D/H require resolution. See the [complete engineering summary](../../docs/launch-evidence/2026-10-16-clinical-recap-synthetic-evaluation.md).
No clinical flag or policy was activated. Raw synthetic responses and the complete
clinical review packet remain in ignored private `tmp/clinical-recap-evaluation-*`.

`evaluation-corpus.ts` fixes the fictional A–H signals and a hand-authored
required/forbidden fact inventory. `evaluation-local.py --run-synthetic-local`
creates a separate owned local stack on 653xx ports; `evaluation-capture.ts`
uses actual Auth/native RPCs and the real immutable adapter, verifies canonical
state/hashes and exports a newly versioned corpus before teardown. A fresh
capture has new actual server timestamps/hashes; it is not the old byte-identical
baseline. No provider key or hosted project is used by local capture.

`synthetic-provider.py --corpus FILE --prepare` validates only the exact fixed
fictional fields, identities, selection and inventory, then freezes the full
request/schema/vocabulary/source hashes without hosted operations. Its separate
`--plan PLAN --run-synthetic-provider` mode is explicitly paid, staging-only and
requires a newly authorized bounded run. It deploys eight expiring service-only
fixed-input probes using the existing staging OpenAI secret, verifies every
uploaded source/request before any call, and makes at most one request per case.
A private bucket's eight empty create-only objects provide cross-isolate admission
locks. No hosted clinical rows are read/written and no processing flag changes.
Every attempted function and guard resource is removed and baseline metadata
verified in `finally`, including ambiguous deployment outcomes. Unknown or failed
paid work is never automatically retried; unattempted cases remain visible.

The initial eight-request budget is spent. Do not rerun to obtain a green report.
Prompt/model/contract changes require new versioned deterministic checks and a
separately approved complete baseline; preserve the old failures.

Offline commands never call OpenAI:

```sh
python3 -B -m unittest discover -s tests/clinical-recap -p 'test_*.py'
node --experimental-strip-types --test tests/clinical-recap/synthetic-provider-plan.test.ts
python3 -B tests/clinical-recap/synthetic-provider.py --review-receipt RECEIPT
python3 -B tests/clinical-recap/evaluation-review-packet.py --corpus CORPUS --receipt RECEIPT --engineering-review APPRAISAL --output NEW_PACKET
```

The packet renderer preserves all eight case outcomes, full frozen fields,
assistant text and review flags, exact corpus/manifest bindings and engineering
fact annotations. Source instructions stay literal; arbitrary provider reasoning
metadata is excluded, malformed cases remain visible, and clinical adjudication
stays pending. Source-family omission, a false source-cited claim or missing
claim-specific provenance must not be hidden by an aggregate pass percentage.
