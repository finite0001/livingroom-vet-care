# Fable 5 prompt — live site walkthrough (livingroom-vet-care)

Paste everything below the line into a fresh Fable 5 session (Claude Code with the Chrome extension connected, or claude.ai/code). Fill in the two `<<...>>` placeholders first.

---

You are doing a pre-launch walkthrough of a live web app. It's a house-call veterinary practice site: a public marketing site plus a staff CRM ("Hub") behind login, built on Lovable + Supabase. It must be commercially ready in two months. Your job is to go through the **running site** in the browser like a skeptical new customer, a brand-new staff hire, and an admin — and report every weakness you find, with emphasis on **(a) missing/broken setup pathways** and **(b) admin UX/UI issues**. Do not change anything; this is observe-and-report only. Never click destructive actions (delete/deactivate) on real data.

**Site URL:** <<LIVE_URL>>
**Hub login:** /hub/login — admin account: <<ADMIN_EMAIL / PASSWORD>> (if you also get a non-admin STAFF account, repeat the role-gating checks with it)

A code-level review already found the issues below. For each one, **confirm or refute it on the live site**, then keep hunting for problems the code review couldn't see (visual, copy, flow, timing, real-data behavior).

## Known issues to verify live

1. **Password reset dead-ends** — request a reset from /hub/login, click the email link, confirm there is no way to actually set a new password (no PASSWORD_RECOVERY handler or reset page exists in code).
2. **Fake contact info on the public site** — 555 placeholder phone numbers in the Header, Footer, CTA section, and Contact page (including the *emergency* line), unverified email, dummy map. Enumerate every instance you can see.
3. **Contact form goes nowhere** — submit the public contact form (mark it TEST), then log into the Hub and confirm no page, badge, or notification ever surfaces the submission to staff.
4. **Outbound SMS/email are stubs** — send a message from a Hub conversation and from Campaigns; confirm nothing is delivered and note exactly what the UI claims happened (campaigns are created stuck in "SENDING" forever).
5. **"Clinic Browser" placeholder in primary nav** — Coming-Soon page with internal dev copy shipped in production nav.
6. **Mobile bottom nav is missing Voicemails and admin Staff** — resize to phone width (390px) and confirm those pages are unreachable on mobile.
7. **Role-gating UX** — as a non-admin (or after being deactivated), hitting /hub/admin/* routes silently bounces you with no explanation; a role-less user gets a silent dead end.
8. **Query errors render as empty states** — if you can simulate offline/failed requests (Chrome DevTools), confirm pages like Tickets show "No tickets" instead of an error.
9. **Client creation has no phone/email validation or duplicate check** — try creating a client with a junk phone number and an obvious duplicate name (mark TEST, note them for cleanup in your report).
10. **Unsaved-edit loss on Ticket detail** — start editing a ticket, navigate back, confirm edits are silently lost; check whether background refetch clobbers in-progress edits.

## Then walk these journeys end-to-end and log every friction point

**A. New customer (marketing site):** land on the homepage → try to figure out service area, pricing, and how to book → attempt every booking/contact pathway to its true end. Note broken promises (the site promises reminders, follow-ups, and communication features the Hub can't currently deliver), dead links, placeholder images/copy, missing pages, social-preview/OG image issues, and anything that would make you distrust the business. Check mobile and desktop.

**B. Brand-new staff hire:** starting from only the URL, work out how you'd get an account (there is no in-app invite or signup — confirm what a hire actually sees), log in, and try to answer: "a client just texted us — where do I see it and how do I reply?" Note every place the app assumes knowledge it never provides (no onboarding, tooltips, or empty-state guidance that explains setup).

**C. Admin:** go through every page in the Hub nav (Home, Conversations, Clients, Tickets, Refills, Campaigns, Surveys, Alerts, Import, Voicemails, Call, Time Clock, Templates, Settings, Admin Dashboard, Staff). On each page check: loading/empty/error states, form validation and double-submit protection, whether actions give feedback (toast/status), whether lists will survive real volume (pagination — clients are hard-capped at 250 rows in code), date/time formatting, and whether the feature actually *does* anything or only writes a record (Surveys, Alerts, Refills approvals notify no one). On Settings, verify whether saved values (e.g. email signature) visibly take effect anywhere.

**D. Setup-pathway audit (the big one):** compile the complete list of everything a new deployment/practice would have to configure before go-live, and where the app fails to expose, document, or validate it: first-admin bootstrap (requires manual SQL today), staff invites (requires Lovable console), Twilio number + webhooks (no inbound webhook exists at all — SMS replies and voicemails can never arrive), Resend email (silently no-ops when unconfigured), real business contact info, hours, service area. For each: is there any in-app path, any error/status surfaced when it's missing, any docs? 

## Report format

Write a single markdown report. Lead with a one-paragraph go/no-go read for a 2-month launch. Then three sections — **Setup pathways**, **Admin UX/UI**, **Everything else** — each a severity-ordered list of findings with: what you did, what happened (screenshot where useful), why it matters commercially, and a one-line suggested fix. End with: (1) the verify/refute verdict for the 10 known issues, (2) the full list of TEST records you created so they can be cleaned up.
