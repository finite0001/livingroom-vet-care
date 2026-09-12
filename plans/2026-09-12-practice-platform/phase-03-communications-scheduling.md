# Phase 3 — owned inbox, housecall schedule and reminders

Priority: P0. Status: planned. Depends on: phase 1; patient context uses phase 2. Context: [provider research](research/provider-and-hub-notes.md).

## Requirements and architecture

Resend inbound/outbound email and Twilio SMS behind adapters, with canonical Supabase threads. The practice owns its domain/address/number. AgentMail can replace the email adapter if a short trial demonstrates lower implementation effort; avoid two providers owning the same mailbox. Reuse reference-hub UX for assignments, filters, templates, internal notes, attachments and context panels.

## Implementation checklist

1. [ ] Validate chosen domain ownership and configure provider-required DNS/authentication. Set a shared practice Reply-To address. Prototype email send → external reply → correct Supabase thread before building more inbox polish.
2. [ ] Add durable outbox, delivery state machine and provider event deduplication. Reconcile ambiguous sends; surface failures/retries to staff. Fix premature “delivered” UI.
3. [ ] Add signed inbound email/SMS and status webhooks. Retrieve inbound body/attachments, safely render HTML, preserve RFC threading headers, normalize phone numbers and queue unknown senders for review. Return acknowledgements only after durable receipt.
4. [ ] Add client/patient-linked record package selection and preview. Extend client email sending with server-validated attachment IDs; use secure links for SMS and oversized email packages. Internal notes never leave the practice by default.
5. [ ] Add per-user read state, assignment history, all-channel search with server pagination and robust latest-message previews. Add draft protection; notifications must not leak sensitive content on locked screens.
6. [ ] Build day/week calendar, appointment editor, availability, service duration and resource conflict checks. Support clinic/home visit type, address/access notes, travel buffers, canceled/no-show/completed states and `America/Denver` display. Start with Google Maps navigation links; API-based routing/optimization is later enhancement.
7. [ ] Build shared reminder infrastructure: practice templates and schedules, patient-specific override with reason, due event → deduplicated job, quiet hours, timezone, preference/consent, opt-out and bounce suppression. Add lab-work due type absent from current reminder enum.
8. [ ] Appointment updates cancel obsolete jobs. Care completion, external vaccine import, deceased status and opt-out re-evaluate eligibility. Include confirmation/cancellation handling and staff escalation for failed delivery.
9. [ ] Reuse voice/voicemail UX only when real telephony ingestion is configured; this is later than core email/SMS unless launch operations require it. AI suggestions remain staff-reviewed drafts.

## File work

- Modify `/Users/davidedler/livingroom-vet-care/supabase/functions/send-email/index.ts`, `/Users/davidedler/livingroom-vet-care/supabase/functions/send-sms/index.ts`, `/Users/davidedler/livingroom-vet-care/src/hub/components/shared/SendToClientDialog.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/components/conversations/ReplyComposer.tsx`, `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-conversations.ts` and `/Users/davidedler/livingroom-vet-care/src/App.tsx`.
- Create adapters under `/Users/davidedler/livingroom-vet-care/supabase/functions/_shared/providers/`; create `email-inbound`, `sms-inbound`, `delivery-status`, `dispatch-outbox` and `process-reminders` function folders under `/Users/davidedler/livingroom-vet-care/supabase/functions/`.
- Create `/Users/davidedler/livingroom-vet-care/src/hub/features/schedule/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/reminders/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/documents/`; evolve schema and types. No planned deletions.

## Acceptance and risks

Real controlled email and SMS round-trips work without Gmail. Duplicate webhook creates one message; provider failure is visible; retry does not duplicate a send. STOP suppresses manual and queued SMS. Shared household address does not auto-assign a message to the wrong pet. Record package contains exactly selected authorized documents. Moving an appointment sends only its new reminder. Daylight-saving boundary behaves correctly. Provider/DNS/SMS approval and weak housecall connectivity are schedule risks; start onboarding in phase 1.

Next: connect vaccine/lab due events, invoices and certificates to this one delivery mechanism.
