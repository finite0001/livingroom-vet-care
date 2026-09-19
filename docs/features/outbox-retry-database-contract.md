# Reviewed pre-provider outbox retry

Migration `20260913450000_outbox_retry_recovery.sql` adds an administrator review action for failed native outgoing messages that have never reached a provider attempt. No provider requests, sending configuration, consent updates, clinical release approvals or payment adjustments occur here.

## Authorization and RPC contract

All four public RPCs require the current authenticated, active ADMIN. No service-role browser proxy is necessary. All private helpers and the legacy `retry_communication(uuid,uuid)` are revoked from public, anonymous, authenticated and service roles. The new action table has RLS enabled and no direct application-role privileges.

- `preview_outbox_retry(p_outbox_id uuid)` returns null for a missing outbox or `{outbox,eligible,reason,expected_work_hash,source,history,history_has_more}`. The history is the current ADMIN's latest50 actions on that outbox.
- `requeue_outbox_retry(p_id uuid,p_outbox_id uuid,p_expected_work_hash text,p_reason text,p_attest boolean)` atomically appends one receipt/audit and changes the original outbox to pending. Returns the immutable action. Reusing the same UUID with identical actor and parameters returns its receipt before evaluating current eligibility. Changed parameters or actor fail23505. Changed work fails40001; ineligible work42501; invalid arguments/attestation23514. PostgREST currently maps40001 to HTTP500; callers must recover, not infer absence from status alone.
- `recover_outbox_retry(p_id uuid)` returns the original active ADMIN's exact action or null. It does not rerun the action. Other actors cannot discover the receipt.
- `list_outbox_retry_actions(p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=50)` returns `{items,has_more}` for the current actor, descending `(created_at,id)`, with limits1–100 and a complete cursor pair. This supports recovery after a lost browser pointer.

Action shape: `{id,actor_id,outbox_id,expected_work_hash,reason,previous_revision,queued_revision,created_at}`. Reasons are `configuration_repaired`, `recipient_reverified`, or `source_reverified`; true attestation is mandatory. `queued_revision=previous_revision+1`.

Outbox projection: `{id,conversation_id,client_id,message_id,created_by,channel,state,provider,created_at,updated_at,revision,attempt_count,reason}`. IDs are nonnull UUIDs. Channel is EMAIL/SMS; provider resend/twilio. The safe outbox reason is null or `worker_lease_expired`, `idempotency_window_expired`, `recipient_suppressed`, `recipient_or_actor_ineligible`, `processing_review_required`. No body, subject, recipient, raw error, sender configuration, lease, attachment bytes or usable capability is exposed.

Top-level reason is one of `eligible_for_requeue`, `not_failed`, `provider_evidence_requires_reconciliation`, `original_actor_unavailable`, `recipient_or_conversation_changed`, `recipient_suppressed`, `source_ineligible`, `source_association_ambiguous`.

Source shape: `{family,source_id,eligible}`, with family `message`, `reminder`, `invoice_email`, `release_email`, `document_link`, or `payment_delivery`. Ordinary messages have null source ID. The source field proves only locally evaluated current-source conditions, never provider delivery readiness.

## State and source guarantees

The review hash includes the private outbox intent and revision, provider-evidence presence, active original actor, current household/conversation/normalized contact/consent facts and current source fingerprint. A BEFORE UPDATE trigger increments revision on any actual row change, regardless of timestamp equality, and ignores attempts to override revision. No-op updates leave it unchanged.

An ambiguous client action must retain its original UUID and exact parameters. A changed hash alone cannot prove an old submission obsolete: contact or source eligibility can change A→B→A. Browser cleanup requires a fresh revision **strictly greater** than the original reviewed revision and another exact missing-receipt check. The source hash never replaces receipt recovery.

Requeue locks the outbox before evaluating current state. It requires state failed, no active/stale lease, no attempt count/timestamps/rows, no provider ID, accepted/delivered timestamp, delivery-failure marker, delivery event or reconciliation row. Even a service reconciliation of non-acceptance remains outside this initial workflow. It preserves payload, message ID, attachments, sender metadata, provider history and all final worker guards.

Read-only source checks reuse current reminder, invoice, clinical release, document and payment helpers; they do not call start-attempt functions or materialize private links. They verify immutable association/request parity and captured payload hashes. Multiple association families fail closed. Invalidation, source edits, disabled release policy, depleted document budget, withdrawn/revoked sources and financial changes remain blocked. Payment or document transport bytes are still materialized and verified only by the ordinary final worker. Eligible for requeue does not mean eligible to send under deployed configuration.

## Validation

Local PostgreSQL:41 focused assertions;52 reminder,57 invoice email,44 release email,64 document SMS,31 payment delivery and44 base outbox regression assertions. Source probes exercise the real ADMIN preview on current and invalidated originals; the only helper-driven fixture changes are rolled back. Legacy regression tests explicitly assert browser denial and preserve final-worker protections through clearly labeled owner-only historical fixture setup.

`supabase/tests/outbox_retry_concurrency.py` performs24 checks including observed PostgreSQL lock contention for exact duplicate UUIDs, competing reviewers, changed contacts, same-clock later failures and newly appended attempt evidence. It verifies exact-receipt replay cannot requeue a second failure and cleans owned synthetic rows. `--project-config path/to/config.toml` chooses the local database container. No provider requests.

The companion runtime agent independently ran30 actual Auth/PostgREST/dispatcher checks twice, including exact replay after lost acknowledgment, another preflight failure, and ambiguous start-attempt evidence. Root reran the same30 checks on integration. Those HTTP tests live in the separately owned runtime increment.

Remaining: independently verified provider identity/status/non-acceptance and audited recovery for uncertain or previously attempted work are not implemented by this increment. No production provider readiness or hosted migration deployment is claimed.
