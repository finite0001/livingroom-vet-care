# ezyVet staged import

## Delivered boundary

`ezyvet-import` fetches read-only source records into administrator-only staging tables. It never creates, updates, deletes or reconciles Living Room Vet clients, patients, encounters, appointments, invoices or inventory. Review decisions are append-only proposals, not authorization to merge charts. No scheduled jobs, live requests or credentials were commissioned during implementation. The separate [reviewed contact/patient promotion workflow](ezyvet-reviewed-promotion.md) adds an administrator UI and explicit creation/linking; this adapter itself remains read-only. The [historical weight workflow](ezyvet-reviewed-weights.md) similarly requires explicit reviewed approval before chart creation or linking.

The adapter replaces assumptions found in `vet-connect-hub/supabase/functions/ezyvet-proxy` and `ezyvet-sync`: arbitrary incoming parameters, raw upstream error messages, missing `site_uid`, and direct client/patient reconciliation are not carried forward. No Gmail dependency is introduced.

## Official API verification

Reviewed September 12, 2026 against [ezyVet API documentation](https://developers.ezyvet.com/) and [release notes](https://developers.ezyvet.com/release-notes.html). OAuth uses `/v1/oauth/access_token` with client credentials and `site_uid`. Read scopes correspond to configured resources. Paging uses `page`, `limit` and `meta.items_page/items_page_total`; contact v1 documents a 50-record maximum. Rate limits return 429 and expose reset headers. Tokens are cached in server memory and refreshed once after a 401. Exact sandbox response contracts and scopes must still be verified with the practice's issued API credentials before commissioning.

## Server configuration

Set secrets through Supabase's server-side secrets management. Never place credentials in `VITE_*`, browser storage, Git, request bodies or chat. Required:

| Name                             | Meaning                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `APP_URL`                        | Exact website origin for CORS                                                                       |
| `APP_ENV`                        | Must be `staging` for this review-only implementation                                               |
| `EZYVET_IMPORT_MODE`             | Defaults disabled; explicitly set `staging` to enable                                               |
| `EZYVET_API_URL`                 | Exact `https://api.trial.ezyvet.com` (default) or `https://api.ezyvet.com`                          |
| `EZYVET_ALLOW_PRODUCTION_SOURCE` | Must explicitly equal `true` before a production-source read is allowed; leave unset until approved |
| `EZYVET_SITE_UID`                | Issued source site identifier                                                                       |
| `EZYVET_PARTNER_ID`              | Issued partner identifier                                                                           |
| `EZYVET_CLIENT_ID`               | Issued client identifier                                                                            |
| `EZYVET_CLIENT_SECRET`           | Issued client secret                                                                                |
| `EZYVET_READ_RESOURCES`          | Comma-separated approved resource names; defaults `contact,animal`                                  |

Supported allowlist: contact, contactdetail, address, animal, species, breed, sex, animalcolour, appointment, consult, history, vaccination, healthstatus. Healthstatus is patient-scoped through the [reviewed historical weight workflow](ezyvet-reviewed-weights.md); it cannot use the generic collection path. Diagnostic collection support was removed because its documented GET requires an ID and returns a test definition, not lab results. Animal fetching uses documented v2. Include only scopes issued for this integration. All source record operations use GET; the sole upstream POST exchanges OAuth credentials. Redirects are rejected, preventing token forwarding to alternate hosts.

Keep the function's JWT verification enabled. The handler also verifies the user token and canonical active-admin role. The service role is used only on the server; its table access is SELECT-only, with narrowly granted staging RPCs for mutations. Database RPCs independently validate the actor's current active-admin status. The import initiator owns the run; another administrator cannot advance it under their own identity.

## Running a reviewed import

1. Apply migration `20260913010000_ezyvet_import.sql` and deploy `supabase/functions/ezyvet-import` with `adapter.ts` and `handler.ts` alongside the entrypoint.
2. Verify sandbox configuration and approval to access the selected source. Leave production-source access unset during synthetic or trial testing.
3. Invoke the authenticated function with only `{ "run_id": "<new UUID retained for retries>", "resource": "contact" }`.
4. Reuse the same run UUID to process each next page. Cursor and source identity come from the server. One invocation fetches at most 50 records. Response includes `next_page`, `status`, `staged_count` and `review_only`; it does not contain source records or tokens.
5. Respect `retry_after_seconds`; do not run parallel import loops. A database lease prevents simultaneous claims for the same source/resource, including different run UUIDs. Successful pages have a two-second cooldown; a 429 records the provider cooldown. Leases expire after 90 seconds if a process disappears.
6. Inspect administrator-only `ezyvet_import_runs`, `ezyvet_import_snapshots`, `ezyvet_import_pages`, and `ezyvet_import_page_items`. `review_ready` means pagination finished, not that an import was approved. `page_limit_reached` means the safety limit of 1,000 pages was reached and more source records may exist.
7. Use `review_ezyvet_snapshot` to append an unmatched, ignored or proposed-match decision with a required reason. Contacts can propose client matches and animals patient matches. No record is modified by a proposal. Living Room Vet is the confirmed primary record system. Reviewing all related entities and using the separate explicit promotion workflow that preserves local edits are prerequisites to local record creation.

A completed run is immutable as an observation; start a new UUID for a fresh scan. Source host + site + resource + external ID + normalized JSON hash deduplicate identical snapshots across runs while retaining each page observation. Changed source payloads create new snapshots. Pages and cursor commit in the same database transaction. A response lost after commit can be retried safely; it advances from the durable cursor. Empty/malformed intermediate pages fail rather than masquerading as source deletion.

## Validation and remaining commissioning

Synthetic tests exercise auth and disabled guards, scopes, site UID, bounded retries, token reuse, strict cursors, payload limits, sensitive-field filtering, staging failure and error redaction. SQL tests exercise permissions, leases, retries, deduplication and append-only reviews, and verify no changes to clinical table counts. No upstream error body is logged or returned. Sensitive credential fields and human contact license/DOB fields are excluded from staged payloads; animal birth dates remain intact.

Request timeout is five seconds per attempt, at most three transient attempts and one OAuth refresh after a 401. Responses are capped at 2 MiB and 50 records; malformed JSON/IDs/cursors fail closed. Network and token failures leave the durable page unchanged. Tokens reside only in the function instance's memory and are never inserted into staging tables.

This is page-based source observation, not a consistent transactional export: source changes during traversal can shift pages. Dedupe prevents overwriting history, but reconciliation completeness requires a vendor-supported export/incremental strategy validated against the actual site. No absence-based deletion is implemented. Documents/attachments are not fetched from arbitrary URLs. There is no automatic backfill scheduler, clinical-history conversion, ezyVet write-back, production-source commissioning or real-credential smoke test yet. Contact/patient creation and linking are available only through the separate explicit reviewed-promotion workflow.

## Practice decisions recorded

The practice selected Antech as its lab provider and Dr. Susan Edler as the clinical form reviewer; the anesthesia recording system remains undecided. Antech diagnostics integration is a future workstream, not enabled by this source-import adapter. Living Room Vet is the confirmed primary system; ezyVet is an import source. Staged review remains required before promoting imported data, with no automatic overwrite of local records and no outbound ezyVet writes.
