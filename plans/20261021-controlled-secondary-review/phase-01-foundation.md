# Private retrospective review: contract and implementation gates

## Starting baseline and scope

`tests/controlled-drugs/engine/candidate/schema.sql` retains event id/product,
per-product sequence, actor/session, policy/opening/engine revision, record hash
and `secondary_review_required`. `posting.sql` and `constraints.sql` preserve the
flag; the released baseline has no independent review decision. `seal.sql` selects parent
objects by prefix and explicit list, while `review.sql` requires current engine
revision. Adding an incidental parent manifest revision would stale policies.

This package must leave the parent literal, engine-manifest rows, writer bodies,
old migration files and all parent/source data unchanged. A separate schema and
exact sealed facade are preferred over replacing the parent snapshot/required
functions. A pg_temp-only prototype can resolve feasibility but is not acceptance.

## Fixed technical semantics for the first foundation

1. Final decisions target already committed events with
   `secondary_review_required=true`; durable preparation must precede signing.
   Target tuple is event id, product id, sequence, record_hash, original actor id,
   policy_version_id, opening_id and engine_revision. Validate against stored
   authoritative evidence; client hashes never establish authority.
2. Eligibility is an explicit versioned synthetic review definition, separate from
   physical performer permissions: product/site/event-kind scope and allowed
   synthetic reviewer role labels. Install no real role assignments or defaults.
   Required events without configuration remain visible as blocked/unconfigured.
   Select the current definition by exact `(product, controlling_site, event_kind,
   capability)` stream and maximum immutable version, never a matching older row.
   Capabilities distinguish review execution from event/queue read. No wildcard
   or overlapping scope definitions. A disabled latest version revokes the stream;
   no fallback. Profile/role revocation also takes effect in fresh signing checks.
   Resolve exactly one controlling site from retained event/container/source
   evidence; never use a mobile kit's current location or silently choose a policy
   site. Missing/multiple/ambiguous historical sites are unsupported and new
   signing refuses. Queue/read cannot disclose a target without its exact
   read-scope authority; general unsupported-site diagnostics are outside this
   foundation. Gate A must prove the extractor for
   every supported event kind before that kind can be enabled in synthetic tests.
3. One final approve or reject decision per event. A uniqueness constraint and
   event lock enforce cardinality. Reject is terminal for this first round;
   reassessment, quorum, withdrawal and supersession are unsupported. Rejection
   never refunds stock. Each correction is a new target requiring its own review
   when its own immutable flag requires one; old decisions remain historical.
4. Preparation permanently binds one operation UUID, live reviewer, exact target,
   review-definition version, decision, bounded reason and explicit meaning:
   independent record review, with no claim of personal physical observation.
   Freeze a bounded evidence packet and its hash. UUIDs live in the review package
   namespace; an identical stock UUID confers no ownership or recovery rights.
5. Use a 15-minute preparation expiry as a technical packet lifetime, matching the
   existing action protocol's bound. It is not a review deadline. Allow exact saved
   receipt recovery after expiry. If expiry passes during a lock wait, refuse
   unsaved execution in the fresh check before persistence. Bound reason to 1–4000 characters and canonical
   request to 128 KiB; evidence packet to 1 MiB. Reject overflow, never truncate.
6. No review deadlines are implemented in this foundation. Return due_at=null
   and deadline_state=not_configured. Never label an event timely or overdue.
   Queue states: pending, approved, rejected, blocked/unconfigured. Cancellation
   or expiry does not remove a required event. Not-required events are absent.
7. Read/prepare/execute require a matched active staff account and current live
   session. Never trust JWT role metadata as reviewer eligibility. Self-review
   is denied by account id, including through a different session.
8. Fresh signing also requires current applicable entitlement and the exact frozen
   definition version. Parent product suspension/retirement does not itself block
   retrospective review; no physical execution permission is borrowed. Changes
   to eligibility or definition while waiting refuse unsaved execution.
9. Own saved-receipt read/exact retry requires current live active staff identity,
   but not continuing review-execution entitlement. Recover only the exact actor,
   UUID and request; changed target/decision/reason/definition refuses. Deactivated
   accounts or retired tokens cannot recover via the authenticated API. A new
   current session for the same active actor may recover the immutable receipt.
   A privileged restore validator can inspect history without resurrecting tokens.
10. Bounded event/queue reads require explicit synthetic read scope, separately
    checked from execution entitlement. Original operators see committed decisions
    only with that read scope. Another actor cannot read private preparations or
    borrow the original review receipt. No automatic admin bypass.
11. Queue page size defaults to25 and is1–100. Require explicit product/site scope;
   order by per-product event sequence plus event id. Cursor binds the unique
   per-product sequence and scope/filters/current read-definition version. Use a live
    READ COMMITTED keyset traversal: insertions after a cursor may appear in later
    pages; earlier insertions or status changes behind it require a fresh traversal.
    A cursor is invalid when its scope/filter/definition version changes. Do not
    claim a frozen result set, complete stable count or automatic status catch-up.
    No multi-product sequence comparison.
   Bound each traversal to 100 candidate events as well as at most 100 returned
   items. Advance the cursor over the last inspected candidate, including excluded
   site/status rows; sparse filters may return an empty page with continuation.
   Independent implementation review narrowed the original tuple cursor to its
   unique per-product sequence so it cannot disclose an excluded target UUID.
   Measured implementation review reduced the candidate bound from 1,000 to 100:
   the genuine-writer fixture took roughly 12 minutes before its first signing
   case. The smaller bound retains sparse-page continuation and matches the
   maximum page size; metadata expectations are derived and reviewed anew.
12. Cancellation serializes with execution. Cancelled uncommitted work can never
    execute; cancellation after commit returns the saved decision without erasing
    it. Lost ACK uses read/exact retry, never an automatic replacement UUID.

## Prior-commit boundary and terminal completeness

Preparation records a private server-generated context pair: PostgreSQL boot
identity (`pg_postmaster_start_time()`) and top-level full transaction id
(`pg_current_xact_id()`). Final signing refuses when this pair equals the current
context. The latter returns the top-level id even inside a subtransaction, per
[PostgreSQL17 documentation](https://www.postgresql.org/docs/17/functions-info.html).
Never accept a caller-supplied context, compare event xmin to a top-level xid, infer
commit from timestamps, or rely on old transaction-status retention.

The target FK and immutable preparation must be visible in a different transaction
before signing. Preparation may read an event created earlier in its own private
SQL transaction; this is not a committed review or signature. That transaction
must commit both target and preparation before a later signing transaction can
see them. No new target can be signed in its creation transaction, even through
savepoints. Include same-top-level and nested-subtransaction refusal, committed
later execution, other-session visibility, dump/restore and post-restart cases in
Gate A. The boot identity disambiguates retained preparation XIDs after restore;
source records are not rewritten to obtain recovery. A review permission or
expiry check remains required independently of this technical boundary.

There is no separate review action table in this model. A final decision is its
own durable action/receipt: one decision references exactly one existing immutable
preparation with identical actor/UUID/target/request binding; uniqueness is both
per operation and target event. A preparation may have neither outcome, one
cancellation, or one decision, never both. Enforce terminal exclusivity at actual
commit and through the operation lock. Recheck independent reciprocal binding in
restore/corruption tests; do not invent an orphan receipt relation.

## Gate A: independent installation and metadata feasibility

Take exclusive practice barrier `(90271040,0)` before any other package locks;
recheck exact canonical205 ledger/94-statement record, unchanged independently
pinned parent literal, ten writers and original rows after waiting. Reject partial
schema/facade/type/table/function presence; no repair/adoption/IF-NOT-EXISTS path.
Install no policy assignments, deadlines or decisions.

New private schema `controlled_review` owns immutable preparations, cancellations,
final decisions and versioned synthetic eligibility/read definitions. A separate
immutable extension descriptor holds a predetermined independent expected literal.
Enumerate the exact public RPC signatures; provisional names are
prepare/read/execute/cancel_controlled_secondary_review,
read_controlled_secondary_review_event and list_controlled_secondary_reviews.
These are outside the parent's selector and inside the extension's exact seal.
No wildcard or caller-defined facade list. No grants to application roles by default.

Seal all schema owner/ACL, object inventory, function bodies/attributes/GUCs/ACL,
relations/columns/direct column ACL, constraints/indexes/RLS/policies/triggers and
public facades. Reject extra schema objects. Avoid a self-hash cycle: generic
snapshot/check functions read the private immutable descriptor; the installer
compares/inserts a separately reviewed expected literal. No capture/reseal API.

Expected literal generation is an explicit prerequisite deliverable: derive an
allowlisted definition from reviewed DDL/ACL semantics, cross-check PostgreSQL
rendering on a separately reviewed reference realization, freeze expected bytes
and derivation inputs before acceptance. The acceptance installation's live
snapshot is observation only. Keep all old pins, including retained version1,
unchanged. Do not normalize away newly unexpected objects or grants.

Actual feasibility must prove cross-schema FKs do not change the parent snapshot.
The current parent snapshot excludes internal RI triggers, but a source reading
is insufficient proof. Compare full parent snapshot and all original data/ledger
before/after installation and injected failure. If this fails, stop and redesign;
do not weaken the parent seal. Global role/default-ACL/whole-cluster coverage is
not implied by a scoped extension seal.

Candidate-only installation uses an owned transaction on canonical205, without
canonical206 or hosted writes. Later canonical promotion requires separate actual
CLI ledger-insert rollback and strict before/after validators, not a count range.

## Gate B: private protocol and lock discipline

Use READ COMMITTED, reviewed SECURITY DEFINER search paths and the existing live
actor/session helper. Each extension entry checks parent and extension seals.
Raw PUBLIC/anon/authenticated/service_role object access remains revoked. Local
Auth grants must be predetermined in separately pinned fixture expectations;
never grant then live-reseal the acceptance installation.

Lock order: shared practice barrier -> review operation UUID -> target event review
lock. Use distinct documented hash namespaces `controlled-review-operation:` and
`controlled-review-event:`. Never upgrade shared to exclusive, call a stock writer,
acquire a product/lot/container lock, or reuse physical execution contexts.
Recheck identity/session after each blocking lock and immediately before returning
or persisting; new decisions recheck eligibility too. Read saved exact decisions
before live physical-head/catalog freshness checks, after identity authorization.

Decision stores exact target/request/packet hashes, reviewer identity/session/name,
meaning/version, decision/reason, recorded server time and durable exact receipt.
Keep historical session id as evidence, not a live-session FK. Restrictive target/
identity FKs and immutable update/delete/truncate guards preserve evidence.
Enforce preparation/decision binding and cancellation/decision exclusivity at
actual deferred commit; there is no separate action/receipt table.

## Gate C: targeted acceptance before broad suites

- Real Auth operator/reviewer, plus a second eligible competing reviewer where
  cardinality races need it. Deny self-review, forged actor, stale/expired session,
  inactive profile, unconfigured scope, invalid target and unsupported isolation.
- Prove the prior-commit boundary for ordinary and nested transactions, restart
  and populated restore; no merely present uncommitted event can be signed.
- Bind each tuple component; same UUID exact retry, foreign actor, changed payload,
  cross-package UUID isolation, missing ACK, cancellation ordering and expiry.
- Observe actual matching PID/backend-start/blocker before revoking session,
  profile or entitlement, then release each lock and prove fresh refusal. Sleeps
  alone do not establish a queue. Test last lock before decision persistence.
- Race two eligible reviewers; exactly one final decision. The loser receives
  conflict/authorized target status, never an adopted receipt under its own UUID.
- Required/unconfigured/pending/approve/reject queues and page boundaries. Genuine
  correction needs a new signature; old signature cannot approve the correction.
- Compare complete original source rows, stock/custody/positions/holds, clinical,
  financial and all delivery/outbox families; only enumerated review records may
  change. Any necessary audit append must match exact expected full rows with all
  prior rows retained. No count-only comparison or broad audit exemption.
- Parent drift refusal before installation; extension body/ACL/column ACL/schema/
  constraint/trigger/extra-object drift refusal afterward. Inject exact armed late
  failures at every persistence/DDL stage; compare data/catalog/ledger rollback.
- Populated marked clone restore contains approvals/rejection/cancellation and
  missing-ACK work; exact receipts/queue/metadata preserved, old sessions retired,
  fresh authorized recovery succeeds. State selected-schema ledger/owner/default-
  ACL/bootstrap limitations. No Storage bytes or post-backup physical-history claim.
- Source-bound private executed bytes, full maps/raw observations and independent
  owned-runtime/volume/workdir cleanup, including every failed attempt. No PASS
  after deadline or failed cleanup. Declare a new measured probe budget/reserve;
  do not silently expand existing300/900/120 bounds or machine resources.

Only after these gates pass, integrate an optional owned runner, rerun affected
ordinary/history/restore proofs, freeze inputs, independently review sanitized
MD/JSON evidence and obtain all-five exact-head CI plus READY preview. No clinical
browser, whole-C2, commissioning or production recovery claim from API tests.

## Planned files and ownership

All paths below are relative to the isolated implementation worktree root.
This fresh worktree isolates implementation from another session writing in the
original design worktree; the original worktree and all evidence are preserved.
Create candidate `secondary-review.sql`, `secondary-review-acceptance.sql`,
`probe-secondary-review.py` and a separately reviewed expected descriptor/assembler
under `tests/controlled-drugs/engine/candidate/`. Create the focused negative
harness at `supabase/tests/test_controlled_secondary_review_harness.py`: existing
CI discovers `supabase/tests/test_*_harness.py`, not tests under candidate/.
Verify it participates in that actual discovery command; do not merely run the
new file directly or broaden CI without a separate need.
Modify candidate README/owned runner only after targeted acceptance. Create
sanitized launch evidence under `docs/launch-evidence/` after actual proof.
No canonical migration, old pin/artifact, generated types or parent SQL deletion.

Assign schema/descriptor assembly, API/probe, and independent evidence review to
separate owners before implementation. Root owns integration and release. All
workers preserve each other's changes and keep proof input files frozen in runs.

## Evidence gates and deferred decisions

- Separately sealed cross-schema admission passed the actual owned Gate A proof
  and independent review before protocol implementation.
- Final exact inventories and independently derived v2 expectations passed a
  separate reference realization and full targeted acceptance. Retained Gate A
  and v1 artifacts remain unchanged; no live-derived expectation is allowed.
- Full targeted acceptance passed within its separately declared 2,100-second
  workload and 180-second cleanup reserve, including actual natural expiry.
  Existing budgets and independent pinned image checks remain unchanged.
- CI/workflow integration follows that targeted proof. Final exact-head CI must
  rerun the complete acceptance after integration; earlier input maps do not
  silently adopt the changed workflow.
- Affected ordinary canonical-205, genuine historical 187/188 upgrade and actual
  CLI atomicity reruns passed with exact saved source bindings and independent
  cleanup review. Sanitized local evidence is published; final PR CI/preview
  and specific merge approval remain pending.
- Susan's practice eligibility, cadence/deadlines and physical-witness/authority
  rules are intentionally unresolved and inactive. They are not technical defaults.
