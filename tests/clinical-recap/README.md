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
