# Required client contacts — hosted rollout receipt

**Status:** database rollout and hosted frontend verification complete. Dave explicitly authorized PR #230 merge and this staging-first/primary rollout. This receipt covers required contacts and linked patient creation, not the remaining feature batches or full clinical launch acceptance.

**Source:** PR #230, merge commit `0c2e835ce0aeaa33a88bc5c37225524fa4d33c60`. Its application tree is identical to reviewed/tested head `d8dd511264af3da7a6fbb2a73ce0e3adbe21ca4a`. [Pre-merge CI passed](https://github.com/finite0001/livingroom-vet-care/actions/runs/37873993662).

## Database release

Both dry runs selected exactly `20261009011500_client_contact_integrity.sql`. It was applied through the CLI with explicit project references, staging first, using `--skip-vault`; no seeds, role files, provider settings or Edge deployments were included.

Final observations at **2026-10-09 03:02 UTC** (October 8 in Denver):

| Environment | Project | Migrations | Clients | Incomplete contacts | Patients | Contact constraint |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Staging | `kothoqicubowyhwfsrte` | 168 | 2 | 0 | 1 | Validated |
| Primary | `mgadheotkdnrsatfivjy` | 168 | 1 | 0 | 1 | Validated |

Both `client_required_contacts` and `patient_complete_client` triggers are enabled in both projects. Anonymous helper execution is denied. Staff cannot execute `record_inbound_sms`; the service role can. The retained Lovable project was not a target.

### Legacy staging cleanup

The two incomplete entries were explicitly labeled `PILOT TEST Household 20260915` and `SYNTHETIC STAGING Attachment acceptance`. Their missing fields were completed with reserved synthetic test phone/email values; the attachment fixture's existing email was preserved. Each operator update was restricted to its exact ID, label, original null fields and version 1, with row-count assertions. No trigger was disabled. The updates and constraint validation committed in one transaction.

Primary required no contact correction. Existing patient/chart relationships were preserved in both environments. Contact presence does not record messaging consent.

## Hosted database probes

[Reproducible SQL probes](../../scripts/rollout/client-contact-probes.sql) use an existing active administrator for **database-role simulation**. They do not claim to authenticate an HTTP session. Every synthetic write is rolled back inside a subtransaction, and unchanged client/patient counts plus absence of the generated inbound/provider receipt are asserted afterward.

- Staging before legacy cleanup: **20 checks passed**, including refused new patients under an incomplete legacy household and successful editing of that household's existing patient.
- Staging after cleanup/validation: **18 checks passed**, with 2 clients and 1 patient unchanged.
- Primary after migration: **18 checks passed**, with 1 client and 1 patient unchanged. Its zero-incomplete-client constraint was then validated.
- Core checks cover missing phone/email, invalid formats, administrator refusal, actor spoofing, direct-write guards, orphan refusal, normalization, two pets, patient edits, stale versions, no implied SMS consent, unknown SMS review, replay after later household creation, changed-content rejection and anonymous helper denial.

No provider transport, message send, payment or payroll operation was part of these probes.

## Hosted frontend

| Target | Deployment | Source | Backend |
| --- | --- | --- | --- |
| Production | `dpl_8yGhjjPZ9JAtt9zzLrGBsFJc1iNR` | Merged `0c2e835` | Primary `mgadheotkdnrsatfivjy` |
| Staging preview | `dpl_5tuXSZvcSMe8gpM8MroSnprB9WVG` | Reviewed `d8dd511`; same application tree | Staging `kothoqicubowyhwfsrte` |

The production Git deployment is **READY** and serves [thelivingroom.vet](https://thelivingroom.vet), `www.thelivingroom.vet`, and `livingroom-vet-care.vercel.app`. Its published bundle `/assets/index-Dc0pxqjp.js` contains only the approved primary Supabase origin.

The stable [staging alias](https://livingroom-vet-care-daves-projects-e0da43ba.vercel.app) previously pointed to the September 26 build. It now points to the READY tested preview above. Its published bundle `/assets/index-BjAYc8Q1.js` contains only the staging Supabase origin. Protected preview assets were inspected using the caller's existing Vercel authentication; Deployment Protection was not disabled.

### Real owner-session UI checks

On the production site, the existing authenticated staff session loaded the client list and household with its original patient and history. The New Client form showed the new helper text and both inputs had HTML `required` attributes. An unsaved synthetic name draft with blank contacts was refused and focused Phone. Supplying a synthetic phone while leaving email empty was refused and focused Email. The draft was discarded; no client was persisted. The existing complete household still offered Add patient.

These UI checks prove authenticated rendering, reads and client-side refusal. Successful staff RPC writes and retries were tested through the separate rolled-back database probes above; no successful live-browser client creation is claimed.

## Observability and limits

- Production Vercel error-log scan at rollout: **0 entries in the preceding 30 minutes**. This static frontend has its backend on Supabase; the scan is not a global backend-health guarantee.
- Security advisors were run on both projects. Each reported **411 WARN** results: 401 authenticated SECURITY DEFINER RPC notices, 8 anonymous SECURITY DEFINER notices, one extension-in-public notice and one leaked-password-protection notice. No global clean security audit is claimed.
- The changed `save_client` RPC retains its existing intentional authenticated SECURITY DEFINER access with active-staff, actor and version checks. This produces the [generic authenticated SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable); the hosted actor/version/refusal probes passed. The new contact helper/guards and service-only inbound RPC were not flagged. The wider existing advisory backlog is separate from this contact rollout.
- Full-product staff/clinical sign-offs, photos, Whogot and the other October feedback batches remain pending. This release does not enable live financial/provider features or mark the all-features launch complete.
