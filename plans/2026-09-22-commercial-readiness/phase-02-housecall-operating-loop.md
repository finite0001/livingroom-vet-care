# Phase 2 — housecall operating loop

Priority: P0. Status: partially implemented locally; not commissioned to launch bar. Depends on phase 1 and the approved October service menu.

## Objective

Make the staff workspace usable during a real housecall day, with explicit save state and safe failure behavior.

## Implementation steps

1. Build day/week schedule with clinic/housecall type, service duration, travel buffer, visit address, access instructions, status lifecycle, and `America/Denver` display.
2. Add conflict checks for staff, time, and travel windows. Start with Google Maps navigation links and route-readiness warnings; defer route optimization.
3. Finish reminder scheduling from the local foundation. Appointment schedule/status changes now supersede pending reminders and cancel queued outbound deliveries; current work is the canonical appointment write/reminder revision contract. Remaining work is hosted acceptance, availability policy, templates, and production scheduling.
4. Finish staff-send delivery operations from the durable outbox foundation. The outbox, staff client-message enqueue RPC, worker claim/result/callback RPCs, guarded staff retry/cancel RPCs, local dispatcher, delivery status handlers, and Hub delivery visibility exist; remaining work is provider-document/package outbox design, deployment/scheduling, provider registration, reconciliation workflow, and production dispatcher/provider smoke.
5. Finish authenticated inbound messaging. Signed Twilio inbound SMS now validates signatures, deduplicates `MessageSid`, creates/matches clients, inserts client messages, and handles STOP/START/HELP locally; remaining work is deployment/provider registration, ambiguous sender review UX, inbound email, voice/voicemail, and hosted round trips.
6. Extend document sharing into a reviewed package workflow: select authorized documents, preview recipients, exclude internal notes, snapshot package contents, and send via attachment or expiring link.
7. Add per-user read state, assignment history, patient links, pagination, and delivery reconciliation workflow. Hub delivery failure visibility and guarded retry/cancel actions now exist, but staff cannot yet reconcile failed production sends against provider dashboards/callbacks from the Hub.
8. Complete clinical workflow acceptance: identity, alerts, weight correction/void path, SOAP role expectations, addenda, document association, and archived-patient behavior.

## Files

- Modify now: `/Users/davidedler/livingroom-vet-care/src/App.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/components/layout/nav-items.ts`, `/Users/davidedler/livingroom-vet-care/src/hub/features/scheduling/`, `/Users/davidedler/livingroom-vet-care/src/hub/pages/HubHomePage.tsx`, appointment/reminder migrations and pgTAP tests.
- Later document/package work: `/Users/davidedler/livingroom-vet-care/src/hub/components/shared/SendToClientDialog.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/components/conversations/ReplyComposer.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-conversations.ts`, `/Users/davidedler/livingroom-vet-care/src/hub/features/documents/PatientDocuments.tsx`.
- Current launch worker/webhook slugs are `dispatch-outbound-deliveries`, `resend-delivery-webhook`, `twilio-message-status-callback`, and `twilio-inbound-sms`. Legacy/stub or scheduler job names such as `dispatch-outbox`, `process-inbound`, and `queue-reminders` must not be treated as new launch endpoints without a fresh provider-commissioning decision.
- Add: versioned migrations and tests for canonical appointment writes, reminder revision eligibility, job invalidation, webhook replay, STOP handling, package authorization, and DST boundaries.

## Success criteria

- A moved appointment produces only its current reminder.
- A failed or timed-out send is visible and retryable without duplicate delivery.
- Inbound client reply lands in the correct thread or a review queue.
- Selected record package contains exactly the authorized snapshot.
- Staff can complete a housecall visit on mobile and recover from a lost network response without overwriting clinical text.
