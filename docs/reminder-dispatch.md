# Reviewed reminder automation through the durable outbox

This increment adds a disabled-by-default queue scheduler. It does not configure cron, deploy functions, enable messaging or contact providers. Existing `dispatch-outbox` remains the only delivery worker; its verified sender configuration, deployment policy, consent checks and uncertain-outcome handling still apply.

## Activation and server contract

1. An active administrator approves plain-text wording using the existing care-message-template settings. There is no seeded or automatically approved wording.
2. The administrator calls `save_reminder_automation_policy(p_id, p_expected_version, p_source_kind, p_channel, p_message_template_id, p_message_template_version, p_subject, p_enabled, p_review_note)` through an authenticated staff session. Source kind is vaccine, lab or appointment; channel is EMAIL or SMS. New policies default disabled. An email policy needs a reviewed subject; SMS subject must be empty. There is one versioned policy per source/channel, with immutable approval history. Policy administration currently uses this RPC; the wording editor does not enable automation.
3. Server deployment explicitly sets `REMINDER_SCHEDULER_ENABLED=true` and `APP_ENV=staging` or `production`. `queue-reminders` requires POST with the service bearer credential and accepts only an optional integer `limit` from 1–100 (default 25). A disabled endpoint initializes no database client. Credentials are never accepted as browser configuration.
4. The endpoint calls service-only `queue_due_reminders(p_limit)`. It reports queued/blocked/skipped counts and `dispatched: false`. Arrange recurring invocation separately after operational review; no cron is installed here. The existing delivery worker must be independently configured and enabled.

The queue uses current reviewed vaccine plans and native lab orders, with the selected template's days-before offset. Lab interval definitions remain in the lab module. Appointment jobs use existing scheduling offsets; the wording template's days-before value is not applied again. Appointment `care_name` contains the actual appointment type, America/Denver date/time and saved location. Review appointment wording with these substitutions before enabling it. Unsupported placeholders and active HTML are not interpreted.

## Identity and final delivery checks

`queue_reminder_outbox(p_job_kind, p_job_id, p_policy_id)` is service-only. It derives content, recipient and the original source's approving staff actor on the server, without injecting an authenticated user or calling the staff enqueue API. The source actor, policy approver and template approver must remain active. It creates a SYSTEM conversation message and one durable outbox handoff per job; unchanged retries return that same identity. Immutable origin links preserve policy version and the frozen source/message context.

Every `start_communication_attempt`, including manual retries, recomputes the reminder context immediately before authorizing a provider attempt. Source revisions, cancellation, retirement, patient changes, reviewed wording/policy changes, recipient changes, inactive staff or withdrawn consent block delivery. The original attempt implementation was renamed and its direct grants revoked; the wrapper delegates valid reminders and ordinary manual messages to that existing implementation. Suppressed or invalidated jobs remain blocked even if consent or a setting is later restored. A new reviewed source/template version and eligible job are required; old messages are never silently revived.

Checks cannot retract a provider request that has already begun. Provider acceptance remains distinct from confirmed delivery, and uncertain attempts retain the existing reconciliation workflow. Staff can see those distinctions in Care reminders; preparation status alone never means a message was sent. No stock, clinical treatment, payment or medical due date is changed by this bridge.

## Validation and limits

Synthetic tests cover unauthorized/disabled scheduling, bounded requests, sanitized persistence errors, canonical job/outbox replay, source actor attribution, cancellation after claim, consent withdrawal, sticky retry blocking and valid provider-attempt state transitions. Existing outbox and care-reminder database suites run against the guarded attempt entry point. Browser coverage verifies actual routes, mobile wording review, preserved patient drafts and provider acceptance versus delivery labels. Tests make no live provider calls.

Dr. Susan Edler must review clinical intervals, mappings and message wording before practice use. Staff policy approval records an explicit attestation; the software does not infer clinical approval. This implementation does not add a provider account, verified domain, production secret or delivery schedule.
