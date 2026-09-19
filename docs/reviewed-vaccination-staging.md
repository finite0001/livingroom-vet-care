# Reviewed vaccination history — staging deployment

September 13, 2026. Target: `kothoqicubowyhwfsrte`. Tested application revision: `73abb6a4fbb66aad53c23f65ed172f50ffc35478`, PR112 combined CI run34779610680. All frontend, database and Edge jobs passed after incorporating the mail and deployment changes. PR112 was merged into the release integration branch, not main.

## Database

Fresh preflight found73 migrations, zero Auth users/patients/releases/policy rows, and no reviewed-vaccination table. Applied only5300 (`reviewed_imported_vaccinations`) and5400 (`record_release_vaccination_history`). MCP receipts20260913201344 and20260913201358 were reconciled with exact version/name guards to repository versions20260913530000 and20260913540000 respectively. The existing9000 payment-trigger correction was preserved; no other migration backfill ran.

Hosted history now contains75 versions. Both new tables have RLS; anonymous reads and authenticated/service-role direct inserts are denied. Inspected public entry points have no anonymous execution, and the context/validation/release internal helpers have no API-role execution. Actual SQL calls under the authenticated role without a staff identity reject chart reads and review preparation with42501 inside a rolled-back transaction. No user, patient, approved vaccination or release policy was created.

These checks verify selected deployed boundaries; they are not a signed-in staff or DVM acceptance test. The populated synthetic workflow, concurrency and restore evidence remains in the PR112 reports.

## Edge Functions

The seven affected functions were explicitly deployed using server-side CLI bundling and the staging project reference. All are ACTIVE version3. JWT settings match their previous configuration: staff preparation/recovery endpoints require JWT; dispatch uses its existing worker authentication and retrieval uses its existing scoped capability.

- `dispatch-outbox`
- `prepare-document-link`
- `prepare-invoice-email`
- `prepare-payment-delivery`
- `prepare-release-email`
- `recover-document-link`
- `retrieve-document-link`

Preflight bundle hashes matched the recorded version2 deployment. Post-deployment downloads matched all34 distinct deployed TypeScript/configuration files exactly against the tested source. Shared files matched across every function. No sender credentials, delivery modes, worker schedules, source-read scopes or acceptance policy were changed. The separately updated Resend webhook remains version3 from PR114.

## Protected frontend

[Current preview](https://livingroom-vet-care-lcywrby9c-daves-projects-e0da43ba.vercel.app), deployment `dpl_CKci8eeSszpDCicGPd4DHgij6zvH`, is READY with target `staging`. The CLI uploaded revision85f60b6; its application/configuration files are identical to tested73abb6a (the intervening change is the prescription plan). The guarded hosted build confirmed the staging backend and disabled contact intake.

Vercel protection remains enabled: unauthenticated login-page access redirects302 and CLI-authenticated access returns200. The served entry `index-Bijo-1pT.js` contains only the staging Supabase origin and excludes the old Lovable backend. Payment return responds200 with private/no-store, no-referrer and noindex/nofollow/noarchive headers. These HTTP checks do not establish rendered staff or provider acceptance.

The previous protected preview remains a historical deployment. No custom domain, public Lovable publication or production payment-backend update occurred.

## Remaining acceptance

The owner confirmed the named administrator mailbox still needs creation. Fastmail signup was prepared for the owner to enter a new password and accept terms privately. The [business Standard plan](https://www.fastmail.com/pricing/us/?plan-type=business) was visibly listed at $6/month or $60/year before tax, with a free trial requiring no credit card. No account completion, purchase, DNS cutover or invitation is claimed. Mailbox recovery/MFA, generated DNS records, Auth SMTP and actual staff login remain required.

Dr. Edler's source interpretation and release-format acceptance remain open. Prescription history, API attachments, migration reconciliation, provider round-trips and the complete commercial-readiness scope remain outstanding. This deployment supplies the reviewed-vaccination software on staging; it does not complete clinical commissioning or launch.
