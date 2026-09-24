# Phase 4 — pilot, public launch, and full platform

Priority: P0 for go/no-go; P1 for post-pilot scope. Depends on phases 1–3 and real owner/provider decisions.

## Pilot checklist

1. Run a synthetic end-to-end rehearsal: create client/patient → schedule housecall → reminder → SOAP/alert → offered preventive service → invoice/Stripe → certificate → selected record delivery → inbound reply → next due reminder.
2. Run the same workflow with named staff in staging using controlled provider test recipients. Include duplicate webhooks, timeout/unknown send, payment replay/refund, stock correction, wrong-patient document attempt, and restore.
3. Have the veterinarian approve SOAP signing/addenda, alerts, vaccine records, certificate templates, client-release rules, and any QOL/consent form offered.
4. Replace all placeholder/public claims with owner-approved phone, emergency referral, hours, services, staff, photography, logo, domain email, and housecall/clinic opening language.
5. Pilot with a deliberately small service menu and a named daily operator. Review failed messages, payments, stock, incomplete notes, and access logs every day.
6. Freeze the release candidate, migrate/cut over once, enable one worker set, monitor, and keep a rollback/reconciliation window. Do not roll back by merely changing the frontend URL after new writes exist.

## Public website launch checklist

- SEO metadata, canonical URLs, robots.txt, sitemap.xml, and public-route structured data should cover only public marketing/legal routes. Hub routes should remain out of search indexing.
- Social previews should use owner-approved public assets served from the production domain. Current local fallback: `/og-living-room-vet.jpg`.
- Footer and internal navigation must keep Privacy, Terms, Contact, Services, Experience, About, and public service-detail routes reachable without relying on search.
- Do not publish phone, email, hours, license, staff credentials, emergency referral, final service availability, pricing, or housecall coverage until the owner approves the exact content.
- Any service page that describes equipment, appointment timing, after-hours support, certificates, treatment packages, or payment methods needs owner/veterinarian review before public launch.

## Full-platform follow-on

After the pilot proves reliability, implement only what the service menu requires:

- ezyVet staged import/read adapter with provenance, resumable sync, conflicts, and source ownership;
- lab order/result workflow and vendor integration;
- dental charting;
- anesthesia upload first, then actual device/vendor adapter after sample payloads;
- versioned QOL instruments and printable summaries;
- stable lesion/body maps with longitudinal measurements/photos;
- clinic rooms/resources, mobile/clinic inventory transfer, and card-present payment if needed;
- richer voice/voicemail and client portal only after core inbox reliability.

## Success criteria

- No critical access-control, data-loss, duplicate-charge, duplicate-send, or duplicate-stock defect remains open.
- Staff can restore records and explain provider failures.
- The public site accurately describes what is available now.
- Every deferred feature is hidden, labeled as unavailable, or scheduled behind a known dependency.

## Required evidence

Store dated artifacts under `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/`: hosted test results, provider callback samples, migration reconciliation, restore report, clinician sign-off, content approval, pilot incident log, and final go/no-go decision.
