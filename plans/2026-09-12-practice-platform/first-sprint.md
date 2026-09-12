# First implementation brief

Goal: establish a trustworthy build/deployment/auth baseline and prove external communication/API access before expanding the clinical UI. Target: first week beginning September 14, subject to account access. This is the next implementation task, not completed work.

1. Inventory deployed backend against repository without changing production. Record whether owned Supabase already exists; identify missing provider tables and auth configuration.
2. Fix eight baseline lint errors, review thirteen warnings and triage dependency audit; add build/typecheck/lint CI. Preserve existing behavior and coordinate concurrent Lovable changes.
3. Implement reset-password route and staff invitation/bootstrap procedure with appropriate RLS tests.
4. Centralize practice settings with Spruce Street address, America/Denver timezone, both visit modes and staged housecall/clinic opening states. Require verified phone/domain/emergency contact before public launch.
5. Establish staging, document environment variables and migration runbook; prove deep links and backup restoration. Keep all external sends gated to test recipients.
6. Prototype one practice-domain Resend outbound/reply round-trip into the existing inbox; model accepted versus delivered. Start Twilio onboarding and Stripe sandbox configuration.
7. Confirm veterinary API vendor/account and perform authorized read-only capability/sample mapping. Design import provenance and field ownership before copying reference sync code.
8. Confirm October services with clinician; break the housecall acceptance scenario into the next reviewed implementation tasks.

Definition of done: green baseline CI, working invite/reset, staging deployment with isolated data, documented backend ownership, clear provider/API access results and no production side effects. A missing vendor entitlement remains an explicit dependency, not a fabricated completed integration.

Affected files and detailed acceptance are in [phase 1](phase-01-foundation.md), [phase 3](phase-03-communications-scheduling.md), and [external integration](external-pims-integration.md).

## Implementation status — 2026-09-12

Foundation code, isolated database commissioning and automated checks are implemented; see [the progress report](../../docs/foundation-progress-2026-09-12.md). Provider round-trips, first-admin onboarding, Vercel commissioning and source-backend cutover remain open. This sprint is not yet clinically launch-ready.
