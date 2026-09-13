# Local payment capability HTTP roundtrip

Run `node --experimental-strip-types tests/payment-access/local-roundtrip.ts` from the repository root with the existing local foundation Supabase containers running. The default local API is port 56321. Set `PAYMENT_TEST_PROJECT` to an explicit local Supabase configuration directory to use another compatible local project. If the original foundation `/tmp` configuration is absent, the runner creates and removes its own status-only configuration. It never starts, stops or resets Supabase.

The harness obtains local credentials without printing them, creates a synthetic Auth user, signs in, and calls real staff/service PostgREST RPCs to create issued invoices, prepare/capture canonical SQL HMAC contexts, recover identical capabilities and attest review. A localhost Deno server exposes the production collection/status runtime for read-only checks. A second adapter uses the same production public handler and real database RPCs with deliberately synthetic provider responses for collection races. Deno runs with `--cached-only --allow-net=127.0.0.1`; provider credentials are empty and external Stripe requests are impossible from the server.

Thirty checks passed against the existing local database, including the migration 3600 payment-token persistence boundary:

- Exact role-separated HMAC reconstruction from canonical SQL capture and recovery.
- Unreviewed denial, real runtime inspection/status, no attempt from inspection, both token-role denials, existing cross-grant denial and durable hash mismatch denial.
- Synthetic provider normalization followed by an actual local payment-ledger insert, then an actual credited partial refund reflected by the production status runtime.
- Lost database acknowledgement after evidence commit followed by retrieval of the same immutable attempt/session.
- Real staff revocation during the synthetic provider operation, evidence persistence, suppressed checkout URL and continued narrow status access.
- No usable collection/status tokens in grant, capture or attempt rows, followed by verified owned fixture/Auth cleanup.

Frozen Deno type checking and focused ESLint also pass. The runner deletes only records referencing its random synthetic fixture identifiers and any provider-profile row it created. Existing compatible local provider configuration is reused and retained. Keys, passwords, access tokens and capabilities remain in process memory.

This verifies local HTTP/Auth/PostgREST integration. It does not verify a real Stripe payment, refund, webhook delivery, email/SMS provider, hosted deployment or production commissioning.

The database CI job installs Deno 2.9.6, checks/caches the harness dependency graph with the committed frozen lock, and runs the roundtrip with `PAYMENT_TEST_PROJECT` set to `github.workspace`. It reuses the job’s already-running isolated Supabase instance. The explicit configuration path was also verified locally against a temporary foundation configuration: all thirty checks passed and the temporary directory was removed. This local check is not a claim that the remote CI job has completed.
