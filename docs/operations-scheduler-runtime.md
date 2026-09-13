# Durable reminder scheduler runtime

`queue-reminders` remains a service-authenticated, default-off worker. Disabled invocations perform no database work. Enabled requests accept only an optional integer `limit` from 1–100 (default 25); request bodies are streamed with a 1 KiB byte bound. It queues existing reviewed reminder policies and never dispatches a provider request.

After validation, the runtime generates one UUID and confirms `start_reminder_scheduler_run` before calling `execute_reminder_scheduler_run`. Migration 4400 atomically queues reminders and records a terminal result. The runtime checks identity, requested limit, timestamps, terminal state and bounded counts, then projects only the safe receipt fields.

Any transport failure or malformed receipt leads only to `recover_reminder_scheduler_run`. Recovery never invokes queue execution. A recovered completed/failed receipt returns HTTP 200 with its durable outcome; a started receipt returns HTTP 202 with null counts. Missing or unreadable evidence returns HTTP 202 `{run_id, outcome: "unknown", dispatched: false}`. Unknown and started outcomes do not mean zero work or a confirmed rollback. A failed receipt means SQL confirmed `queue_transaction_rolled_back`. All responses use `Cache-Control: no-store`.

An unresolved run is retained for operator visibility. The endpoint does not accept a caller-provided run ID or automatically resume that run. Independent future scheduler ticks retain the existing source/job/outbox idempotency guards. This evidence does not establish that a hosted schedule, flags, credentials or provider delivery is configured.

## Local acceptance

```sh
node --experimental-strip-types --test tests/reminder-dispatch/scheduler.test.ts tests/worker-auth/auth.test.ts
node --experimental-strip-types tests/operations/local-roundtrip.ts
```

The actual local HTTP runner requires the already-running local Supabase stack with migrations through 4400. `PAYMENT_TEST_PROJECT=/absolute/project/path` chooses an existing project's `supabase/config.toml` (CI uses its workspace). Without an explicit path, it uses the existing foundation stack and creates an owned temporary status-only config if the old `/tmp` config has disappeared. It never starts, stops or resets a stack. Local keys stay in memory and errors include only generic HTTP/SQL codes.

The runner refuses pre-existing enabled automation policies and verifies that exactly its own due lab source is eligible before executing. It uses a synthetic Auth user promoted to ADMIN, a reviewed email reminder policy, and real PostgREST/SQL calls behind the production handler exposed on localhost. Its adapter discards real committed responses to simulate lost acknowledgments; it does not mock queue persistence. The test checks:

- Staff denial, default-off zero DB work, and invalid input before DB work.
- Due-source discovery before any care job exists.
- Lost start ACK produces an unresolved receipt and no job.
- Lost execute ACK recovers one committed pending outbox handoff with zero provider attempts.
- Terminal SQL replay preserves original counts and changed limits are rejected.
- Malformed execute response recovers the authoritative receipt without replay.
- Actual ADMIN overview, candidate, outbox, scheduler-run, blocked-handoff and Stripe queue page envelopes.
- Service-only run RPC denial for an authenticated administrator.

Validation: 16 focused tests and 26 actual HTTP/Auth/PostgREST checks passed on the local foundation stack. Owned synthetic records and committed child identities were removed and checked after the test; the synthetic Auth identity was deleted. No provider transport exists in this harness, and no email or SMS was sent. SQL rollback/concurrency behavior is covered by the companion 4400 migration tests.
