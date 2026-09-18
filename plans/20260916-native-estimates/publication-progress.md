# Estimate publication implementation checkpoint

Status: local publication lifecycle and staff workspace acceptance passed. Reviewed delivery, client decisions and accepted-line execution remain incomplete.

Implemented in this branch:

- Server-owned preview and immutable preparations tied to exact draft, household, patient and lifecycle evidence.
- Strict renderer, retained UTF-8 bytes, digest/length identity and authenticated capture/recovery/download handlers.
- Atomic publish/replacement/withdrawal events, immutable history and creator-bound recovery/terminal closure.
- SQL invariant tests, observed contention scenarios, real Auth/PostgREST plus production HTTP-handler harness, and populated restore assertions.

Local static evidence: seven renderer and nine HTTP tests pass; the three Edge entrypoints pass `deno check --frozen`; changed Python files parse. SQL and PL/pgSQL parsing passed separately. These checks do not substitute for database execution. The first owned 128-migration runtime passed 50 SQL assertions, 67 observed contention checks and 78 inherited quantity replay cases, then stopped before Auth workflows because the inherited Supabase status lookup failed. Its owned containers/volumes were removed. A shared status reader now requests explicit non-agent JSON, validates container/workdir/localhost scope and reports sanitized failure categories; the subsequent owned run passed its preflight, all 660 actual Auth/native workflow checks (including 87 publication checks), and 128 populated-restore checks. Cleanup was verified. A separate minimal runtime probe passed both automatic and explicit non-agent status modes, so the original transient failure cause remains unproven. No hosted changes or provider calls were made.

The contention suite checks actual lock waits and a publication timestamp sampled after the holder's real release timestamp. Together with expiry rejection and Denver DST tests, this checks clock placement and deadline calculation. It does not claim a literal real-midnight crossing; such a test requires scheduled execution at that boundary.

The staff workspace now mounts from the saved household draft, locks conflicting draft edits, preserves unresolved operation identities and displays exact sandboxed retained bytes. Seven browser scenarios pass: review attestations/download identity, mobile replacement/withdrawal/history, lost preparation/publish/closure recovery, and late actor/household responses. Browser transport is mocked; separate local Auth/PostgREST/production-handler checks use actual services.

Still required: final branch CI, combined-stack acceptance, explicit reviewed estimate email/SMS adapters, then separate client decision capabilities and accepted-line execution. Publication itself must not create clinical work, inventory movements, invoices, payment requests or outgoing messages.

This branch is based on the final draft UI commit02f5fa7, whose frontend, Edge and database CI run35097366692 passed. The separate integration draft PR157 combines clinical and communications sources; publication is not yet part of that candidate. Follow its `docs/stack-integration-20260916.md` for coordinated migration reconciliation and rollout gates.
