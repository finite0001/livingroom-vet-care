# Commercial-Readiness Review — livingroom-vet-care

**Date:** 2026-07-07 · **Method:** multi-agent review (5 dimensions, 30 agents; every critical/high finding adversarially verified against the code) · **HEAD:** 5a00308 (main, in sync with origin)

**Goal:** commercially ready in ~2 months (early Sept 2026).

**Confirmed findings:** 1 critical, 7 high, 28 medium, 17 low.

---

## Setup Pathways & Onboarding

> The Hub's auth core (login, role gating, RLS, deactivation handling) is solid, but the setup/onboarding story is not commercially viable yet: there is no way to create the first admin without manual SQL, the password-reset flow emails a link that leads nowhere (no set-new-password page exists), and staff onboarding requires access to the Lovable Cloud console rather than any in-app invite. The communications product itself cannot be 'set up' at all — outbound SMS is an explicit stub and there are zero inbound webhook functions for Twilio SMS or voicemail — and none of the required secrets or provider setup is documented (README is untouched boilerplate). The public marketing site still carries fake 555 phone numbers, including the emergency line, hardcoded in four separate components.

### [HIGH] Password reset flow is a dead end — no page ever lets the user set a new password

**Where:** `src/hub/pages/LoginPage.tsx:39-41`

LoginPage calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/hub/login` })` and shows 'Check your email'. But `grep -rn "PASSWORD_RECOVERY|updateUser|update-password"` across src/ returns nothing: there is no recovery-event handler, no set-new-password form, and no route for it. A user clicking the reset link gets a recovery session and lands back on /hub/login, which just renders the normal sign-in form (it doesn't even redirect authenticated users), so they can never actually change their password. Since accounts are invitation-only with admin-set initial passwords, this broken reset is the only self-serve recovery path.

**Fix:** Add a /hub/reset-password route (or handle the PASSWORD_RECOVERY auth event in AuthContext) that renders a new-password form calling supabase.auth.updateUser({ password }), and point redirectTo at it. Test the full email round-trip.

<details><summary>Adversarial verification</summary>

Verified in code: src/hub/pages/LoginPage.tsx:39-41 sends resetPasswordForEmail with redirectTo /hub/login; grep across src/ confirms zero occurrences of PASSWORD_RECOVERY, updateUser, or any reset/update-password route or form; AuthContext.tsx handles onAuthStateChange but never the PASSWORD_RECOVERY event; App.tsx has no reset route; LoginPage never redirects authenticated users; AdminStaffPage and all edge functions have no password/invite logic. So the reset email genuinely dead-ends with no way to set a new password. Downgraded from critical to high because (1) it is a functional bug with no security exposure, (2) clicking the reset link still establishes a valid session via detectSessionInUrl, so the user is not instantly locked out, and (3) an operator workaround exists — admins already create accounts via the Supabase dashboard and can reset passwords the same way.

</details>

### [HIGH] Outbound SMS is a stub — Twilio delivery is explicitly 'not yet wired', including campaigns

**Where:** `supabase/functions/send-sms/index.ts:110-113`

send-sms inserts the message row, then: `const twilioConfigured = !!Deno.env.get("TWILIO_API_KEY"); const delivered = false; // Twilio delivery not yet wired` — even with the secret set, statusNote is 'Twilio configured but delivery path not yet implemented.' and nothing is sent. CampaignsPage.tsx:144 confirms the same for bulk: 'Recipients are recorded and queued now. Actual SMS delivery activates once Twilio is connected.' For a comms-centric CRM two months from commercial launch, the primary channel does not transmit anything, and no Twilio account/number provisioning is documented.

**Fix:** Implement the Twilio Messages API call in send-sms (account SID, auth token/API key, from-number as edge-function secrets), a campaign send worker, and document Twilio provisioning (number purchase, messaging service, secrets) in a runbook.

<details><summary>Adversarial verification</summary>

Verified against the code. /Users/davidedler/livingroom-vet-care/supabase/functions/send-sms/index.ts lines 110-114 contain exactly the claimed stub: `const twilioConfigured = !!Deno.env.get("TWILIO_API_KEY"); const delivered = false; // Twilio delivery not yet wired` with statusNote "Twilio configured but delivery path not yet implemented." — no fetch to Twilio's API exists anywhere in the function; it only inserts the messages row and an outbound_message_attempts row with delivered=false. CampaignsPage.tsx line 144 confirms the bulk claim verbatim ("Actual ... SMS delivery activates once ... Twilio is connected"), and no other edge function (only send-email, send-sms, suggest-replies exist) references TWILIO. docs/ contains only hub-smoke-tests.md — no Twilio provisioning runbook. So the finding is real and not handled elsewhere. Severity adjusted from critical to high: this is an intentional, transparently labeled stub, not a silent defect — the function returns delivered=false with an explicit note, logs the attempt in outbound_message_attempts, and the UI tells staff delivery is pending Twilio connection. No data is lost (messages are persisted for later delivery), no security impact, and the consent/authorization scaffolding around it is complete. It is a launch-blocking missing integration rather than a code correctness bug, which fits high (must-fix before commercial launch) better than critical.

</details>

### [HIGH] Marketing site ships placeholder 555 phone numbers and an unverified email in 4+ hardcoded places

**Where:** `src/components/layout/Header.tsx:65-69,109-113; src/components/layout/Footer.tsx:105-112; src/components/sections/CTASection.tsx:32-45; src/pages/Contact.tsx:225,302-316,380-383,524-530`

Every public call-to-action dials fictional numbers: `tel:+13035551234` / '(303) 555-1234' appears independently in Header, Footer, CTASection, and Contact (four separate hardcoded copies), and the emergency line on Contact.tsx:380-383 is `tel:+13035559999` '(303) 555-9999' — a fake number presented as an emergency contact for a veterinary practice. `mailto:hello@livingroomvet.com` (Footer.tsx:112, Contact.tsx:316) is also hardcoded and unverified. There is no central business-config module (src/hub/lib contains only avatar-colors.ts and favicon.ts), so go-live requires hunting through files.

**Fix:** Create a single src/config/practice.ts (name, phone, emergency line, email, address, hours) consumed by Header/Footer/CTA/Contact, and replace the 555 placeholders with the real numbers before launch — the fake emergency number especially.

<details><summary>Adversarial verification</summary>

Verified by grep and file reads: tel:+13035551234 / '(303) 555-1234' is independently hardcoded in Header.tsx (65-69, 109-113), Footer.tsx (105-109), CTASection.tsx (32-45), and Contact.tsx (302-311, 524-530); Contact.tsx:378-384 presents fake '(303) 555-9999' (tel:+13035559999) as the after-hours emergency line; mailto:hello@livingroomvet.com hardcoded at Footer.tsx:112 and Contact.tsx:316. No central config exists (no src/config; src/hub/lib has only avatar-colors.ts and favicon.ts; no env-based substitution). Only overstatement is Contact.tsx:225, which is a form-field placeholder attribute (legitimate UX), not a CTA. Severity high stands: a publishable public vet marketing site directing pet owners to a fictional emergency number is a launch-blocking, real-harm issue spread across 4+ files.

</details>

### [MEDIUM] No bootstrap path for the first ADMIN — chicken-and-egg lockout on any fresh deployment

**Where:** `supabase/migrations/20260613223600_0b5db918-2014-43cf-aaf0-08cdccbc4d96.sql (handle_new_user); supabase/migrations/20260614151553_376b87c5-04a7-4f77-8386-321af04d2cfe.sql (admin RPCs)`

handle_new_user hard-codes every new auth user to role 'STAFF' (profiles.role and user_roles both set to STAFF). The only ways to grant ADMIN are admin_update_staff_role / admin_set_staff_active, and both start with `IF NOT public.has_role(auth.uid(), 'ADMIN') THEN RAISE EXCEPTION`. RLS on user_roles likewise only lets existing ADMINs insert roles (20260613183224 lines 94-95). No migration seeds an ADMIN, no env-driven bootstrap exists, and no doc describes the procedure. A brand-new deployment has zero admins and no in-product way to create one — it requires manual SQL against user_roles/profiles. (Project memory confirms: admin bootstrap for finite01@gmail.com is still pending on the live instance.)

**Fix:** Add a one-time bootstrap: either a SECURITY DEFINER RPC/edge function that promotes the caller to ADMIN only when `SELECT count(*) FROM user_roles WHERE role='ADMIN'` is 0, or a documented seed migration keyed to a configured bootstrap email. Document the procedure in a runbook and run it for the current deployment.

<details><summary>Adversarial verification</summary>

All claims verified: handle_new_user (20260613223600, lines 33-37) hard-codes role 'STAFF' into profiles and user_roles; admin_update_staff_role/admin_set_staff_active (20260614151553, lines 35/53) both require the caller to already be ADMIN; user_roles INSERT RLS (20260613183224, lines 94-95) requires ADMIN; repo-wide search finds no seed migration, no bootstrap RPC/edge function (only send-email, send-sms, suggest-replies), and no documented procedure. The gap is real. Severity downgraded from critical to medium: it is an operational bootstrap gap, not a security vulnerability — no data exposure or privilege escalation — and it is resolved with a single owner-run service-role SQL statement (Supabase SQL editor/Lovable), which is how the sole live deployment is already being handled. Impact is a one-time setup inconvenience on fresh deployments, not an exploitable or unrecoverable condition.

</details>

### [MEDIUM] No inbound webhook endpoints — client SMS replies and voicemails can never arrive

**Where:** `supabase/functions/ (only send-email, send-sms, suggest-replies exist)`

The functions directory contains exactly three functions: send-email, send-sms, suggest-replies. There is no Twilio inbound-SMS webhook, no voicemail/recording webhook, and no email-inbound handler. Yet the Hub is built around these: VoicemailsPage.tsx:91 shows 'New voicemails will land here.' with nothing that can ever create a voicemail row, and ConversationsPage can never receive a client reply to an (eventually) sent SMS. There is literally no URL to configure in the Twilio console for this deployment.

**Fix:** Build a twilio-inbound edge function (validate X-Twilio-Signature, match/create client by phone, insert message + bump conversation) and a voicemail/recording-status webhook; document the Twilio console webhook URLs as required go-live setup.

<details><summary>Adversarial verification</summary>

Factual claims verified: supabase/functions/ contains only send-email, send-sms, suggest-replies; no Twilio inbound-SMS, voicemail/recording, or email-inbound webhook exists anywhere in the repo, and nothing can insert voicemail_messages rows (VoicemailsPage.tsx ~line 91 shows the empty state as claimed). But severity is inflated: outbound Twilio delivery is ALSO not wired (send-sms/index.ts:111 'const delivered = false; // Twilio delivery not yet wired', status note 'SMS delivery pending Twilio configuration'), the VoicemailsPage UI explicitly says voicemails appear 'once Twilio Voice + recording are connected', and docs/hub-smoke-tests.md documents delivered:false as expected. This is a known, self-documented unbuilt integration (a go-live gap for the telephony feature), not a critical defect breaking a live flow — no messages are being sent today, so no replies are being lost, and there is no security or data-loss impact. Downgraded to medium as a required go-live/feature-completion item.

</details>

### [MEDIUM] Staff onboarding requires the Lovable Cloud console — no in-app invite flow

**Where:** `src/hub/pages/AdminStaffPage.tsx:105-113; src/hub/contexts/AuthContext.tsx:90-92`

AuthContext.signUp unconditionally returns 'Staff accounts are invitation-only. Ask an administrator to create your account.' (SignupPage is a decorative dead end — the form always fails). AdminStaffPage's only onboarding path is an info alert: 'create their account from the Lovable Cloud backend (Users → Add user), then activate and assign a role here.' That means every new hire requires someone with Lovable project console access — the practice's admin cannot onboard staff from the product. There is also no invite email / temp-password / email-verification handling in code for these console-created accounts.

**Fix:** Add an admin-only 'Invite staff' edge function using the service role (auth.admin.inviteUserByEmail or createUser + recovery link) wired to a form on AdminStaffPage that sets name and role; remove or repurpose the dead SignupPage.

<details><summary>Adversarial verification</summary>

All cited code verified: AuthContext.signUp (AuthContext.tsx:90-92) unconditionally rejects with the invitation-only message; AdminStaffPage (105-113) only offers an info alert directing admins to the Lovable Cloud console; no invite edge function or auth.admin usage exists (functions: send-email, send-sms, suggest-replies only). However, severity is overstated: (1) SignupPage is orphaned dead code — not routed in App.tsx and not linked from LoginPage, so no user ever hits the failing form; (2) LoginPage has a working resetPasswordForEmail flow, so console-created users can set their own password, mitigating the "no temp-password" gap; (3) invitation-only signup is deliberate security hardening, and the console workflow plus in-app activate/assign-role is functional and documented in the UI. This is a real product/operational gap (practice admins can't onboard staff without vendor console access) but nothing is broken or insecure — medium, not high.

</details>

### [MEDIUM] No deployment runbook — README is untouched Lovable boilerplate; required secrets undocumented

**Where:** `README.md; docs/ (only hub-smoke-tests.md)`

README.md still contains the literal 'https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID' placeholder and only generic Lovable instructions. The sole doc is docs/hub-smoke-tests.md (a QA checklist that itself assumes accounts are created 'from the Lovable Cloud backend'). Nothing documents the secrets the edge functions read — RESEND_API_KEY + RESEND_FROM (send-email/index.ts:54-55), TWILIO_API_KEY (send-sms/index.ts:110), LOVABLE_API_KEY (suggest-replies/index.ts:87) — nor Resend domain verification, Twilio setup, custom domain, or the admin bootstrap. A new deployer has no checklist to reach a working system.

**Fix:** Write docs/DEPLOYMENT-RUNBOOK.md covering: Supabase/Lovable project setup, all edge-function secrets, Resend domain + RESEND_FROM, Twilio number + webhooks, first-admin bootstrap, staff onboarding, and go-live config (phones, email, og tags).

<details><summary>Adversarial verification</summary>

All claims verified: README.md is untouched Lovable boilerplate with the literal REPLACE_WITH_PROJECT_ID placeholder at lines 5/13/65; docs/ contains only hub-smoke-tests.md; the four edge-function secrets (RESEND_API_KEY + RESEND_FROM at send-email/index.ts:54-55, TWILIO_API_KEY at send-sms/index.ts:110, LOVABLE_API_KEY at suggest-replies/index.ts:87) are documented nowhere in the repo (grep hits only the three source files). However, 'high' is inflated: this is a documentation gap with zero security or correctness impact — the functions degrade gracefully without secrets (send-sms explicitly returns delivered:false with a Twilio status note), and secrets are managed in Lovable Cloud for this single-operator app. Real redeployability/bus-factor risk, so medium.

</details>

### [MEDIUM] Email sending silently no-ops when Resend is unconfigured, with no admin-visible status

**Where:** `supabase/functions/send-email/index.ts:54-70; src/hub/pages/SettingsPage.tsx`

If RESEND_API_KEY or RESEND_FROM is unset, send-email still inserts the message and returns success:true with delivered:false and statusNote 'Email delivery pending Resend configuration' — recorded only in outbound_message_attempts. SettingsPage only hints at this ('used once email sending is enabled' under the signature field); there is no admin settings surface showing whether SMS/email providers are configured, so staff can believe client emails/texts are going out when nothing is delivered.

**Fix:** Add a provider-status card on the admin Settings page (call a small edge function that reports which secrets are configured) and surface delivered:false prominently in the conversation UI until providers are live.

### [LOW] Deactivated or role-less users get a silent dead end with no explanation

**Where:** `src/hub/components/layout/ProtectedRoute.tsx:12-30`

ProtectedRoute signs out deactivated users and Navigates to /hub/login with no message — the user just gets bounced with no 'your account was deactivated, contact your administrator' explanation. Similarly, an authenticated user with no user_roles row (the smoke-test doc's own scenario: 'Hub queries return no rows') sees empty Hub pages rather than a pending/contact-admin state. Minor, but it turns onboarding hiccups into support calls.

**Fix:** Pass a reason to the login route (query param or state) and show 'Your account is inactive — contact an administrator'; render an explicit pending-access screen when profile exists but roles are empty.

### [LOW] Production HTML points social-preview images at an ephemeral Lovable preview screenshot

**Where:** `index.html:21-22`

og:image and twitter:image are set to `https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/.../id-preview-...lovable.app-1773032491053.png` — a screenshot of a Lovable preview build hosted on Lovable's R2 bucket. When shared on social/messaging, the site shows a stale dev-preview image (and breaks entirely if Lovable prunes the asset).

**Fix:** Host a real branded OG image in public/ and reference it with the production domain before launch.

---

## Admin & Hub UX/UI Code Issues

> The Hub UI code is far better than typical Lovable output — consistent skeleton loading states, empty states, confirmation dialogs, optimistic updates for conversation mutations, aria labels, and a solid mobile shell. The commercially dangerous problems are structural: an account-recovery flow that dead-ends (no PASSWORD_RECOVERY handler), hard row caps (250 clients / unbounded conversations / 1000-client campaign audience) that will hide records and generate duplicate clients at real practice volume, marquee outreach features (Campaigns, Urgent Alerts) that record but never send — leaving campaigns stuck in SENDING forever — and a placeholder "Clinic Browser" page shipped in primary nav with internal dev copy. Secondary issues cluster around error states masquerading as empty lists on most pages, unsaved-edit loss on the ticket editor, missing mobile nav entries (Voicemails, admin Staff), and absent phone/email validation at every client-creation entry point.

### [HIGH] Clients hard-capped at 250 rows — clients beyond the cap are invisible and staff will create duplicates

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-clients.ts:41`

useClients does `.order("last_name").limit(250)` and every consumer searches only that in-memory window: ClientsPage.tsx:20-31 (client-side filter), NewMessageSheet.tsx:25-32 (recipient search — if the client isn't in the first 250 by last name, staff type the phone and the sheet INSERTS a brand-new duplicate client, lines 50-59), and RefillsPage.tsx:105-117 (refill client picker). For a working practice past 250 clients, anyone with a late-alphabet last name silently disappears from search, and messaging them creates duplicate CRM records. useCampaignAudience has the same pattern at .limit(1000) (use-campaigns.ts:50) — campaigns silently exclude clients past 1000.

**Fix:** Replace client-side filtering of a capped list with server-side search (ilike/or query on name/phone/email, or a search RPC) plus paginated/infinite list for the Clients page. At minimum raise the caps and surface a "showing first N" warning, and have NewMessageSheet search the server before offering to create a new client.

<details><summary>Adversarial verification</summary>

Every cited line verifies: use-clients.ts:40-41 does .order("last_name").limit(250); ClientsPage.tsx:20-31, NewMessageSheet.tsx:27-30, and RefillsPage.tsx:117 all filter only that in-memory window; NewMessageSheet.tsx:50-59 inserts a brand-new clients row when no match is selected, and migrations show no unique constraint on clients.primary_phone, so duplicates are actually created. use-campaigns.ts:50 confirms the .limit(1000) campaign-audience cap. No server-side search, pagination, truncation warning, or dedup guard exists anywhere. Latent until >250 clients, but a working practice exceeds that quickly and the failure is silent with CRM duplicate creation, so high severity stands.

</details>

### [MEDIUM] Password-reset flow is a dead end — no way to actually set a new password

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/LoginPage.tsx:39-47`

LoginPage calls supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/hub/login` }), but there is no PASSWORD_RECOVERY handling anywhere: `grep -rn "PASSWORD_RECOVERY|updateUser" src/hub` returns nothing, AuthContext.tsx's onAuthStateChange treats every event identically, and no route/page renders a set-new-password form. A staff member who clicks the emailed recovery link lands on /hub/login (now technically signed in via the recovery session) with the ordinary sign-in form and no prompt to choose a new password — they still don't know their password and the flow silently fails.

**Fix:** Add a /hub/reset-password page (or a mode on LoginPage) that listens for the PASSWORD_RECOVERY auth event / recovery hash, shows a new-password form, and calls supabase.auth.updateUser({ password }). Point redirectTo at that page.

<details><summary>Adversarial verification</summary>

Confirmed: LoginPage.tsx:39-41 calls resetPasswordForEmail with redirectTo /hub/login; grep finds no PASSWORD_RECOVERY handling or supabase.auth.updateUser anywhere in src; AuthContext.tsx onAuthStateChange (lines 52-73) only special-cases SIGNED_IN/INITIAL_SESSION; no route or page (including SettingsPage, which has zero password references) renders a set-new-password form. The flow genuinely never lets the user choose a new password. Downgraded from high to medium: the client uses default detectSessionInUrl + persistSession:true, so the recovery link does sign the staff member in (persisted session, effectively a magic link) — they are not locked out of the Hub — and admins can reset passwords via the Supabase dashboard. It is a broken user-facing flow that silently fails its purpose, not a lockout or security issue.

</details>

### [MEDIUM] Conversations inbox fetches every conversation + every related client/pet with no pagination

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-conversations.ts:74-92`

useConversations selects * from conversations with no limit, then fetches all matching clients and pets and calls get_last_messages for every conversation id. Search, tab, priority and read filters are all applied client-side in ConversationsPage.tsx:54-80. The realtime subscription (lines 45-67) invalidates and re-runs this full 4-query fetch on any row change. With a year of SMS traffic this page's load grows unbounded (Supabase will also silently truncate at the 1000-row default, hiding older archived conversations from the Archived tab).

**Fix:** Add .limit + infinite scroll (useInfiniteQuery keyed by tab/status), or at least a hard .limit with server-side status filtering, and move search server-side. Keep the debounced realtime invalidation but scope refetch to the first page.

<details><summary>Adversarial verification</summary>

Verified in code: use-conversations.ts:74-91 selects * from conversations with no .limit() and no status filter, then fetches all clients/pets and calls get_last_messages for every conversation id (4 unbounded queries); ConversationsPage.tsx:54-80 applies tab/priority/read/assigned/search filters entirely client-side; the realtime subscription (lines 45-67) invalidates and re-runs the full fetch on any row change (debounced 500ms, as the finding notes); no max_rows override exists, so PostgREST's 1000-row default would silently hide older conversations (Archived tab first). All claims accurate. Severity adjusted high->medium: it is a scalability/eventual-truncation issue, not a security flaw or currently-manifest bug — a single-clinic inbox is likely well under 1000 rows today, degradation is gradual, the refetch storm is already debounced, and lightweight paths (useUnreadCount, useConversation) already exist for the hot spots.

</details>

### [MEDIUM] Mobile bottom nav omits Voicemails and the admin Staff page — unreachable on phones

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/components/layout/BottomTabBar.tsx:22-38`

The mobile More sheet's moreItems list has no entry for /hub/voicemails (desktop sidebar has it at DesktopSidebar.tsx:20, with an unread badge), and adminMoreItems contains only /hub/admin and /hub/admin/import — /hub/admin/staff (activate/deactivate staff, change roles) is missing. This is a house-call practice whose staff are in the field on phones; voicemails and staff management are unreachable from mobile navigation except via HubHomePage quick actions (voicemails only) or typing the URL.

**Fix:** Add { path: "/hub/voicemails", label: "Voicemails", icon: AudioWaveform } to moreItems and { path: "/hub/admin/staff", label: "Staff", icon: Users } to adminMoreItems in BottomTabBar.tsx.

<details><summary>Adversarial verification</summary>

Verified: BottomTabBar.tsx moreItems (lines 22-33) omits /hub/voicemails and adminMoreItems (lines 35-38) omits /hub/admin/staff, while DesktopSidebar.tsx has both (lines 20, 36); AppShell.tsx confirms BottomTabBar is the only mobile nav (md:hidden wrapper, sidebar is hidden md:flex). Grep confirms /hub/admin/staff has no link anywhere except DesktopSidebar — genuinely unreachable on phones without typing the URL. However, severity is overstated: Voicemails is reachable on mobile via the HubHomePage quick-action tile (HubHomePage.tsx:24) on the default Home tab — two taps from anywhere — so that half is a discoverability/unread-badge gap, not unreachability. The truly unreachable half (admin Staff page) affects only admins for occasional tasks (activate/deactivate, role changes) that can be done on desktop. No data loss or security impact; routes work when reached. Real nav-parity bug with a trivial two-line fix, but medium, not high.

</details>

### [MEDIUM] Campaigns are inserted as status SENDING but nothing sends — cards show 'SENDING' forever

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-campaigns.ts:101`

useSendCampaign inserts the campaign with status: "SENDING" and recipient rows, but there is no delivery backend ("Actual SMS delivery activates once Twilio is connected" — CampaignsPage.tsx:144). Nothing ever transitions the row to COMPLETED, so every campaign card renders the amber SENDING badge (CampaignsPage.tsx:20-30) indefinitely with sent_count 0. AlertsPage has the same record-only behavior (AlertsPage.tsx:61 "Records the alert now; actual SMS broadcast activates once Twilio is connected") — an "Urgent Alerts" tool that cannot alert anyone. For a commercial launch in two months these are the marquee outreach features.

**Fix:** Wire the send-sms/Twilio pipeline before launch (edge function iterating campaign_recipients, updating sent_count/status), or until then insert campaigns as QUEUED/DRAFT with UI copy and badge reflecting that, and hide/disable Alerts' Send button behind a config check instead of shipping a no-op emergency broadcast.

<details><summary>Adversarial verification</summary>

Verified: use-campaigns.ts:101 inserts status "SENDING" and nothing ever transitions it to COMPLETED — no edge function references the campaigns table (send-sms/index.ts:111 hardcodes delivered=false, "Twilio delivery not yet wired"), and the only DB trigger on campaigns is updated_at. Cards do render a permanent amber SENDING badge, and AlertsPage is record-only as quoted. However, severity is overstated: this is a disclosed, intentional pre-Twilio stub, not a silent failure — CampaignsPage.tsx:143-145 and AlertsPage.tsx:61 tell staff delivery activates once Twilio/Resend is connected, and the success toast says "queued"/"recorded". The actual code defect is the misleading persisted SENDING status (the campaign_status enum already has SCHEDULED/DRAFT which should be used instead); the missing delivery pipeline is a known launch-roadmap gap, not a regression. No security or data-loss impact. Real, but medium: a status-modeling/UX-truthfulness fix plus a launch checklist item, matching the finding's own fallback proposal.

</details>

### [MEDIUM] "Coming Soon" placeholder (Clinic Browser / ezyVet) still in production nav, with internal dev copy

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/PlaceholderPage.tsx:21`

PlaceholderPage renders a Construction icon, "Coming Soon", and the internal note "This feature will be ported from VET Connect Hub in the next phase." It is routed at /hub/tools/ezyvet (App.tsx:108) and advertised in BOTH navs as "Clinic Browser" (DesktopSidebar.tsx:31, BottomTabBar.tsx:31). Staff tapping a first-class nav item hit a stub that name-drops another product.

**Fix:** Remove the Clinic Browser nav item and route until the feature exists, or if it must stay, replace the copy with customer-appropriate wording (no "VET Connect Hub").

### [MEDIUM] Query errors render as empty states ("No tickets", "No calls yet") on most Hub pages

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/TicketsPage.tsx:35,88-95`

TicketsPage, SurveysPage (SurveysPage.tsx:26,58-65), AlertsPage (:19,71-74), CampaignsPage (:35,69-76), CallPage (:30,43-50), VoicemailsPage (:64,85-92), RefillsPage (:35,59-66) and TimeClockPage all destructure only { data, isLoading }. On a failed query (RLS change, network drop) isLoading goes false and data stays undefined, so the page confidently shows "No tickets" / "No calls yet" — staff will believe the queue is clear when it actually failed to load. AdminDashboardPage.tsx:78 (`isLoading || !data`) instead shows skeletons forever on error. ClientProfilePage.tsx:17,37 shows "Client not found" on a fetch error. Only ConversationsPage and ClientsPage handle isError (ConversationsPage.tsx:257, ClientsPage.tsx:58).

**Fix:** Destructure isError/error in each page and render the existing EmptyState with a 'Failed to load — Retry' message (refetch on action), mirroring the ConversationsPage pattern.

### [MEDIUM] TicketDetailPage: unsaved edits silently clobbered by refetch and lost on back-navigation

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/TicketDetailPage.tsx:54`

The whole ticket is edited in local state seeded by `useEffect(() => { if (ticket) setForm(toForm(ticket)) }, [ticket])`. useTicket (use-tickets.ts:60-70) has no staleTime and React Query's default refetchOnWindowFocus, so if the ticket row changes server-side (a colleague saves, or the user tabs away and back after a change), the refetched object resets the form and destroys in-progress edits with no warning. Save is also a full-row last-write-wins update (use-tickets.ts:87-92), so two staff editing simultaneously overwrite each other's fields. There is no dirty-state guard on the Back button (line 78) — edits vanish silently.

**Fix:** Only seed the form once per ticket id (or when not dirty), track a dirty flag with an unsaved-changes prompt on navigation, and consider patching only changed fields or comparing updated_at to detect concurrent edits.

### [MEDIUM] No phone/email validation or duplicate check anywhere clients are created

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/components/clients/CreateClientSheet.tsx:28-40`

CreateClientSheet inserts primary_phone/primary_email as raw free text (only first/last name required). NewMessageSheet.tsx:103 accepts any string in the phone field and inserts it as a new client's primary_phone (lines 54-57). ImportPage.tsx:66-74 imports CSV rows with no phone/email format validation and, per its own banner (line 157), "does not de-duplicate against existing clients." Since SMS eligibility matches consent rows against a digit-normalized primary_phone (use-campaigns.ts:34,71), malformed numbers silently make clients permanently unreachable, and duplicates fragment conversation history.

**Fix:** Validate/normalize phone to E.164 (and basic email regex) at all three entry points before insert; on create/import, check for an existing client with the same normalized phone and offer to use it instead.

### [LOW] Conversation assignment mutation has no cache invalidation or optimistic update

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/ConversationsPage.tsx:90-96`

handleAssign updates conversations.assigned_to_id directly via supabase with only an error toast — no queryClient.invalidateQueries and no success feedback, unlike every other conversation mutation in use-conversations.ts which does optimistic update + onSettled invalidation. The UI only corrects itself because the debounced realtime subscription (use-conversations.ts:45-67) happens to refetch; if realtime is disabled for the table or the socket is down, the list shows a stale assignee and the 'Assigned to' filter misfilters.

**Fix:** Move assignment into a useMutation in use-conversations.ts with the same onMutate/onSettled invalidation pattern (and a success toast).

### [LOW] Timesheet CSV export and totals silently truncated by row caps

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-time-clock.ts:103`

useMyShiftsRange caps at 500 rows when a date range is set and 100 otherwise. MyTimePage.tsx computes 'Hours (filtered)' totals (lines 69-80) and Export CSV (lines 89-109) from that capped result with no indication of truncation — a payroll export over a long range can silently omit shifts. TimeClockPage's 'Past 7 days' total similarly derives from useMyShifts(30) capped at 100 entries.

**Fix:** Either page through all rows for exports/totals, or show a 'showing first N entries' warning when data.length hits the cap.

### [LOW] Dead SignupPage component; unknown /hub/* URLs fall through to the marketing 404

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/SignupPage.tsx`

SignupPage.tsx is referenced nowhere (grep for SignupPage//hub/signup returns only the file itself) and AuthContext.signUp is hard-coded to return an invitation-only error — dead code that will drift. Separately, App.tsx has no Hub-scoped catch-all, so a typoed Hub URL (e.g. /hub/admin/staf) renders the public marketing NotFound page, dropping staff out of the Hub shell entirely.

**Fix:** Delete SignupPage.tsx (and the unused signUp context method), and add a `/hub/*` catch-all inside the AppShell route that shows a Hub-styled not-found with a link back to /hub.

### [LOW] Non-admins hitting admin routes are silently bounced with no explanation

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/components/layout/ProtectedRoute.tsx:32-33`

ProtectedRoute redirects to /hub with `<Navigate replace />` when requiredRole fails — graceful (no crash, and admin nav items are hidden for non-admins in both DesktopSidebar.tsx:126 and BottomTabBar.tsx:118), but a STAFF user following a shared /hub/admin link just teleports home with zero feedback. AdminStaffPage additionally has its own in-page 'Access denied' alert (AdminStaffPage.tsx:85-94) that is unreachable because the route guard fires first — inconsistent belt-and-suspenders.

**Fix:** Show a toast ('Admin access required') on the redirect, or render a small access-denied screen; remove the unreachable in-page check or keep it as the single mechanism.

### [LOW] Voicemail 'Mark read' disables the button on every card while one mutation is pending

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/VoicemailsPage.tsx:94`

`marking={markRead.isPending}` is passed to every VoicemailCard, so while one voicemail is being marked read, all other Mark-read buttons disable (VoicemailsPage.tsx:34). Minor jank, but noticeable when triaging a backlog on a slow connection. Similar per-row-vs-global pattern is handled correctly in AdminStaffPage via busyId.

**Fix:** Track the pending id (markRead.variables while isPending, or a local busyId like AdminStaffPage.tsx:35) and disable only that card's button.

---

## Commercial-Readiness Feature Gaps

> The app is a polished shell around a communication core that does not communicate: outbound SMS is an explicit stub (send-sms records but never delivers), there is no inbound webhook of any kind (so conversations are one-way and the Phone/Voicemail pages can never populate), and the marketing site's entire booking funnel dead-ends in a contact_submissions table that no Hub page or notification ever reads — while the site itself publishes fake 555 phone numbers. Beyond the channel layer, most \"tools\" are write-only records masquerading as actions (campaigns stuck in SENDING, alerts that broadcast nothing, surveys that can never be sent or answered, refill approvals that notify no one), and the schema contains a full appointment/reminder/consent/payment-link subsystem with zero UI or workers. To charge customers in two months the priority order is: real Twilio send + inbound webhook + STOP handling, a lead inbox/notification for contact submissions, real contact details, then a minimal appointments page and one shared consent-gated dispatch worker to make campaigns/alerts/reminders honest; surveys, ezyVet, and payment links should be cut or explicitly scoped. Data-lifecycle basics (retention cron, audit-log viewer, client export/deletion, delivery-failure visibility) and contact-form spam protection are needed before real client/patient data accumulates.

### [HIGH] Outbound SMS is not actually delivered — core CRM channel is a stub

**Where:** `/Users/davidedler/livingroom-vet-care/supabase/functions/send-sms/index.ts:110-114`

The send-sms edge function inserts a `messages` row and an `outbound_message_attempts` row, then hard-codes `const delivered = false; // Twilio delivery not yet wired` with status note "Message recorded. SMS delivery pending Twilio configuration." Even when TWILIO_API_KEY is set the note says "Twilio configured but delivery path not yet implemented." The UI acknowledges this (NewMessageSheet.tsx:115 placeholder "will be logged; SMS delivery pending Twilio setup"; ConversationDetailPage.tsx:84 toasts "Message recorded…"). SMS is the Hub's default reply channel (ReplyComposer defaults to SMS), so the practice's primary client-communication workflow produces log entries, not messages.

**Fix:** Implement the Twilio Messages API call in send-sms (with Messaging Service SID, error capture into outbound_message_attempts.error_text, and delivery status callback webhook), complete A2P 10DLC registration, and set delivered from Twilio's response. This is the single biggest blocker to paying operation.

<details><summary>Adversarial verification</summary>

Verified: supabase/functions/send-sms/index.ts:110-114 hard-codes `const delivered = false; // Twilio delivery not yet wired` with both quoted status notes; TWILIO_API_KEY is only checked for existence and no Twilio API call exists anywhere in the repo (only edge functions: send-sms, send-email, suggest-replies). UI confirms the stub (src/hub/components/conversations/NewMessageSheet.tsx:115 placeholder; src/hub/pages/ConversationDetailPage.tsx:84 toast — note actual paths are src/hub/, not src/pages/hub/). SMS is indeed the default reply channel (ConversationDetailPage.tsx:189 defaults to SMS unless client prefers EMAIL). The finding is real and launch-blocking, but severity is adjusted from critical to high: this is an intentional, fully disclosed stub (code comment, delivered:false in the API response, outbound_message_attempts log, and UI toasts all say delivery is pending), the app is pre-launch, no staff are silently misled, and no data is lost — it is missing functionality, not a hidden defect, security hole, or data-corruption bug.

</details>

### [HIGH] The public site's only booking pathway dead-ends: contact submissions are never seen by staff

**Where:** `/Users/davidedler/livingroom-vet-care/src/pages/Contact.tsx:103`

Every "Book Appointment" / "Book Your Visit" CTA (Header.tsx:65-73, HeroSection.tsx:90, CTASection.tsx:29, ServiceDetailLayout.tsx:249) funnels to /contact, whose form inserts into `contact_submissions`. Grep shows zero references to contact_submissions anywhere under src/hub/ — no Hub page, hook, or admin view reads it — and no edge function/trigger sends a notification email or creates a ticket/conversation. RLS grants staff read (migration 20260613225133 R2-6) but nothing uses it. A prospective paying client who submits the form is told "We'll get back to you within one business day" while the message sits in an invisible table.

**Fix:** Minimum viable: add a Hub "Inbox/Leads" page reading contact_submissions (with read/handled state) plus an email notification from a DB webhook/edge function; ideally auto-create a ticket or conversation from each submission.

<details><summary>Adversarial verification</summary>

Verified: Contact.tsx:103 inserts into contact_submissions; all Book CTAs (Header.tsx:71/115, HeroSection.tsx:88, CTASection.tsx:24, ServiceDetailLayout.tsx:80/85/244, Services.tsx) link to /contact; grep confirms zero contact_submissions references in src/hub (none of the 22 Hub pages read it); the only edge functions (send-email, send-sms, suggest-replies) never touch the table; no DB trigger/webhook exists; the staff-read RLS policy (migration 20260613225133) is indeed unused. So form submissions genuinely land in a table no UI or notification reads, while the user is told staff will respond. However, "critical" is overstated: the Contact page also displays phone (tel:+13035551234) and email (mailto:hello@livingroomvet.com) alternatives — the form is not the sole pathway — the data persists and is staff-readable via the Supabase dashboard, and the visible 555 placeholder numbers suggest the site is pre-launch. Real, business-impacting functional gap, but not critical.

</details>

### [HIGH] Marketing site ships fake placeholder contact info (555 numbers, unverified email, dummy map)

**Where:** `/Users/davidedler/livingroom-vet-care/src/pages/Contact.tsx:302-385 (also Header.tsx:65, Footer.tsx:105)`

The published phone number is (303) 555-1234 and the after-hours emergency line is (303) 555-9999 — 555 numbers are non-dialable placeholders, repeated as tel: links in Header, Footer, Contact, and the "Prefer to Call?" CTA. The Google Maps iframe src is a generic coordinates embed with a placeholder timestamp (Contact.tsx:439). For a real practice, customers literally cannot call, and the emergency number claim is a safety/liability issue.

**Fix:** Replace all tel:/display numbers with the practice's real Twilio/business number and a real emergency referral line, verify hello@livingroomvet.com works, and embed the real Google Maps place. Grep for '555' across src/ before launch.

<details><summary>Adversarial verification</summary>

Verified: (303) 555-1234 tel: links are hardcoded in Header.tsx (65, 109), Footer.tsx (105), CTASection.tsx (32-45), and Contact.tsx (302-311, 524-530); the fake after-hours emergency line (303) 555-9999 is at Contact.tsx:380-383; the maps iframe at Contact.tsx:439 is a generic coordinates embed with placeholder timestamp !4v1690000000000. No config/env override exists. However, 'critical' is inflated: this is placeholder marketing content (a launch blocker with liability exposure if the fake emergency number ships), not an exploitable vulnerability or code defect — 'high' is the appropriate severity. Minor mitigation: Contact.tsx:495 has a real-address Get Directions link, and Contact.tsx:225 / hub files are legitimate input placeholders, not published contact info.

</details>

### [MEDIUM] No inbound communication path at all — conversations, phone, and voicemail can never receive anything

**Where:** `/Users/davidedler/livingroom-vet-care/supabase/functions (only send-sms, send-email, suggest-replies exist)`

There is no Twilio inbound-SMS webhook, no voice webhook, and no inbound-email handler anywhere in supabase/functions. Nothing in the codebase ever writes `call_logs` or `voicemail_messages` (grep hits only in types.ts, migrations, and the read-only hooks in src/hub/hooks/use-telephony.ts), and nothing inserts `messages` with sender_type CLIENT. Consequences: the Conversations inbox is one-way (clients can never reply), CallPage permanently shows "No calls yet … once telephony is connected" (CallPage.tsx:40-49), and VoicemailsPage is permanently empty. STOP/opt-out keywords also cannot be processed, which is a TCPA compliance problem the moment real SMS sending is wired.

**Fix:** Build a twilio-inbound webhook edge function (signature-validated) that matches/creates clients+conversations and inserts CLIENT messages, handles STOP/START by updating sms_consent, plus a voice/recording status webhook writing call_logs and voicemail_messages. Without this, remove Phone/Voicemails from nav for launch.

<details><summary>Adversarial verification</summary>

All factual claims check out: supabase/functions contains only send-sms/send-email/suggest-replies (no inbound SMS/voice/email webhook); call_logs and voicemail_messages are written by nothing (use-telephony.ts is read-only plus an is_read update); the only messages insert is sender_type:"STAFF" in send-sms/index.ts:95-102, so CLIENT messages can never appear; CallPage.tsx:45-50 shows the permanent empty state. But "critical" is inflated: outbound delivery is equally unwired (send-sms/index.ts:111 hardcodes `delivered = false; // Twilio delivery not yet wired`), so no real SMS is ever sent, meaning no client is actually stranded unable to reply and the TCPA/STOP risk is purely hypothetical until Twilio is wired (consent gating already exists at lines 81-91). The UI explicitly discloses the state ("activates once Twilio Voice is connected"). This is intentional, disclosed scaffolding for a future telephony integration — a launch-scoping gap (hide Phone/Voicemails from nav, or build the webhooks before enabling Twilio), not an active defect, security issue, or current compliance exposure.

</details>

### [MEDIUM] No appointment/scheduling feature — ticket workflow dead-ends at READY_FOR_SCHEDULING

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-tickets.ts:4 (status enum); supabase/migrations/20260308184039...sql:452-501 (appointments schema)`

The DB has full `appointments` and `appointment_reminders` tables, an appointment_status enum, and a trigger that queues 48h/24h SMS reminders — but zero UI or edge-function code reads or writes `appointments` (grep across src/ and supabase/functions returns nothing outside types.ts/migrations). The ticket pipeline is OPEN → DVM_REVIEW → READY_FOR_SCHEDULING → CLOSED, so the core intake flow (new client → ticket → appointment) has no next step: there is nowhere in the Hub to schedule the visit. `process_due_reminders()` exists but nothing calls it — no pg_cron job in any migration and no scheduled edge function.

**Fix:** Build a minimal appointments page (create/list/complete per client, wired to tickets) and a scheduled edge function (Supabase cron) that calls process_due_reminders and dispatches reminders via the SMS sender. Otherwise strip READY_FOR_SCHEDULING promises from the ticket UI.

<details><summary>Adversarial verification</summary>

Every factual claim verified: appointments/appointment_reminders tables, appointment_status enum, and the 48h/24h reminder trigger exist in migration 20260308184039 (lines 447-502); grep confirms zero UI or edge-function code touches appointments (only send-email/send-sms/suggest-replies functions exist); process_due_reminders() has no caller — no pg_cron in any migration and no scheduled function; TicketStatus in use-tickets.ts:4 ends at READY_FOR_SCHEDULING→CLOSED. However, 'high' is inflated: this is an unimplemented feature/dead schema, not broken running behavior. Nothing user-facing malfunctions (no appointments are ever created, so no reminders queue or get stuck), and the ticket checklist's confirm_with_jane field ('Confirm with provider', TicketDetailPage.tsx:30) indicates scheduling is intentionally handled in an external booking system (Jane), making READY_FOR_SCHEDULING a hand-off point rather than a dead-end promise. Downgraded to medium as a real product gap plus a latent trap (any future appointment inserts would silently never send reminders), but not a high-severity defect.

</details>

### [MEDIUM] Surveys can never be delivered or answered — no send mechanism and no public response route

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-surveys.ts; src/hub/pages/SurveysPage.tsx:86`

Surveys store trigger_on_ticket_close and delay_hours, and SurveysPage displays "Sends Xh after ticket close", but grep shows no trigger, cron, or edge function that sends a survey on ticket close, and App.tsx defines no public route where a client could submit a response (marketing routes + /hub only). survey_responses can therefore never be populated, and the stats panel (useSurveyStats) will always be empty.

**Fix:** Either implement the loop (ticket-close trigger → delayed SMS with tokenized link → public /survey/:token page writing survey_responses) or remove the Surveys nav item and the "Sends after ticket close" copy before launch.

<details><summary>Adversarial verification</summary>

Verified: App.tsx has no public survey route (only marketing routes, /hub/login, and protected /hub/*); supabase/functions has only send-email/send-sms/suggest-replies with no survey logic; migrations define surveys/survey_responses with trigger_on_ticket_close and delay_hours but the only tickets trigger is updated_at housekeeping — no cron, pg_net, or ticket-close send exists; survey_responses is only ever read (use-surveys.ts:40 in useSurveyStats), never inserted; SurveysPage.tsx:86 does display "Sends Xh after ticket close". So surveys genuinely can never be delivered or answered and stats will always be empty. Severity adjusted high→medium: this is an incomplete/dead feature with misleading staff-facing UI, not a security, data-integrity, or availability defect, and the mitigation (hide the Surveys nav item and copy before launch) is trivial.

</details>

### [MEDIUM] Refill workflow is staff-only and silent: no client intake and no notification on approval/ready

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/RefillsPage.tsx:81-84; src/hub/hooks/use-refills.ts`

Refill requests can only be created by staff via NewRefillSheet (there is no client-facing form on the marketing site and no inbound channel that could create one). Changing status to APPROVED/READY/DENIED via useUpdateRefill just updates the row — no message is sent to the client, and there's no link into the client's conversation. The end-to-end flow (client asks → staff approves → client is told it's ready) dead-ends after the status dropdown; staff must remember to manually text from a different screen (which itself doesn't deliver, per the SMS finding).

**Fix:** On status transition to READY/DENIED, prompt/auto-send a templated message through the conversation send path; longer-term add a public refill-request form that feeds refill_requests.

<details><summary>Adversarial verification</summary>

All factual claims verified. (1) refill_requests is only written by useCreateRefill (src/hub/hooks/use-refills.ts:48-58) via the staff-only NewRefillSheet; marketing pages have no refill form, RLS is authenticated-only (migration 20260308184039 line 563), and the only edge functions (send-email, send-sms, suggest-replies) never touch refills — no inbound channel exists. (2) useUpdateRefill (use-refills.ts:60-79) only updates the row (status + timestamps); no message/notification is sent on APPROVED/READY/DENIED. (3) No conversation link: refill_requests even has a conversation_id column (migration line 548) that the hub never selects or uses. However, severity high is inflated: this is a missing-feature/workflow gap rather than a defect — nothing malfunctions, staff have a functioning manual path (ConversationsPage send + a dedicated "Refill" template category in TemplatesPage line 21, indicating manual templated messaging is the intended workflow), and the notification-delivery impact overlaps a separate SMS finding. Adjusted to medium.

</details>

### [MEDIUM] No spam protection or rate limiting on the public contact form

**Where:** `/Users/davidedler/livingroom-vet-care/supabase/migrations/20260309045831...sql:24 ("Anon insert contact_submissions")`

contact_submissions accepts anonymous inserts via RLS with only client-side zod length validation (Contact.tsx:26-53). Grep for captcha/turnstile/recaptcha/rate-limit across src/ and supabase/ returns nothing. Any bot can insert unlimited rows directly against the Supabase REST endpoint with the public anon key, flooding the table (and any future lead-inbox/notification pipeline built on it).

**Fix:** Move submission through an edge function that verifies Cloudflare Turnstile/hCaptcha and applies per-IP throttling (or at minimum add a DB-side rate limit/honeypot), and cap message sizes server-side.

<details><summary>Adversarial verification</summary>

Verified: migration 20260309045831 line 24-28 grants INSERT to anon/authenticated WITH CHECK (true) on contact_submissions (all unbounded TEXT columns, no CHECK constraints or triggers); Contact.tsx inserts directly via the public supabase client with only client-side zod validation; grep confirms zero captcha/turnstile/rate-limit/honeypot code in src/ or supabase/, and no edge function handles contact submissions. The later R2 hardening migration only re-gated SELECT to staff, not INSERT. So the finding is real. Severity is overstated though: reads are staff-gated, so this is a spam/table-flooding/storage-bloat nuisance vector with no data exposure or privilege impact — medium, not high. Worth fixing via a server-side size cap + honeypot/rate limit (or edge-function + Turnstile per the proposed fix).

</details>

### [MEDIUM] Email delivery is config-dependent and silently degrades; saved signature is never used

**Where:** `/Users/davidedler/livingroom-vet-care/supabase/functions/send-email/index.ts:54-69; src/hub/pages/SettingsPage.tsx:40-68`

send-email only actually sends if RESEND_API_KEY and RESEND_FROM secrets are set; otherwise it records the message with "Email delivery pending Resend configuration" — same recorded-not-sent trap as SMS, surfaced only as a toast. Separately, SettingsPage lets each staffer save an email signature (use-signature), but ConversationDetailPage's send handler never passes includeSignature and send-email sends the raw body, so the signature feature is cosmetic. ReplyComposer's onSend signature also accepts attachments/cc (ReplyComposer.tsx:13) but the composer has no attach UI and message_attachments/use-attachments are never used from any page.

**Fix:** Verify Resend secrets + domain before launch and surface delivery failures (outbound_message_attempts has no reader in the Hub); append the stored signature in send-email; either wire or remove the attachments/cc parameters.

### [MEDIUM] No delivery-failure visibility or edge-function observability

**Where:** `/Users/davidedler/livingroom-vet-care/supabase/functions/send-sms/index.ts:129,139 (console.log/console.error only)`

outbound_message_attempts faithfully records delivered/error_text for every send, but grep shows nothing in src/hub reads that table — staff and admins have no screen showing failed sends. Edge functions log only via console.log/console.error with no alerting; there is no health/status view. Once real Twilio/Resend delivery is wired, silent failures (expired keys, undelivered numbers) will be invisible until a client complains.

**Fix:** Add an admin "Delivery log" view over outbound_message_attempts (filter delivered=false), and set up Supabase log drains/alerts for edge-function error rates before charging customers.

### [MEDIUM] Data lifecycle gaps: retention never runs, audit log has no viewer, no client-data export or deletion

**Where:** `/Users/davidedler/livingroom-vet-care/supabase/migrations/20260308184039...sql:923 (apply_retention_policies); 20260613225133 (R2-1 locks it to service_role)`

apply_retention_policies() exists and is correctly locked to service_role, but no pg_cron job or scheduled function ever calls it, so it's dead code. audit_logs is admin-readable via RLS (migration 20260613184005) yet no Hub page reads it (grep src/hub returns nothing), so the audit trail is unusable without SQL access. There is no export of client/patient records (the only CSV export in the app is the staffer's own timesheet, MyTimePage.tsx:99-104) and no UI to delete a client/pet or fulfill a data-deletion request (the only .delete() calls in src/hub are client_notes, message_templates, surveys, client_files). Backups rely implicitly on Supabase defaults with nothing documented.

**Fix:** Schedule apply_retention_policies via Supabase cron; add an admin audit-log page; add per-client record export (records requests are routine in vet practices) and an admin client-deletion path using the existing delete_conversation_cascade RPC pattern; document the backup/restore posture.

### [MEDIUM] Nav promises "Clinic Browser" (ezyVet) that is a Coming Soon placeholder

**Where:** `/Users/davidedler/livingroom-vet-care/src/App.tsx:108; src/hub/components/layout/DesktopSidebar.tsx:31; src/hub/pages/PlaceholderPage.tsx:19`

/hub/tools/ezyvet is the only PlaceholderPage route; it appears in the tools nav as "Clinic Browser" and renders "Coming Soon". There is no ezyVet/PIMS integration code anywhere, which also means the Hub has no medical-record system integration — tickets track intake checkboxes (form_contract_sent, estimate_sent, consent_form_sent are manual booleans with no forms/estimates actually generated; consent_form_templates and consent_submissions tables are entirely unused by UI) but clinical records live elsewhere.

**Fix:** Remove the nav item for launch, or scope the ezyVet embed/integration explicitly into the 2-month plan; decide whether consent forms/estimates are in-scope (tables exist) or stay manual.

### [MEDIUM] Marketing promises reminders and features the Hub cannot deliver

**Where:** `/Users/davidedler/livingroom-vet-care/src/pages/services/Vaccinations.tsx:46-48; src/components/sections/experience/VirtualTour.tsx:73`

The Vaccinations page promises "we'll send friendly reminders when boosters are due", but pet_vaccinations and wellness_reminders tables have no UI or sender (grep: types.ts/migrations only), and the reminder pipeline never runs (see appointments finding). The Experience page's "Schedule a Tour" button (VirtualTour.tsx:73) is a <Button> with no onClick/link — it does nothing. LaserTherapy advertises package pricing "contact us for current pricing", which routes into the dead-end contact form. payment_links table (provider 'stripe') exists but nothing creates payment links, so any plan to text payment requests has no implementation; About page payment options (Scratchpay, etc.) are presumably handled off-platform.

**Fix:** Either implement vaccination/wellness reminder sending on the cron+SMS pipeline or soften the marketing copy; wire the Schedule a Tour button to /contact; decide whether payment links are launch scope (if yes, add a create-payment-link edge function + UI on the conversation screen).

### [LOW] Campaigns never send: they are created in status SENDING and stay there forever

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-campaigns.ts:83-124`

useSendCampaign inserts a `campaigns` row with status "SENDING" and bulk-inserts `campaign_recipients`, then stops. There is no worker, cron, or edge function that processes campaign_recipients and sends SMS/email (the only functions are send-sms/send-email/suggest-replies, both conversation-scoped). sent_count/failed_count are never updated, so every campaign shows SENDING with 0 sent indefinitely, and staff reasonably believe messages went out.

**Fix:** Add a campaign-dispatch edge function (batched, consent-gated, updates sent_count/failed_count and final status) triggered on insert or by cron; until then, label the page as draft-only or hide it from nav.

<details><summary>Adversarial verification</summary>

Mechanically accurate: no edge function, cron, or trigger processes campaign_recipients (only send-sms/send-email/suggest-replies exist, all conversation-scoped), so campaigns inserted at status SENDING never progress and sent_count stays 0. However, the harm claim is overstated: CampaignsPage.tsx line 144 explicitly tells staff in the send dialog that "Actual email/SMS delivery activates once Resend/Twilio is connected", and the success toast (line 55) says "queued", not sent — the feature is a disclosed, intentional stub pending provider hookup, and the finding's own proposed mitigation (label as draft-only) is already substantially in place. The residual defect is that the row is stamped SENDING instead of the existing SCHEDULED/DRAFT enum values, leaving a misleading perpetual amber badge in the campaign list for staff who did not see the dialog. That is a UX/status-labeling bug, not a high-severity silent-failure — severity low.

</details>

### [LOW] Urgent Alerts page records an alert but broadcasts nothing to clients

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-alerts.ts (useSendAlert)`

useSendAlert counts clients with a phone on file, then merely inserts a row into `urgent_alerts` with that recipient_count. No SMS is sent to anyone — no edge function is invoked and nothing consumes urgent_alerts. The AlertsPage UX (e.g. "The clinic is closed today due to weather…") implies a real broadcast to N clients; in an actual weather closure, zero clients would be notified.

**Fix:** Wire useSendAlert to a broadcast edge function that fans out consent-gated SMS (reusing the campaign dispatcher) and records per-recipient outcomes; until then rename/disable the feature so staff don't rely on it in an emergency.

<details><summary>Adversarial verification</summary>

Code claim verified: useSendAlert (src/hub/hooks/use-alerts.ts) only inserts into urgent_alerts; no edge function is invoked and nothing consumes the table. However, the finding's severity rests on a false premise that the UX implies a real broadcast. AlertsPage.tsx explicitly discloses non-delivery three times: line 61 "Records the alert now; actual SMS broadcast activates once Twilio is connected.", the confirm dialog (line 95) "It will be broadcast via SMS once delivery is connected.", and the toast "Alert recorded for N clients". Staff cannot reasonably mistake this for live delivery, so the emergency-reliance risk is largely mitigated — the proposed "rename/disable" mitigation is effectively already in place. Additionally, the suggested fix (reuse the campaign dispatcher) is infeasible: the send-sms edge function itself hard-codes delivered=false ("Twilio delivery not yet wired"), i.e., no SMS is delivered anywhere in the app by design. This is a disclosed pending-integration gap, not a high-severity defect; downgrade to low (tracking item to wire delivery once Twilio is connected).

</details>

### [LOW] CSV import creates clients who cannot legally be texted and duplicates freely

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/ImportPage.tsx:66-99`

Import sets preferred_channel:'SMS' for every imported client but writes no sms_consent rows, and send-sms/campaign audience both require an opted-in consent row per phone — so an imported book of business is unreachable by SMS until staff manually toggle consent client-by-client (useUpdateConsent supports method 'IMPORT' but import never uses it). The page also openly warns it does not de-duplicate against existing clients, so re-running an import doubles the client list.

**Fix:** Add an optional "records written consent on file" checkbox to import that bulk-inserts sms_consent (method IMPORT with details), and add phone/email-based upsert or duplicate detection.

### [LOW] Dead code: SignupPage exists but is unrouted

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/SignupPage.tsx`

SignupPage is not imported in App.tsx and has no route (grep shows its only reference is its own definition). This appears intentional after closing the open-signup hole (docs/hub-smoke-tests.md assumes self-service signup is disabled), but leaving a functional signup component in the bundle invites accidental re-wiring.

**Fix:** Delete SignupPage.tsx (staff accounts are created from the backend per the smoke-test doc).

---

## Security & RLS (residual, post R1+R2)

> The R1+R2 hardening is genuinely solid and verifiable in the migrations: every USING(true) policy on PII tables was replaced with is_active_staff()/has_role() security-definer gates (20260613183224/184005), storage buckets were re-gated, handle_new_user no longer trusts metadata roles, admin RPCs have last-admin guards, and all three edge functions do real JWT + active-staff + recipient-match + SMS-consent checks. The dominant residual risk is architectural: any successful signup through the Supabase Auth API still becomes an active STAFF member with full CRM access, because handle_new_user grants role STAFF and profiles.is_active defaults to true — the frontend-only signup stub is not a security boundary, and safety currently hinges on an unverifiable dashboard toggle while admin bootstrap is still pending. Secondary residuals: the anon contact form is a completely unthrottled insert path, the yet-to-be-built Twilio inbound webhook (signature verification + STOP handling) is the biggest remaining pre-launch security task, and the later-added is_on_duty column escaped the profile privilege-guard trigger.

### [CRITICAL] Server-side self-signup still mints an ACTIVE STAFF account with full PII access

**Where:** `supabase/migrations/20260613223600_0b5db918-2014-43cf-aaf0-08cdccbc4d96.sql (handle_new_user) + supabase/migrations/20260308184039...sql:52 (is_active DEFAULT TRUE)`

The hardened handle_new_user trigger (20260613223600, section 3) correctly stopped trusting raw_user_meta_data.role, but it still unconditionally inserts profiles with role='STAFF' AND a user_roles row ('STAFF') for EVERY new auth.users row, and profiles.is_active defaults to TRUE (initial migration line 52). is_active_staff() (20260613183224) returns true for exactly this combination, so any freshly self-registered user immediately passes every 'Active staff' RLS policy: full read/write on clients, pets, messages, conversations, voicemails, sms_consent, all three storage buckets, plus the send-email/send-sms edge functions (which re-check the same is_active+STAFF condition and pass). The frontend 'fix' is cosmetic: AuthContext.tsx:90-92 stubs signUp with an 'invitation-only' error and SignupPage.tsx is no longer routed in src/App.tsx — but the Supabase Auth REST endpoint (POST /auth/v1/signup) is reachable by anyone holding the anon key, which is committed in .env by design. The only thing standing between the public internet and the entire vet CRM's PII is the 'Allow new users to sign up' dashboard toggle, which is not represented anywhere in this repo (supabase/config.toml contains only project_id) and cannot be assumed off — especially since memory indicates the admin bootstrap (finite01@gmail.com) is still pending, implying signups are likely still enabled.

**Fix:** Two layers: (1) In the Supabase dashboard, disable public email signups once the admin account is bootstrapped. (2) Defense in depth via migration: change handle_new_user to insert profiles with is_active=false and NOT insert any user_roles row (the campsequoialakecheckin pattern — 'new signups get no role'); an ADMIN then activates and assigns a role via the existing admin_update_staff_role/admin_set_staff_active RPCs. This makes the DB safe regardless of the dashboard toggle.

<details><summary>Adversarial verification</summary>

All code claims verified. handle_new_user (supabase/migrations/20260613223600_...sql lines 33-37) unconditionally inserts a profiles row with role='STAFF' and a user_roles('STAFF') row for every new auth.users insert, with no gating. profiles.is_active defaults TRUE (20260308184039_...sql line 52). is_active_staff() (20260613183224_...sql) returns true for is_active=true + role in ('ADMIN','DVM','TECH','STAFF'), i.e. exactly what a fresh signup gets. PII tables gate on is_active_staff: clients/pets RLS rewritten to USING(is_active_staff(auth.uid())) (20260613183224 lines 113+), plus storage buckets (20260613223600 lines 69-82). Edge functions send-email/send-sms re-check is_active===true && STAFF_ROLES (send-sms/index.ts:41,48; send-email/index.ts:24,29) and would pass. Frontend fix is cosmetic: AuthContext.tsx:90-92 signUp is a stub returning the invitation-only string, and SignupPage.tsx is not imported or routed anywhere (grep for SignupPage in src returns no references). config.toml contains only project_id (no auth signup toggle), and the anon/publishable key is committed in .env. The only barrier is the out-of-repo Supabase dashboard signup toggle, which the finding correctly acknowledges; the DB provides zero defense-in-depth regardless. Given vet-CRM client/pet PII exposure, Supabase's signups-enabled default, and pending admin bootstrap, critical severity is appropriate and not inflated.

</details>

### [MEDIUM] Anonymous contact-form INSERT is unbounded — no length limits or rate limiting

**Where:** `supabase/migrations/20260309045831_031a7a42-a506-4c29-bce7-e20869ded224.sql:23-28`

Policy "Anon insert contact_submissions" ... FOR INSERT TO anon, authenticated WITH CHECK (true) survives all later migrations (R2 only re-gated the SELECT side in 20260613225133). The table has no CHECK constraints on name/email/subject/message length, and inserts go straight from the browser with the anon key — no edge function, no captcha, no throttle. Anyone can script unlimited multi-megabyte inserts (storage-fill/DoS, spam flooding the staff inbox view). For a commercial launch this is the only anon-writable table left and it is completely open.

**Fix:** Add CHECK constraints (e.g. length(message) <= 5000, length(name) <= 200, valid-ish email format) via migration, and route the public form through an edge function that applies per-IP rate limiting and/or a captcha before inserting with the service role; then drop the anon INSERT policy.

### [MEDIUM] No inbound Twilio webhook exists — SMS/voicemail pipeline (and STOP/opt-out handling) has no verified entry point yet

**Where:** `supabase/functions/ (only send-email, send-sms, suggest-replies exist)`

The schema and Hub UI are built around inbound SMS, call logs, and voicemail_messages, but supabase/functions contains no webhook function at all; send-sms/index.ts explicitly says 'const delivered = false; // Twilio delivery not yet wired'. Two consequences for the delta review: (a) there is currently no Twilio-signature-verification bug because there is no webhook — but this is the single most security-sensitive piece still to be written before launch (an unverified webhook would let anyone forge inbound messages/voicemails into the CRM and trigger the staff-visible workflow); (b) SMS consent is enforced only at send time (send-sms checks sms_consent.opted_in — good), but there is no server-side STOP/UNSUBSCRIBE keyword processing, so once Twilio is wired, opt-outs will not be recorded unless the webhook does it — a TCPA exposure for a commercial SMS product.

**Fix:** When building the inbound webhook: validate the X-Twilio-Signature header against TWILIO_AUTH_TOKEN on every request (reject 403 otherwise), run with service role but treat all payload fields as untrusted, and implement STOP/START keyword handling that flips sms_consent.opted_in and records opted_out_at. Treat this as a launch blocker checklist item.

### [LOW] profiles.is_on_duty not protected by the privilege-guard trigger — staff can set duty status without a time entry

**Where:** `supabase/migrations/20260614171114_5b96273b-12b6-48bc-8ff1-d89edc292f62.sql:27 vs 20260613183224...sql (protect_profile_privileges)`

protect_profile_privileges (20260613183224) only raises on changes to is_active and role. The later migration 20260614171114 added profiles.is_on_duty, which is meant to be maintained exclusively by the SECURITY DEFINER clock_in()/clock_out() RPCs (which also write audited time_entries rows). Because "Users can update own profile basics" allows any self-update, a staff user can UPDATE their own profiles row to set is_on_duty=true/false directly, appearing on-duty in the admin 'who is on duty' view (src/hub/hooks/use-time-clock.ts:120 queries profiles.is_on_duty) without a corresponding audited time entry — falsifying the time clock's presence signal.

**Fix:** Extend protect_profile_privileges to also raise when NEW.is_on_duty IS DISTINCT FROM OLD.is_on_duty for non-admin/non-definer contexts, so only clock_in/clock_out (auth.uid() present but definer-invoked — gate on a session flag or move the column update into a definer-only helper) and admins can change it. Simplest: block it for all direct authenticated updates and keep the RPCs as the only path.

### [LOW] Edge functions use wildcard CORS (Access-Control-Allow-Origin: *)

**Where:** `supabase/functions/send-sms/index.ts:4-7 (same in send-email, suggest-replies)`

All three functions set Access-Control-Allow-Origin: '*'. Every endpoint does verify the caller's JWT and active-staff status first, so this is not exploitable without a stolen session token, but it means any website can invoke these functions from a victim's browser context if a token ever leaks into JS-accessible storage (which it does — the client uses localStorage persistence, src/integrations/supabase/client.ts).

**Fix:** Pin Access-Control-Allow-Origin to the production domain(s) (and the Lovable preview origin during development) instead of '*'.

### [LOW] get_consent_submission returns the full row (SELECT *) to anonymous token holders

**Where:** `supabase/migrations/20260613225133_e28d9447-249a-4821-9614-c088efb2f9b8.sql (R2-4)`

The R2 fix correctly replaced the broken 'Anon read submission by token' USING (access_token IS NOT NULL) policy with a SECURITY DEFINER lookup keyed on the exact token and now enforces expires_at > now(). Residual nit: it returns the entire consent_submissions row — including ip_address, user_agent, and the access_token itself — to whoever holds the link. Token holders are the intended client, so exposure is marginal, but it returns more columns than the signing page needs.

**Fix:** Change the function to return a narrowed composite/record (template_id, client/pet display fields, form_data, status, expires_at) instead of the whole row, omitting ip_address, user_agent, and access_token.

---

## Build & Code Quality Gate

> Core build gates PASS: `npx tsc --noEmit` produces 0 "error TS" lines, `npx vite build` completes in 3.12s, and Supabase types.ts is fully in sync (all 24 tables referenced via .from() in hub code — tickets, refills, conversations, clients, campaigns, voicemails, etc. — exist in types.ts; zero `as any` casts anywhere in src). However the quality gate around the build is weak: the committed package-lock.json is missing @supabase/supabase-js entirely (fresh `npm ci` at HEAD fails; the fix sits uncommitted in the working tree), `npm run lint` fails with 8 errors including a reference to an uninstalled jsx-a11y plugin, and there are zero tests and no CI — so nothing automatically enforces the tsc gate that vite skips. Error handling in the app is generally solid (catch blocks toast errors, console output limited to error boundaries), with only minor issues (ignored storage-delete error, dead SignupPage, oversized 896 KB main bundle).

### [MEDIUM] Committed package-lock.json is out of sync with package.json (missing @supabase/supabase-js) — npm ci fails at HEAD

**Where:** `/Users/davidedler/livingroom-vet-care/package-lock.json`

The lockfile committed at HEAD (5a00308) contains ZERO '@supabase' entries (`git show HEAD:package-lock.json | grep -c '"@supabase'` returns 0) while the committed package.json requires "@supabase/supabase-js": "^2.98.0". Any clean-clone `npm ci` (CI, another machine, Lovable rebuild environments that use ci) will fail with a lock-sync error. The working tree contains the corrected lockfile (218-line diff adding @supabase/supabase-js and flipping many packages from dev to prod), but it is uncommitted — the only working-tree change in the repo.

**Fix:** Commit the working-tree package-lock.json now (`git add package-lock.json && git commit`) and push, so a fresh clone installs cleanly. Verify with a scratch `npm ci` from a clean checkout.

<details><summary>Adversarial verification</summary>

Verified real: HEAD (5a00308) package-lock.json has 0 @supabase entries while package.json requires @supabase/supabase-js ^2.98.0, and a scratch `npm ci` against HEAD's manifests reproduces the exact EUSAGE lock-sync failure (Missing @supabase/supabase-js@2.110.1 + 5 sub-packages, tslib mismatch). The corrected lockfile exists only in the working tree (218-line diff, sole uncommitted change). However, severity 'high' is inflated: the repo has no .github/workflows (nothing runs npm ci), and Lovable builds with bun — the committed bun.lock at HEAD contains 13 @supabase entries and is in sync, so Lovable rebuilds are unaffected (the finding's Lovable claim is wrong). npm install also succeeds. This is a latent break for future CI/clean-machine npm ci, not an active outage — medium. Proposed fix (commit the working-tree package-lock.json) is correct.

</details>

### [MEDIUM] Zero automated tests and no CI pipeline for a commercial CRM

**Where:** `/Users/davidedler/livingroom-vet-care/package.json`

package.json has no test script and no test framework in devDependencies (no vitest/jest/playwright). `find src supabase -name '*.test.*' -o -name '*.spec.*'` returns nothing. There is also no .github/workflows directory, so nothing runs tsc, eslint, or the vite build on push — and vite build does not type-check, so a type-breaking commit would ship silently. For an app handling SMS, time clock, refills, and client PII that must be commercially ready in two months, there is no regression safety net at all.

**Fix:** Add vitest + a `test` script, write smoke tests for the highest-risk hooks (use-campaigns cancel-on-partial-failure path, refills, time clock math), and add a GitHub Actions workflow that runs `npx tsc --noEmit`, `npm run lint`, and `npx vite build` on every PR (same pattern as the ondara mobile-input-guard CI).

<details><summary>Adversarial verification</summary>

Verified: package.json has no test script and no test framework in devDependencies; find across the repo (excluding node_modules) finds zero *.test.*/*.spec.* files; .github/ does not exist so there is no CI; build is `vite build` (swc plugin) which does not type-check. However, this is a process gap, not a code defect, and the type-breaking-commit risk is partially mitigated by the owner's established manual verify gate (verify-lovable-build: separate tsc --noEmit + vite build before merge/push) used across this Lovable fleet. Real and worth fixing pre-launch, but high overstates it; medium is appropriate.

</details>

### [MEDIUM] Lint gate FAILS: 8 eslint errors, including a broken rule reference to an uninstalled plugin

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/VoicemailsPage.tsx:54`

`npm run lint` exits 1 with 8 errors / 13 warnings. Errors: 4x @typescript-eslint/no-explicit-any (src/hub/contexts/AuthContext.tsx:47, src/hub/hooks/use-refills.ts:39, src/hub/components/conversations/NewMessageSheet.tsx:32, supabase/functions/suggest-replies/index.ts:132), 2x no-empty-object-type (src/components/ui/command.tsx, textarea.tsx), 1x no-require-imports (tailwind.config.ts:129), and 1x 'Definition for rule jsx-a11y/media-has-caption was not found' — VoicemailsPage.tsx:54 has an inline `// eslint-disable-next-line jsx-a11y/media-has-caption` comment for a plugin that is not installed, which itself errors. Warnings include real react-hooks/exhaustive-deps issues (ConversationDetailPage.tsx:47 missing 'conversation'/'markRead' deps; BrandAvatar.tsx; ReplyComposer.tsx).

**Fix:** Fix the 4 explicit-any casts (type the supabase function-invoke payloads), remove or correct the jsx-a11y disable comment (either install eslint-plugin-jsx-a11y or delete the comment and add a <track> / aria-label), fix the two empty interfaces and the require() in tailwind.config.ts, then make lint part of CI so it stays green.

### [LOW] Oversized bundles: 896 KB main chunk and 395 KB AdminDashboardPage chunk

**Where:** `/Users/davidedler/livingroom-vet-care/vite.config.ts`

vite build succeeds (3.12s) but warns: dist/assets/index-*.js is 896.04 kB (260 kB gzip) and AdminDashboardPage-*.js is 395.05 kB (109 kB gzip, almost certainly recharts). The public marketing site's first paint pays for the entire 896 kB main chunk, which hurts a customer-facing marketing site's Core Web Vitals.

**Fix:** Add manualChunks (split react/radix/vendor), lazy-load recharts inside AdminDashboardPage, and confirm the marketing routes don't import hub code into the entry chunk.

### [LOW] useDeleteClientFile silently ignores storage.remove() failures, orphaning files

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/hooks/use-client-files.ts:68`

In useDeleteClientFile, `await supabase.storage.from("client-files").remove([filePath]);` discards the returned error (supabase-js does not throw), then deletes the DB row regardless. If storage removal fails, the client-file blob (potentially PII/medical docs) is orphaned in the bucket forever with no DB record pointing at it, and no error surfaces to the user.

**Fix:** Destructure `{ error: storageErr }` from the remove() call and either throw or at minimum log/toast it before deleting the DB row; consider deleting the DB row first and cleaning storage via a scheduled job so orphans are recoverable.

### [LOW] Dead page: SignupPage.tsx is unrouted and wired to a stubbed signUp

**Where:** `/Users/davidedler/livingroom-vet-care/src/hub/pages/SignupPage.tsx`

SignupPage.tsx exports a full signup form but is referenced nowhere (`grep -rn SignupPage src` matches only its own definition; it is absent from the App.tsx route table). AuthContext.signUp (src/hub/contexts/AuthContext.tsx:90) is a stub that always returns "Staff accounts are invitation-only…". The security posture is correct (open signup is closed), but the page is dead code that a future dev could accidentally re-route, and the signUp method in the AuthContext interface misleadingly suggests self-signup exists.

**Fix:** Delete SignupPage.tsx and remove signUp from the AuthContext interface/provider so the invitation-only model is structural, not just behavioral.
