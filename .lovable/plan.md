

## Plan: Import VET Connect Hub into The Living Room Vet

This is a large-scale migration. The VET Connect Hub contains **25 pages**, **30+ hooks**, **34 edge functions**, **50+ database migrations**, and **Twilio voice/SMS integration**. It will need to be brought over in phases to keep the project stable.

### Architecture

The hub will live under `/hub/*` with its own layout (sidebar + header), completely separate from the marketing site. Staff will log in at `/hub/login` to access communications tools.

```text
livingroomvet.com/                ← Marketing site (unchanged)
livingroomvet.com/hub/login       ← Staff login
livingroomvet.com/hub/            ← Dashboard home
livingroomvet.com/hub/chats       ← Conversations
livingroomvet.com/hub/clients     ← Client management
livingroomvet.com/hub/call        ← Phone / dial pad
livingroomvet.com/hub/tickets     ← Ticket system
livingroomvet.com/hub/voicemails  ← Voicemails
livingroomvet.com/hub/tools/*     ← Surveys, campaigns, templates, etc.
livingroomvet.com/hub/admin       ← Admin dashboard
livingroomvet.com/hub/settings    ← Settings
```

### Prerequisites

Before any code can work, we need:
1. **Enable Lovable Cloud** on this project (for Supabase database, auth, edge functions, and secrets)
2. **Twilio credentials** stored as secrets (Account SID, Auth Token, phone number, TwiML App SID)
3. **EzyVet API credentials** stored as secrets

### Phased Implementation

Given the scope (~150+ files to port), this must be done across multiple sessions. Here is the breakdown:

---

**Phase 1 — Foundation (this session)**
- Enable Cloud and create the database schema (run all 50+ migrations to create tables: profiles, clients, pets, conversations, messages, tickets, call_logs, voicemails, campaigns, surveys, templates, refill_requests, etc.)
- Set up auth: AuthContext, ProtectedRoute, login/signup pages
- Create the Hub AppShell layout (sidebar, header, bottom tab bar)
- Wire up the `/hub` route group in App.tsx
- Port core shared components: ErrorBoundary, EmptyState, NavLink

**Phase 2 — Core Communications**
- Port conversations system: hooks (use-conversations, use-templates, use-smart-replies), pages (ConversationsPage, ConversationDetailPage), components (MessageTimeline, ReplyComposer, TemplateSelector, etc.)
- Port client management: hooks (use-clients, use-client-history, use-client-files), pages (ClientsPage, ClientProfilePage), components (CreateClientSheet, EditClientSheet, ClientNotesCard)
- Deploy SMS edge functions: send-sms, twilio-sms-webhook, twilio-inbound, triage-message

**Phase 3 — Phone & Voicemail**
- Port TwilioContext and phone components (DialPad, ActiveCallView, FloatingCallBar, IncomingCallOverlay, VoicemailList)
- Port call pages (CallPage, VoicemailsPage)
- Deploy voice edge functions: twilio-token, twilio-twiml, twilio-make-call, twilio-call-status, twilio-recording-webhook, transcribe-voicemail

**Phase 4 — Tickets, Appointments & Pets**
- Port ticket system: hooks, pages, components
- Port appointments: hooks (use-appointments, use-waitlist), components (AppointmentForm, AppointmentList, WaitlistManager)
- Port pet management: components (PetVaccinationCard, AddVaccinationForm, VaccinationHistoryTable)
- Deploy related edge functions

**Phase 5 — Tools & Admin**
- Port campaigns, surveys, templates, alerts, refills pages and hooks
- Port admin dashboard and client import
- Port EzyVet integration (proxy, sync, context panel)
- Deploy remaining edge functions: send-campaign, suggest-replies, import-clients-ai, ezyvet-proxy, ezyvet-sync, etc.

**Phase 6 — Advanced Features**
- Realtime notifications (use-realtime-notifications)
- Consent forms system
- Payment links
- Lab results webhooks
- Email integration (gmail-inbound-webhook, send-email)
- On-call scheduling
- Follow-up sequences
- Wellness reminders

---

### Technical Notes

- All files will be copied from the VET Connect Hub project and adapted to use The Living Room Vet branding (logo, colors, practice name)
- The Supabase client will be configured for the new Cloud instance
- Edge functions will be recreated in this project's `supabase/functions/` directory
- The existing marketing site routes remain untouched; the hub is fully isolated under `/hub`
- Roles will be stored in a separate `user_roles` table per security requirements, replacing the `role` column on profiles

### Estimated Scope
- ~150 frontend files (pages, components, hooks, contexts)
- ~34 edge functions
- ~50 database migrations
- ~10 secrets to configure

### First Step

We need to **enable Lovable Cloud** on this project to get the Supabase database. Once that's done, I'll begin Phase 1: creating the database schema, auth system, and hub layout shell.

Shall I proceed with enabling Cloud?

