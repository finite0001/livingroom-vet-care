# Client message queue integration

All five client SMS/email send paths now call `enqueue-message` with a stable request UUID. The old `send-email`, `send-sms` and `send-provider-email` endpoints return 410 without database or provider access. New messages use the authenticated `ensure_active_conversation` RPC; household creation and consent recording happen in the household workflow.

The composer clears only after durable queue confirmation or an actor-scoped outbox lookup recovers a lost response. Concurrent clicks share one promise. An uncertain request keeps its original UUID and exact payload, and editing cannot silently create another request. Timeline states distinguish queued, preparing, provider acceptance, delivery, failed and uncertain; inbound delivery-failure annotations are shown separately.

Consent reads use `current_sms_consent` to combine the current normalized number, recorded preference and effective suppression. Staff writes use `record_sms_consent` with session actor, evidence and the displayed record version. Browser clocks do not set consent timestamps. A conflict preserves the draft; explicit discard/reload obtains the current record. Recording an opt-in does not clear provider complaints or unrelated exclusions.

## Validation

Full lint, TypeScript, unit suite and production build passed. The combined browser run passed 32 scenarios, including four queue/consent scenarios: lost-response recovery, unchanged retry, disabled delivery, and stale consent preserving an entry without bypassing suppression. Ten new database assertions cover the consent read model and its authorization/suppression behavior. Provider transport remains synthetic; no actual messages sent.

## Remaining rollout work

- The next inbox increment replaces legacy list/read/metadata hooks with the new paginated, per-user RPCs. These migrations and UI changes must deploy together.
- Pending request payloads remain in memory, scoped by authenticated actor/composer, with an unload warning. They are not persisted to browser storage. After a full reload, staff must inspect message history before recreating an uncertain message. Durable draft/recovery UX across reload and navigation still needs acceptance work.
- Authorized record-package attachments, invoice links, reminders and controlled provider round-trips remain separate integrations.
- Provider delivery status is polled while displayed; production realtime/publication and operational alerting still need commissioning.
