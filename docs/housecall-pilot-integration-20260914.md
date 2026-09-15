# Housecall pilot integration — September 14, 2026

## Consolidation

`codex/housecall-pilot-integration` starts from Lovable-connected `codex/lovable-publication` at `fce20cef28e098da672f002bfadd78c7a7cb1c8f`. It ports the housecall route interface from PR133 and adapts the record-preview download improvements from PR132 to the canonical attachment contract. It does not merge the older branch's database history.

Canonical release snapshots use `api_attachments` and separate record/capture identities. API originals must use authenticated `retrieve-reviewed-ezyvet-original`, not the ordinary `patient-documents` download lookup. Downloads verify bytes against the selected preview capture and reject stale sessions or replaced previews. Existing active-staff permissions remain authoritative.

Routes begin and end at 2619 Spruce Street, Boulder. They use saved appointment addresses, Mountain Time dates, assigned staff and scheduled order, including intervening clinic appointments. Missing addresses or incomplete query counts disable directions. Opening a directions link is explicit; rendering makes no mapping request.

## Hosted state observed read-only

- Staging: `kothoqicubowyhwfsrte`, active; 99 migrations, latest `20260914120000`; zero Auth users, clients and pets.
- Candidate branch: 110 executable migrations. Every hosted migration version exists locally. Missing staging versions are `20260914130000` through `20260914230000`: migration manifests, bindings, progress, attempt events, claim/stage wait authorization, items, capture/history/vaccination/prescription evidence.
- Future production: `mgadheotkdnrsatfivjy`, active. Its migration ledger was not reread in this checkpoint.
- Lovable editor synchronization does not establish backend or public release parity. Existing checked-in local configuration still targets the older backend. Select explicit deployment environment values; do not copy them from that file.
- No database, Edge Function, DNS, SMTP or public deployment changes were made during this checkpoint.

## Pilot acceptance order

1. Review and integrate this frontend consolidation onto the Lovable-connected branch. Reconcile concurrent changes before deployment.
2. Review the 11 staging migration gaps and corresponding functions with the migration workstream. Apply only the matched release, then verify ledgers, function versions and authorization. Keep production imports disabled until source acceptance.
3. Complete Fastmail owner sign-in and private mailbox acceptance. The session expired and a user sign-in handoff is pending. Resend's current team shows `thelivingroom.vet` verified and ten domains. Auth SMTP and the reserved authentication sender remain uncommissioned; the existing exact-sender webhook separation supports one Resend team. Do not purchase another team or change root mail routing.
4. Commission staff invitation/reset with the exact staging URLs and reserved sender, then perform authorized delivery tests. Do not record recovery links or authentication content in the client inbox.
5. Run a synthetic housecall journey in hosted staging: client/pet creation, booking, reminders, clinical encounter, vaccine/medication inventory, certificate/record release, invoice, Stripe sandbox payment/refund, and inbound reply. Record provider receipts and failures; mocked browser coverage does not establish provider acceptance.
6. Obtain Dr. Susan Edler's clinical form review and resolve findings before clinical use. Complete staff rehearsal and launch details (practice phone, emergency referral, final brand assets).

Antech onboarding and automatic anesthesia integration remain external follow-ups. Living Room Vet is the primary record system; ezyVet remains a read-only import source. This checkpoint does not declare the housecall pilot or public launch ready.

## Local validation

`npm run check` passed (lint, TypeScript, unit tests and production build). Lint reports one existing Fast Refresh warning; the build reports large chunks. All 32 targeted Chromium browser tests across housecall routes and record-release workflows passed, including mobile routing, incomplete responses, refresh behavior, canonical capture verification and stale-download suppression. These tests use synthetic fixtures and do not prove hosted/provider acceptance.
