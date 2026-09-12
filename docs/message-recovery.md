# Prepared message recovery

Preparation persists an exact draft under a stable request UUID before enqueueing. It never creates an outbox item, calls a provider, or bypasses delivery policy. Browser session storage contains only an opaque UUID under `lrv-message-request:<actor UUID>:<composer scope>`; recipient, subject, body and attachments are not written to browser storage.

## Authenticated RPC contract

- `prepare_message_request(p_actor_id,p_request_id,p_scope,p_conversation_id,p_channel,p_recipient,p_subject,p_body,p_attachment_ids=[])` saves an immutable payload. Scope is 1–200 characters from letters, numbers, colon, underscore and hyphen. Do not include a client name, email or phone in scope. Attachments remain prohibited until a reviewed release workflow is integrated.
- `recover_message_request(p_actor_id,p_scope,p_request_id=null)` retrieves that actor’s exact request, or the actor’s sole unresolved request for the scope when UUID is omitted. Null means no matching visible record, not proof that an interrupted preparation cannot still commit.
- `resolve_message_request(p_actor_id,p_request_id,p_scope,p_abandon=false)` acknowledges an already queued request. With `p_abandon=true`, it abandons an unqueued request or writes an actor/scope-owned tombstone when preparation is unknown. If queueing already committed, it acknowledges the receipt instead of pretending to unsend it.

All three derive and verify the active authenticated staff identity. Supplying another actor ID is insufficient. The result shape is `{request_id,payload,status,receipt}`. Payload uses the composer’s exact `{conversation_id,channel,to,subject,body,attachment_ids}` values. Status is `prepared`, `acknowledged` or `abandoned`. Receipt is null or the queue contract `{success:true,queued:true,outbox_id,message_id,state}`; pending/accepted never implies delivered.

Request locking is shared with enqueue. Prepared payloads cannot change, and tombstones prevent late prepare/enqueue requests from reviving a discarded UUID. One unresolved prepared request is allowed per actor/scope across tabs. A conflicting tab must recover that scope’s saved request and review it. Acknowledgement releases this scope claim while retaining the original payload and outbox history. Separate deliberate sends after acknowledgement receive new UUIDs; this is not a global content-deduplication policy.

The public `enqueue_communication` contract keeps its arguments but now requires an actor-owned, exact prepared payload. Its original implementation is private. Older clients calling enqueue directly fail closed. Current household recipient and suppression/consent validation still occurs at queue time; preparation does not authorize delivery. Existing Edge environment guards and worker preflight checks remain in force.

## Hook contract for composer integration

`useMessageQueue(scope)` retains `send(payload)` and `pending`, and adds:

- `recovery`: null or `{status,requestId,payload,receipt,error?}`. Status is `loading`, `prepared`, `queued` or `unavailable`.
- `recover()`: authenticated reload of the saved request; never sends.
- `discardRecovery()`: explicitly resolves or tombstones the opaque request, returning the server snapshot. If that result contains a receipt, explain that the message was already queued.
- `acknowledgeRecovery()`: explicitly acknowledges a known queue receipt and clears the pointer. It cannot acknowledge an unqueued draft.

Restore channel, subject, body and recipient only after the user reviews `recovery.payload`. If `recovery.receipt` exists, display its existing state and acknowledge it; do not enqueue another message. Do not clear a different, newly typed draft while acknowledging old history. Successful `send` automatically acknowledges the scope claim. If that acknowledgement is interrupted, send still returns its known receipt and leaves the UUID recoverable.

An interrupted preparation in the same page retains its exact in-memory payload and UUID for retry. After reload, a missing server snapshot blocks sending until recovery succeeds or the user explicitly discards the opaque request. A failed enqueue preserves the immutable prepared draft; edits require explicit discard and a new request. Even a definitive queue rejection does not silently recycle the UUID.

Signing out or switching accounts clears in-memory drafts and invalidates in-flight preparation. Opaque pointers remain keyed to their original actor, so that actor can recover after signing in again; another account cannot read the server payload. Hook recovery state is keyed by actor and scope and is hidden immediately when either changes. Blocked session storage fails before preparation rather than silently falling back to unrecoverable browser-only state.

## Validation and deployment gate

Synthetic store tests cover reload, unknown/committed preparation, lost queue response, lost acknowledgement, concurrent clicks, changed content and sign-out. Database tests cover actor ownership, mandatory preparation, immutable payload, one unresolved scope, historical receipt recovery, abandonment tombstones and current consent checks. Existing outbox/inbound fixtures explicitly traverse preparation before enqueueing. No provider requests or deployment are performed by this increment.

Deploy the schema, recovery-aware composer UI and queue client together. Existing queued records remain retained, but a legacy unresolved UUID without a prepared snapshot cannot use the new enqueue path. Its existing outbox history must be reviewed before staff deliberately starts another message.
