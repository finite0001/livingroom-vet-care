# Prescription-item evidence rollout — September 15, 2026

PR #138 merged as `f6e1db7` after frontend, Edge, and database CI passed on `78576bd` (run35053796472). Lovable confirmed “Your website was updated.” Both staging `kothoqicubowyhwfsrte` and primary `mgadheotkdnrsatfivjy` now have111 migrations through `20260916000000`.

The new read-only item panel distinguishes selected, omitted, differently versioned, and unobserved medication evidence. It preserves corrections, duplicate observation counts, exact parent/run/page distinctions, and unknown/uninterpreted start dates. It creates no prescriptions, administrations, stock movements, invoices, or messages.

## Verification

- Fresh local acceptance:182 existing attachment-original SQL assertions,37 item-evidence SQL assertions,126 authenticated HTTP checks,31 migration-workspace browser tests, and596 unit tests. Full CI passed afterward.
- CI exposed an existing attachment fixture's UTC/Denver date mismatch. The fixture now uses the clinic date; the production future-date constraint is unchanged.
- A populated synthetic upgrade and database/private-Storage restore passed.
- Fresh private archives of both hosted databases were saved and their archive inventories verified. The actual staging archive was restored locally, the new migration applied,235 existing table fingerprints preserved, and37 SQL assertions passed. Local restore normalized ownership, omitted provider-owned default ACL entries, and supplied local extension prerequisites. Explicit object ACLs were retained. This is not proof of hosted ownership/default-privilege parity or physical hosted Storage recovery. The temporary database was removed.
- CLI dry runs and deployments selected only the new migration, with no seeds or roles. Both hosted function bodies match the tested body hash; authenticated execution is granted, anonymous and service-role execution denied. Selected client/patient/invoice/profile/role fingerprints are unchanged; outbox and migration runs remain empty.
- The served `/assets/index-CQjVs9uz.js` identifies the primary backend and neither legacy nor staging. Its application chunk leads to `/assets/EzyVetImportPage-DWRFKa1N.js`, which contains the new RPC and panel. Browser navigation to `/hub` redirects to `/hub/login` with the sign-in form.

Private backups and credential-bearing logs remain outside Git. [Sanitized evidence](evidence/prescription-item-hosted-rollout-20260915.json) records hashes, counts, and publication checks.

## Remaining work

Signed-in supervised item review and real-source acceptance remain pending; public asset verification is not clinician approval. Identity/weight adapters, global migration outcomes, operational resolutions and frozen reports are still required. Payment and outbound delivery commissioning, primary Auth onboarding, contact-form protection and broader clinical/provider acceptance remain separate launch gates. This deployment did not enable any provider gate or send messages.
