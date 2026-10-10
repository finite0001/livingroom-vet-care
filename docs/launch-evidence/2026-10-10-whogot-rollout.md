# Whogot hosted rollout — October 10, 2026 UTC (October 9 in Denver)

Approved by Dave as “Approved 2/34. And then continue,” interpreted explicitly in the conversation as approval for PR #234.

- [PR #234](https://github.com/finite0001/livingroom-vet-care/pull/234) merged from exact approved head `4f8993ca67e361960a432f44d3bcce66fd95d0ba`.
- Merge `fa8f286446b4c387226cb58f875c7147ec1661eb`, merged at 03:36:00 UTC.
- [Required CI](https://github.com/finite0001/livingroom-vet-care/actions/runs/38017928550): frontend, Edge, database and Vercel preview all passed before approval/merge. 1,278 unit cases; 490 browser cases and one existing skip; 135 pgTAP files / 5,500 assertions; five observed service races; 16 actual local Auth/PostgREST checks.

## Hosted database verification

Only `20261010021254_whogot_and_performed_services.sql` was selected by each explicit-project dry run and applied. Staging `kothoqicubowyhwfsrte` and primary `mgadheotkdnrsatfivjy` now have 170 migrations, latest version `20261010021254`. No schema work targeted retained legacy Lovable Cloud.

[Hosted rollback probes](../../scripts/rollout/whogot-probes.sql): 20 checks passed independently on staging and primary. These are SQL role simulations, not HTTP authentication. Every synthetic write and temporary performing-clinician name rolled back; household, patient, catalog, encounter, service, correction, audit, outbox, invoice and profile checks remained unchanged.

Primary after-probe counts: 1 client, 1 pet, 0 products, 0 encounters, 0 services, 0 service corrections, 0 invoices, 3 existing outbox rows and 24 audit entries. No production test Auth accounts or lasting clinical entries were created.

[Bounded real staging Auth/PostgREST acceptance](../../scripts/rollout/whogot-staging-roundtrip.mjs): 15 assertions passed. Covered explicit save, exact retry, filters, patient-scoped source, correction retry, current vs corrected/as-of search, service history and anonymous denial. Only labeled synthetic records; zero provider requests. Cleanup archived the test patient, retired the test service, inactivated and banned the test actor, and removed the local credential receipt. Immutable synthetic clinical/audit evidence is retained in staging.

The rollback SQL executes as one hosted request: its fixed statement timestamp precedes new service creation stamps. Search-after-save eligibility is therefore proved through separate genuine HTTP requests rather than a fabricated SQL timestamp. Probe script setup was corrected for that distinction; failed setup runs left no writes.

## Frontend evidence

- Staging preview `dpl_552DB6e6gTS6My4KzVWM95isRk7D`, [exact preview](https://livingroom-vet-care-70n6ztfdi-daves-projects-e0da43ba.vercel.app/hub/whogot), READY, approved feature head; compiled entry contains only the staging backend reference.
- Stable staging alias `livingroom-vet-care-daves-projects-e0da43ba.vercel.app` points to that preview; verified after production became READY.
- Production `dpl_Hm8RnpobLTpgvody8EJ5TfyqRjAH`, READY, Vercel metadata confirms merge `fa8f286446b4c387226cb58f875c7147ec1661eb` and project `prj_Dn1g9AIBEth78S7V3pqhYHueICl7`.
- [Live Whogot](https://thelivingroom.vet/hub/whogot): compiled entry contains only the primary backend reference. Staff Chrome session loaded filters and performed a read-only search successfully, returning the expected empty primary service catalog/results.
- Staging browser showed the corrected synthetic service, exact client/patient links and original source with current correction reason. [Hosted source screenshot](assets/2026-10-10-whogot-hosted-source.png); [production search screenshot](assets/2026-10-10-whogot-production.png).
- Hosted CSV browser download capture timed out in the browser driver and is not claimed as hosted export proof. CSV paging and output were verified in the passing implementation browser suite.

## Security, operations and remaining acceptance

Hosted advisor review identifies the six intended authenticated SECURITY DEFINER RPCs. Their active-staff/anonymous denial gates were verified; no new anonymous endpoint or missing service-table RLS policy was introduced. Existing notices remain for legacy public RPCs, pg_net placement, worker tables intentionally without client policies and disabled leaked-password protection. References: [authenticated-definer guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

No Edge deployment was needed. No payment profile, outbound/provider gate, secret, scheduler, historical patient data or provider registration was changed. This completes engineering rollout, not Susan's full clinical/practice acceptance or the 45-item product launch checklist. Performed services join selective record-release packages in the planned records-release batch; they are not appended to existing signed artifacts.

Recovery: return the frontend to the prior READY deployment while keeping the additive migration and immutable records. Any database correction must be a reviewed forward migration; do not erase clinical history or rewrite migration history.
