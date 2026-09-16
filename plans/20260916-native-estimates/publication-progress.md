# Estimate publication implementation checkpoint

Status: implementation under runtime verification. The full publication phase, client decisions and accepted-line execution remain incomplete.

Implemented in this branch:

- Server-owned preview and immutable preparations tied to exact draft, household, patient and lifecycle evidence.
- Strict renderer, retained UTF-8 bytes, digest/length identity and authenticated capture/recovery/download handlers.
- Atomic publish/replacement/withdrawal events, immutable history and creator-bound recovery/terminal closure.
- SQL invariant tests, observed contention scenarios, real Auth/PostgREST plus production HTTP-handler harness, and populated restore assertions.

Local static evidence: seven renderer and nine HTTP tests pass; the three Edge entrypoints pass `deno check --frozen`; changed Python files parse. SQL and PL/pgSQL parsing passed separately. These checks do not substitute for database execution. The first owned 128-migration runtime passed 50 SQL assertions, 67 observed contention checks and 78 inherited quantity replay cases, then stopped before Auth workflows because the inherited Supabase status lookup failed. Its owned containers/volumes were removed. A shared status reader now requests explicit non-agent JSON, validates container/workdir/localhost scope and reports sanitized failure categories; runtime verification of that change is pending. No hosted changes or provider calls were made.

The contention suite checks actual lock waits and a publication timestamp sampled after the holder's real release timestamp. Together with expiry rejection and Denver DST tests, this checks clock placement and deadline calculation. It does not claim a literal real-midnight crossing; such a test requires scheduled execution at that boundary.

Still required: successful final-source SQL/contention/Auth/restore runs, staff publication review UI and browser acceptance, explicit reviewed estimate email/SMS adapters, then separate client decision capabilities and accepted-line execution. Publication itself must not create clinical work, inventory movements, invoices, payment requests or outgoing messages.

This branch starts from the draft backend and must be rebased onto the final draft UI commit before combined CI and review. Follow `docs/stack-integration-20260916.md` from the parent branch for coordinated migration reconciliation and rollout gates.
