# Identity evidence rollout — September 15, 2026

PR140 passed frontend, Edge and database CI on `1dd9ecd` (run35055825670), then merged as `5f5d1b1`. Both staging `kothoqicubowyhwfsrte` and primary `mgadheotkdnrsatfivjy` now have112 migrations through `20260916010000`. CLI applied only that migration, without seeds or roles.

Fresh archives of both hosted databases were restored locally. Each rehearsal preserved235 existing table fingerprints and passed30 identity SQL assertions; temporary databases were removed. Restores normalized ownership and omitted provider-owned default ACL entries while retaining explicit object grants. These checks do not establish hosted owner/default-privilege parity or hosted physical Storage recovery.

On both hosted backends, the function body matches the tested SHA256; security-definer search_path is public, authenticated execution is granted, and anonymous/service-role execution is denied. Client and patient fingerprints are unchanged; migration runs remain empty.

Lovable synced the merge and confirmed “Your website was updated.” The public index `/assets/index-CfL-c4vv.js` uses only the primary backend. Its application imports `/assets/EzyVetImportPage-rcW3aiaz.js`, which contains the identity RPC and panel. [Sanitized evidence](evidence/identity-hosted-rollout-20260915.json) preserves the artifact hash and backup/restore receipts. Private archives remain outside Git.

This read-only view distinguishes approved household/patient mapping, unknown observed source versions, approved-source currentness and local changes. Publication is not supervised staff or real-source acceptance. Weight evidence, global outcomes, resolutions, frozen reports, payment/delivery commissioning and the other commercial-readiness gates remain unfinished. No provider gates were enabled and no messages were sent.
