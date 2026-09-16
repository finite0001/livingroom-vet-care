# Live readiness release — September 15, 2026

Published merged `codex/lovable-publication` revision `c5cd483` through the existing Lovable project. The editor preview identified `c5cd4833`; publication completed with “Your website was updated.” No backend migration, provider activation or DNS changes occurred in this release.

## Included behavior

- Contact form survives denied browser storage, preserves the draft when no request can be sent, distinguishes retry uncertainty, and retains accepted receipts when cleanup fails (`bc8fc77`).
- Housecall day routes use saved addresses and staff assignments, with incomplete schedules/addresses blocking directions. Rendering does not call Maps.
- Record-package previews download canonical reviewed API originals with byte/checksum and current-session checks.
- Migration selection retains valid choices when other historical mappings no longer match the household, with explicit unavailable counts.

## Verification

PR136 CI run `35009266341`: database, Edge and frontend jobs passed. Existing contact-fix validation recorded 583 passing unit tests and six browser cases; the integrated pilot receipt records 587 unit tests and 38 targeted browser cases. These are distinct checkpoints, not a claim that every test was repeated during publication.

HTTPS serves `/assets/index-BWmdPJVI.js`, containing primary backend `mgadheotkdnrsatfivjy` and neither legacy `ugpyjacqganaqtsiekay` nor staging `kothoqicubowyhwfsrte`. Its referenced `/assets/App-CeFURBof.js` contains the new contact-storage recovery message. Browser checks confirm `/contact` renders, displays unavailable verification and disables Send Message; unauthenticated `/hub` redirects to `/hub/login`.

## Remaining gates

Contact intake still needs approved production anti-spam setup and actual hosted acceptance. The owner has not elected to create a Cloudflare account after the pricing clarification; do not bypass verification or treat the general continuation as permission to purchase services. Staging email invitation/sign-in and booking/invoice rehearsal do not prove primary email commissioning, completed clinical visits, provider delivery or payment/refund acceptance. Whole-migration outcomes, resolutions and frozen acceptance reports remain unfinished. The comprehensive readiness goal is not complete.
