# Decision database implementation checkpoint

Source: `supabase/migrations/20260916144117_native_estimate_decisions.sql`, created with `supabase migration new native_estimate_decisions` after inspecting CLI help. Test: `supabase/tests/native_estimate_decisions.test.sql`.

Implemented locally: six immutable business tables plus one private mutable 60-reads/minute access budget; staff issue/capture/activate/revoke lifecycle; dedicated service capability proof boundaries; client and witnessed acceptance/decline; one terminal decision per publication; immutable exact receipts and actor/grant-bound closures; staff reconciliation after bearer revocation; private historical verifiers; RLS/raw revocations, narrow RPC grants, redacted audit, deferred integrity and mutation/truncate guards. Existing publication records and event shapes are untouched. No clinical, allowance, inventory, billing or delivery effects.

SQL signatures follow the frozen decision contract. Service capture/access context has exact envelope `{grant,capability_context,context_hash,captured}`. Before capture, grant capability/capture are null and canonical proposed context contains trusted service origin/key version. Captured retries return frozen material. New public/staff decision/grant timestamps emit UTC Z with six fractional digits. Existing publication content and bytes are unchanged.

Lock ordering: bare original operation UUID → native-estimate root → retrieval budget row. Capture uses grant UUID → root; activation never acquires grant UUID after root. Existing receipt recovery precedes current-publication checks, but bearer access must remain active. Inactive bearer access never returns absence. Staff exact-request reconciliation can close a never-recorded grant intent while retaining its grant principal and separately attributing the closer. Closure and recording share the same operation lock.

Static verification: pglast parses the migration and test SQL; PL/pgSQL bodies parse using record placeholders for migration-created composite types (pglast alone cannot resolve the not-yet-created table row types). This does not prove runtime name resolution or DB behavior. No runtime, server, hosted, provider, deploy or commit actions performed by this agent.

SQL coverage includes a real draft/publication fixture, trusted capture exact replay, activation, two-grant competing choices, client acceptance and separately witnessed decline on a replacement, creator scope, immutable early receipts, malformed explicit JSON-null enums/attestations, exact response recovery, close/late-write exclusion, revoked bearer denial and staff reconciliation, historical decisions after replacement, raw ACLs, corrupted restored evidence and no billing/outbox side effects. Actual contention, real Auth/HTTP and populated restore remain parent-coordinated acceptance work. Accepted-line clinical/financial execution and reviewed delivery remain separate required phases.


## Parent verification checkpoint

The corrected SQL suite passes77 assertions in the owned disposable runtime. The first test runner failure came from a nonexistent fixture column; the second came from pgTAP bookkeeping within rolled-back savepoints. Fixture probes now roll back mutations inside PL/pgSQL subtransactions and emit their assertions outside those rollbacks. Production migration behavior was not relaxed.

The observed-lock decision harness passes96 checks across23 contention scenarios. Full actual Auth/HTTP and populated decision restore are still running; this is not final acceptance. Local `npm run check` passed lint, TypeScript,937 unit tests and production build before the subsequent public browser transport work. All work remains local and provider gates remain disabled.

The parent registered decision SQL, contention and actual Auth harnesses before populated native restore, and verified the exact129 migration inventory plus84→129 and51→129 upgrade lists. Public browser transport is being implemented separately; client/staff UI, reviewed delivery and accepted-price execution remain unfinished.


## Completed local foundation acceptance

Owned run58b992a72744 passed77 decision SQL assertions,96 observed-contention checks,68 actual Auth/HTTP decision checks and275 selected populated-native-restore checks. Across all native Auth suites it passed728 checks. Existing publication50 SQL/67 contention and78 quantity replay checks also passed. Container/volume/private runtime cleanup verified; no hosted mutations or provider calls. [Sanitized evidence](../../docs/evidence/native-estimate-decisions-20260916.json) records exact migration/harness hashes; new SQL and harness files were uncommitted at execution, so these hashes—not the then-current Git head alone—identify the tested tree.

The witnessed-decision Auth fixture now converts only the historical publication timestamp's trailing UTC offset to canonical Z, preserving microseconds, and validates through the strict shared schema. It does not relax timestamp validation or truncate occurrence precision. Full frontend check after public transport implementation passed944 unit tests, lint, TypeScript and build. The public transport's seven tests include persist-before-write, verified-review requirement, exact head binding, uncertainty retention and late-response retirement. No route or decision UI is shipped by the transport helpers alone.

CI already invokes the owning native-disposable runner; decision concurrency remains restricted to its owned local project rather than a shared database. Commercial/hosted acceptance and remaining UI/delivery/execution work remain pending.
