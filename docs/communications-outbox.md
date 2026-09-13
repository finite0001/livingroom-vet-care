# Durable outbound communications

The durable text/email queue provides immutable intent, worker leases, attempt history and verified provider delivery state. Subsequent increments integrate inbox sends, signed callbacks, reminders and separately reviewed record/invoice attachments. `send-email` and `send-sms` are retired HTTP410 routes. This document describes the queue contract; [hosted commissioning](hosted-edge-commissioning.md) and [commercial readiness](commercial-readiness.md) track deployment and actual provider acceptance separately.

## Inbox integration contract

Call `enqueue-message` with the signed-in staff access token and:

```json
{
  "request_id": "client-generated-stable-UUID",
  "conversation_id": "conversation-UUID",
  "channel": "EMAIL",
  "to": "the-households-current-email",
  "subject": "Visit summary",
  "body": "Plain text message",
  "attachment_ids": []
}
```

`request_id` is generated once for an intended send and retained across network failures/retries. Keep the same UUID and exact payload when retrying an ambiguous enqueue. Generate a fresh UUID only for a deliberately new message, not to bypass a failure. SMS uses an empty subject and E.164 recipient. Staff identity is derived from the verified session; a caller-supplied actor is rejected.

HTTP 202 returns `success`, `queued`, `outbox_id`, `message_id`, `state`, `accepted`, `delivered`. Initial state is `pending`; `accepted` and `delivered` are false. A repeated unchanged request returns the original row and its current state. Reusing the UUID for different content returns 409. The database transaction inserts exactly one corresponding conversation message, so the frontend must not separately insert a second message.

The UI may clear the compose draft after durable queue confirmation and should display “Queued.” It must not label queued/accepted messages delivered. Join or query `communication_outbox` by `message_id` to display state and sanitized `last_error`. Request current rows on reconnect; an HTTP error can occur after successful queue persistence. Database reads require active staff.

The enqueue endpoint enforces the environment delivery policy before queueing. Its underlying staff RPC also validates current household recipient and SMS consent, and rejects all nonempty attachment IDs. Clinical release authorization will be a separate server workflow; passing an arbitrary document ID is not supported.

## State and retry behavior

- `pending`: durable intent awaiting a worker.
- `claimed`: one worker owns a two-minute lease. Claiming itself does not mean any provider request occurred.
- `accepted`: provider returned a validated message identifier. Delivery is still unconfirmed.
- `delivered`: a provider event was durably recorded after signature verification by the signed webhook handler.
- `failed`: known pre-send rejection or provider rejection. The error code is safe to display without provider bodies, credentials or message text.
- `uncertain`: a connection failure, ambiguous HTTP response, missing provider identifier, or expired in-flight worker lease prevents determining acceptance.

Migration4500 revokes public/staff/service execution of the old unversioned `retry_communication(p_actor_id,p_id)` entry point. Administrators instead use the [reviewed outgoing retry workflow](features/outbox-retry-review.md): exact action UUID, work hash, repair reason and attestation, with immutable receipt recovery. Initial eligibility is failed work with no prior provider attempt or delivery evidence. It retains the original outbox/message/payload and every final source/consent/materialization check.

Resend still receives `Idempotency-Key: livingroom-outbox/<outbox-id>`. The worker retains its23-hour first-attempt guard within the documented24-hour provider window, and frozen sender/Reply-To comparisons. These mechanisms do not authorize uncertain retries through the new review UI: sender values alone do not prove continuity of the Resend account's idempotency scope. Previously attempted and uncertain work requires separately verified provider evidence and a reviewed recovery procedure. See [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

Twilio's standard Message-create API is treated as lacking a usable request idempotency guarantee. Unknown SMS acceptance is never automatically retried. A trusted service operator must inspect provider evidence and use `reconcile_communication(p_id,p_outcome,p_provider_message_id,p_evidence_reference)` to record `accepted` with a receipt ID or `failed` only after establishing non-acceptance. The evidence reference and original attempt history are retained. Evidence-backed non-acceptance resets the legacy retry-window field, but does not make previously attempted work eligible for the new pre-provider review. A reviewed provider-recovery path remains required before authorizing another provider attempt. This RPC makes no provider request and cannot directly claim delivery. See [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource).

## Worker and suppression contract

`dispatch-outbox` accepts POST only with managed server authentication; see [worker authentication](service-worker-authentication.md). It processes at most one job per invocation. No browser, staff token or anonymous key can claim or finalize attempts. Schedule repeated service invocations only after controlled provider commissioning.

The worker respects `APP_ENV`, `OUTBOUND_DELIVERY_MODE`, test recipient allowlists and sender credentials used by the existing delivery policy. Disabled mode does not even claim pending work. It re-checks eligibility immediately before the provider request, including:

- Original sending staff is still active.
- The immutable recipient still matches the household's current channel address.
- Recipient suppression does not exist.
- SMS has affirmative consent for that normalized number with no conflicting opt-out row.

`communication_suppressions` stores normalized channel/recipient exclusions. `suppress_communication(p_actor_id,p_channel,p_recipient,p_reason)` allows active staff to record a suppression. It blocks pending jobs and the pre-send check blocks already claimed jobs. No removal RPC is provided; opt-in/reactivation needs a separate reviewed workflow. Inbound STOP/bounce/complaint ingestion must write this shared suppression source before acknowledging events. A provider request already in flight cannot be recalled by a later suppression.

Attempts are recorded before making the external request. Failure to persist the outcome leaves an in-flight lease that expires into `uncertain`; the worker never blindly retries after this failure. An unused expired lease safely returns to pending. Credentials are never stored in outbox provider metadata.

`record_communication_delivery(p_provider,p_event_id,p_provider_message_id,p_outcome)` is service-only, with event-ID deduplication. Webhook handlers verify authenticity before invoking it. Unknown provider IDs fail; do not guess a patient or message mapping. A late failure cannot regress an already recorded delivered state. Raw webhook payload storage/signature validation is outside this increment.

## Rollout gates

1. Apply migration and deploy `enqueue-message` / `dispatch-outbox` with delivery disabled. `enqueue-message` retains gateway JWT verification and active-staff checks. `dispatch-outbox` uses `verify_jwt=false` with managed server-key authentication; staff/anonymous callers are denied.
2. Verify deployed UI send paths use stable UUID queue submission and queued/accepted/delivered labels. Keep legacy direct-send paths retired.
3. Commission and test the implemented signed webhooks and inbound STOP/bounce/complaint suppression. Confirm provider reconciliation operations and support procedures.
4. Commission the implemented reviewed record/invoice attachment paths and appointment/lab/vaccine reminder adapter. Never expose private document storage paths as public attachments.
5. Configure sender/domain credentials and exact test allowlists, then perform owner-authorized controlled round trips. Verify failed/unknown/duplicate behavior before switching to production live mode.

Tests use synthetic transport and rollback-only database fixtures. Passing them does not establish domain delivery, SMS registration, provider credentials, or real round-trip behavior.
