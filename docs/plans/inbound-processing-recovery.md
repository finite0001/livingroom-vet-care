# Audited inbound processing recovery

Migration `20260913430000_inbound_processing_recovery.sql` implements the database layer for a safe processing queue and administrator-reviewed retry cycles. It does not fetch provider data, resolve unknown senders, clear consent restrictions, record delivery or change clinical/financial records. Provider webhook receipts and normal service processing remain authoritative. Staff UI and worker outcome reporting are separate increments.

## Current work and immutable evidence

Signed metadata stays in `communication_provider_events`, with lifetime `attempts` preserved. New `cycle_no` starts at zero and `cycle_attempts` counts up to ten. Migration backfills existing cycle count as `least(attempts,10)` and records a clearly labeled `legacy_snapshot`; it does not invent earlier individual attempts. Future claim/release/completion/expiry/requeue transitions append safe state observations to `communication_processing_history`. Receipt identity, original metadata/hash and received time cannot be rewritten or deleted. Operational revisions advance on every event update. Retry action rows and processing history are append-only.

Each claim consumes an allowance, including a worker that crashes. Expired leases below ten are recovered to pending and may be claimed again; expiration at ten becomes `review` with `worker_lease_expired`. No unlimited crash loop or hidden counter reset remains. Recovery uses a bounded batch of 100 expired rows with `SKIP LOCKED`; ordinary claims also skip locked work. Explicit generic fetch/persistence failures schedule exponential backoff and become review at ten. Content mismatch/invalid/oversized content becomes review immediately. Failed worker replies use only the two existing safe failure codes.

Only an exhausted review with `provider_fetch_or_persistence_retry` and no lease is eligible for an administrator retry. Crash-only, unknown legacy reasons and content-review work remain visible and ineligible; this increment does not claim those cases are resolved. Historical legacy review with the exact known generic error and exhausted allowance can be reviewed explicitly; the baseline history labels its limited evidence.

Requeue preserves original receipt facts and lifetime attempt count, appends an administrator action, increments the cycle and resets only that cycle allowance to zero. It performs no provider request. A later worker must still fetch and validate the provider resource and use ordinary completion RPCs. Pending, claimed and review STOP receipts all continue suppressing dispatch; retry never removes suppressions or modifies consent. Unknown-household assignment remains a separate existing RPC/workflow after successful fetch.

## Staff and administrator contracts

`list_communication_processing_queue(p_state text=null,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=50)` permits active staff and returns `{events,has_more}`. Null state means unfinished work; explicit state may be `pending`, `claimed`, `review` or `processed`. Limits are 1–100. The descending keyset uses `received_at,id`; supply both cursor fields together.

Each safe event has exactly:

```text
id, provider, event_id, resource_id, event_type, state,
attempts, cycle_no, cycle_attempts, received_at, available_at,
last_error, revision
```

`last_error` is null or one of `provider_content_requires_review`, `provider_fetch_or_persistence_retry`, `worker_lease_expired`, `legacy_review_required`. It contains no raw upstream text. Staff direct SELECT on the provider-event table is revoked because no frontend consumed it; service SELECT remains for existing workers. No raw metadata/body/HTML, lease tokens or secrets are exposed through the queue. Existing `communication_inbound` and assignment read contracts remain unchanged.

Active administrators use:

- `preview_communication_event_retry(p_event_id)` → `{event,eligible,expected_work_hash,history,history_has_more,retries}` or null. It hashes exact receipt/operational state and returns the latest 100 history transitions and 100 retry cycles, oldest first within each returned subset. History rows contain `{id,event_id,action,state,attempts,cycle_no,cycle_attempts,revision,last_error,created_at}`. Actions are `legacy_snapshot`, `received`, `claimed`, `processed`, `lease_expired`, `review`, `retry_scheduled`, `admin_requeued`. No lease appears in history.
- `requeue_communication_event(p_id,p_event_id,p_expected_work_hash,p_reason,p_attest)` → immutable action row. Reasons are `provider_recovered`, `configuration_repaired`, `processor_repaired`. Explicit attestation is required. The event is locked and the exact work hash/eligibility checked before mutation. Exact actor/UUID/argument replay returns the original receipt before current eligibility; a different payload or actor cannot reuse it.
- `recover_communication_event_retry(p_id)` → the active administrator's own action row or null. Recovery is independent of current event state.
- `list_communication_event_retries(p_before_at=null,p_before_id=null,p_limit=50)` → `{retries,has_more}` for the active administrator's own actions, descending `created_at,id`. This supports recovery after the browser loses its pointer.

Retry action fields are `{id,actor_id,event_id,expected_work_hash,reason,previous_cycle_no,cycle_no,lifetime_attempts,created_at}`. First manual requeue advances cycle **0 → 1**; lifetime attempts do not reset. Staff cannot invoke administrator operations; service cannot authorize an administrator retry. There is no automatic action on opening a preview or recovering a receipt.

## Worker contract and rollout

Existing `claim_communication_event`, `release_communication_event`, `complete_inbound_communication` and `complete_communication_status` signatures remain intact. Release and both completion paths now reject expired/currently superseded leases with SQLSTATE `40001`. The migration patches the two existing completion guards only after checking their exact expected definitions; drift fails migration rather than silently omitting the guard. Ordinary content, household matching, STOP/START ordering, bounce/complaint and delivery evidence logic remains intact.

New service-only `release_communication_event_outcome(p_id,p_lease_token,p_error,p_review=false)` atomically releases and returns the safe event projection above. `p_error` must be `provider_fetch_or_persistence_retry` with false review, or `provider_content_requires_review` with true review. Its durable state is exactly pending or review; the updated worker must derive `retry_pending`/`review_required` from that returned state, not the caught exception class. Null/malformed/wrong-ID responses are errors, not success. PostgREST may map SQLSTATE40001 to HTTP500; callers should inspect the safe SQL error code rather than assume a particular HTTP status.

Apply migration4300 before the updated worker or queue UI. Old workers retain their void release RPC, but their response classification at the tenth failure is not authoritative; the companion runtime increment fixes it. No hosted migration, webhook commissioning, scheduler, provider credential or sending flag is changed here.

## Validation

Local evidence: **44 focused SQL assertions and 39 existing inbound regression assertions passed**. **16 actual concurrency checks passed**, observing competing administrator requeues, a stale worker completion waiting behind requeue, and concurrent worker claims skipping a locked event. The race fixture consumes allowances with ten actual claim/releases and accelerates only its own synthetic backoff. Tests cover actor/RLS/lease privacy, immutable receipts/history, hash/UUID replay, pointer-free recovery, stale/expired leases, crash exhaustion, content-review rejection, STOP suppression and unchanged content/assignment/consent/delivery state. Fixtures were rolled back or removed by owned random IDs; no provider requests occurred.

The runtime companion separately reported **67 actual local HTTP/Auth/PostgREST checks** covering durable tenth-failure reporting, reviewed retries and exhausted crashes. This is local acceptance using synthetic provider responses. Real receiving credentials, provider round trips, staff hosted operation and worker scheduling remain commissioning gates.
