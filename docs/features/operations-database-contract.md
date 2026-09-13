# Operational visibility database contract

Migration 4400 adds active-administrator operational discovery and service-owned reminder scheduler receipts. No worker invocation, provider request, sending activation, retry, consent change or financial resolution is exposed through these read APIs. This is local implementation evidence; hosted rollout remains blocked by the separately documented partial migration history until coordinated.

## Scheduler evidence

All three RPCs below require service authorization and are denied to staff/anonymous callers:

- `start_reminder_scheduler_run(p_run_id uuid,p_limit integer)` confirms a stable caller-generated UUID with a 1–100 requested limit. Exact replay returns the original receipt; changing the limit fails. It does not queue work.
- `execute_reminder_scheduler_run(p_run_id uuid)` requires that start. It locks the run, returns an existing terminal receipt before queueing, or executes the canonical queue and inserts validated results in the **same transaction**. Concurrent executions serialize; completed and failed receipts never rerun the queue.
- `recover_reminder_scheduler_run(p_run_id uuid)` is read-only and returns the receipt or null. An ambiguous start or execution response must use recovery, not another queue invocation to reconstruct counts.

Run envelope:

```text
run_id: UUID
requested_limit: integer 1..100
started_at: server timestamp
outcome: started | completed | failed
finished_at: timestamp | null
counts: {queued, blocked, skipped, dispatched:false} | null
failure_code: queue_transaction_rolled_back | null
```

`started` means no committed terminal evidence is visible, not failure or zero work. A concurrent observer can see started while execution is uncommitted; after commit it recovers the same completed result. Completed counts are nonnegative integers whose sum cannot exceed the run limit. No caller can supply finish counts. If canonical queueing or count validation throws, an inner PostgreSQL subtransaction rolls back **all its queue changes** before a failed result is appended. Only this known rollback produces `queue_transaction_rolled_back`. Transport errors, cancellation or an outer transaction abort do not justify a failure receipt; an independently committed start remains unresolved. Run/result tables are append-only with no direct API-role access. Explicit nonnull constraints reject incomplete terminal records even in privileged test inserts.

The runtime keeps disabled-before-database behavior: an intentionally disabled scheduler creates neither a client nor a run. The database consequently cannot prove cron, flags or provider credentials are configured. Old direct `queue_due_reminders` calls remain compatible but do not gain run evidence retroactively. No existing runs are fabricated.

## Canonical reminder candidates

`reminder_scheduler_candidates_internal()` extracts the original three-branch vaccine/lab/appointment SELECT verbatim. Migration checks the expected original query before replacing only that query in `queue_due_reminders`; definition drift fails. Canonical queue order remains `job_kind,source_kind,source_id`. Source/version/template/date/channel/policy/handoff predicates and all final per-source/consent validation remain intact.

Candidates are **eligible for scheduler consideration**, not guaranteed deliverable. Care sources with no job yet are included with null job_id. Discovery adds stable policy/job tie breakers to its own cursor without changing the canonical queue ordering. Existing outbox links exclude repeated consideration, including blocked handoffs; blocked/invalidated links are exposed separately. No helper is directly callable by API roles.

## Administrator read RPCs

All reads below require active ADMIN access. No recipients, message bodies, HTML, frozen private contexts, file paths, usable capabilities, credentials or worker leases are returned. Each paginated call has a 1–100 limit and returns an explicit has_more. Pages are independent observations, not a frozen multi-request snapshot.

`operations_overview()` returns:

```text
observed_at
outbox: {pending,expired_claims,uncertain,failed,oldest_pending_at}
inbound: {processing_review,unassigned}
stripe: {queued,processing,quarantined,oldest_unfinished_at}
reminders: {candidate_count,blocked_handoffs,oldest_candidate_at,
            last_run:run|null,last_completed_at,unresolved_runs}
```

Counts are database work states, not provider uptime or delivery claims. Null timestamps/no run mean absence of recorded evidence. Empty queues do not establish health, and no freshness threshold or SLA is invented.

`operations_outbox(p_filter='attention',p_before_at=null,p_before_id=null,p_limit=50)` returns `{observed_at,items,has_more}`, descending created_at/id. Filters: attention, pending, expired_claim, uncertain, failed, accepted. Attention includes pending/uncertain/failed and expired claims. Rows contain `{id,conversation_id,client_id,message_id,channel,state,reason,created_at,updated_at,attempt_count,lease_expired,first_attempt_at,accepted_at,delivered_at,delivery_failure_kind}`. Channel is uppercase EMAIL/SMS. Reason is null, worker_lease_expired, idempotency_window_expired, recipient_suppressed, recipient_or_actor_ineligible, or processing_review_required. Unknown raw errors map to the last code. Delivery failure kind is null/bounced/complained. Conversation and household IDs support accurate navigation; no invoice selection is implied.

`read_stripe_event_queue_page(p_state=null,p_before_at=null,p_before_id=null,p_limit=50)` returns `{items,has_more}`, descending created_at/id. Null means queued/processing/quarantined; completed/ignored can be explicitly selected. Each item preserves the existing safe read_stripe_event_queue fields, including created_at and current work/cycle counts. Original read_stripe_event_queue is unchanged. Old held work remains discoverable regardless of how many newer completed receipts exist. Existing reviewed retry APIs remain the only retry authority.

`operations_reminder_candidates(p_after_key=null,p_limit=50)` returns `{observed_at,items,has_more}`. Each row contains `{cursor_key,job_kind,job_id,policy_id,source_id,source_kind,source_version,template_id,template_version,pet_id,channel,eligible_at}`. Pet ID can be null for household-only appointments. The cursor is the returned ascending cursor_key, not a client-reconstructed key. Eligibility time is the actual appointment reminder instant or Denver midnight of source due date minus the reviewed message-template lead days. This is queue eligibility, not a clinical overdue judgment.

`operations_reminder_blocks(p_before_at=null,p_before_kind=null,p_before_id=null,p_limit=50)` returns `{observed_at,items,has_more}`, descending created_at/job_kind/job_id. Supply all three cursor fields together. Rows contain `{job_kind,job_id,policy_id,outbox_id,state,reason,created_at,invalidated_at,source_kind,source_id,pet_id,appointment_id}`. Source/navigation IDs are derived through actual jobs with null-safe left joins. Unknown historical references stay null. Reasons are final_preflight_source_or_recipient_ineligible, final_preflight_recipient_or_actor_ineligible, or reminder_handoff_blocked; original free text/frozen context is excluded.

`operations_scheduler_runs(p_before_at=null,p_before_id=null,p_limit=50)` returns `{items:[run],has_more}`, descending started_at/run_id. This lists started, completed and failed evidence without conflating them. No observation timestamp beyond actual run times is fabricated.

## Local acceptance and indexing

**53 operational assertions and 20 candidate assertions passed**. The candidate fixture compares extracted identities against the original SELECT across vaccine, lab and appointment sources, policy disablement, template version changes, future appointment times and pagination. Operational tests cover role/permission boundaries, uncreated jobs, private projection redaction, run replay/rollback evidence, stable pagination and more than 100 completed Stripe events hiding an older quarantine in the old discovery path. **15 actual contention checks passed**, including simultaneous starts, duplicate atomic execution and read recovery during an uncommitted completion. Owned local fixtures were removed; no provider calls occurred.

Existing regressions: **49 reminder outbox, 44 communications outbox and 30 Stripe retry assertions passed**. Runtime companion separately reported **26 actual local HTTP/Auth/PostgREST checks**, including lost start/execute acknowledgments and one real pending reminder handoff with no provider attempt. These are local synthetic-source results, not hosted/provider commissioning.

Indexes support descending outbox and Stripe receipt cursors, blocked handoff cursors and scheduler run history. Candidate discovery retains the existing canonical joins/predicates; it is not a materialized backlog that could drift. The 106-row Stripe fixture proves continuation and unfinished filtering; no production-scale latency claim is made. Exact overview counts inherently inspect current work and should be measured against the actual practice volume before adding polling or alert thresholds.
