# External veterinary-software API connection

Required by owner. Candidate adapter: ezyVet, based on vet-connect-hub at local snapshot `de3d530`. The actual connected practice/account, API authorization and desired ongoing sync mode are unconfirmed. Do not assume a third-party practice's records can be imported merely because credentials exist in another deployment.

## What the reference actually implements

`supabase/functions/ezyvet-sync/index.ts` authenticates server-side using client credentials, then imports client contacts, pets and near-term appointments. It stores invoice-derived aggregates, not a full financial ledger. `ezyvet-proxy/index.ts` supplies read-only API calls used by `src/components/ezyvet/ClinicalTimeline.tsx` and `src/hooks/use-ezyvet.ts` for consults, prescriptions, vaccines and health status. API allowlist entries do not prove complete local ingestion. Live deployment and scheduled sync were not verified.

The new Living Room repo currently has client `ezyvet_id` and a placeholder route, not that complete integration. Add the capability deliberately; do not copy reference migrations wholesale.

## Data authority

| Data | Proposed initial ownership |
|---|---|
| Existing external clinical history | External source; preserve original IDs/content/read-only provenance; link or import with source attribution |
| New Living Room SOAP, prescriptions, vaccines | Local signed clinical record; never overwritten by sync |
| Client/pet demographics | Initial import; explicit field ownership and conflict review for ongoing refresh |
| External appointments | Source-labeled; no silent overwrite of locally rescheduled appointments |
| Historical invoices/balances | Source-labeled reference/import after reconciliation; do not recreate as Stripe charges |
| New invoices/payments | Local invoice ledger and verified Stripe payment events |

Default to read integration plus reviewed imports. Two-way writes are a later explicit contract, including source API permissions, conflict resolution and retry behavior. An external system can remain authoritative for its own practice without preventing locally created Living Room patients.

## Implementation tasks

1. [ ] Confirm vendor, account ownership/authorization, API entitlement/scopes, rate limits, supported entities, attachments and available exports. Obtain synthetic/de-identified sample payloads. Confirm one-time migration versus continued read sync.
2. [ ] Define provider adapter for contact, patient, visit, appointment, vaccine, alert, document and financial-history reads, with capability flags for unsupported entities. Store credentials server-side; admin manages connection, authorized staff can view permitted patient records.
3. [ ] Add external identity map unique on practice/provider/account/entity/external ID. Add source version/hash, sync cursor, run status, raw import snapshot, mapping exceptions and reviewed conflicts. Avoid embedding one vendor's IDs throughout new business logic.
4. [ ] Fetch paginated data into staging with bounded retries/rate-limit backoff and resumable cursors. Mark partial/failed runs accurately. Compare fetched/staged/applied/rejected counts. Never delete local clients because a page or run omitted them.
5. [ ] Map client address/contact details; patient DOB/color/microchip/species/breed/sex and explicit weight units; reactions/alerts; vaccine administration/due dates; clinical history and documents; appointments. Validate reference enums and timestamps rather than guessing units or dates.
6. [ ] Provide admin dry-run preview, duplicate resolution, per-field conflicts, provenance badges and a sync-health screen. Keep unknown records in review. No automatic billing/inventory effect from historical clinical imports.
7. [ ] Persist complete imported clinical artifacts when needed for continuity; distinguish API live views, locally preserved source snapshots and locally signed records in the UI. An API failure is an error/stale-data state, not an empty clinical history.
8. [ ] Schedule only after a manual successful reconciliation. Use restricted worker authorization; do not allow any authenticated user to start bulk sync. Track last successful complete sync and actionable failure details.

## File work

Create `/Users/davidedler/livingroom-vet-care/supabase/functions/_shared/integrations/ezyvet.ts`, `/Users/davidedler/livingroom-vet-care/supabase/functions/sync-external-pims/index.ts`, `/Users/davidedler/livingroom-vet-care/supabase/functions/read-external-history/index.ts`, `/Users/davidedler/livingroom-vet-care/src/hub/features/integrations/` and versioned migrations. Replace the `/hub/tools/ezyvet` placeholder mapping in `/Users/davidedler/livingroom-vet-care/src/App.tsx` with the integration workspace; retain a redirect if the visible route becomes vendor-neutral. Do not delete external records automatically.

## Acceptance tests

- Repeat a full import with identical counts and no duplicate patients/appointments.
- Fail page 2: run is partial/failed, existing patients remain, cursor is recoverable.
- Expired token/rate limit: controlled retry or staff-visible failure, no false successful empty history.
- Imported reaction remains prominent; outside vaccine date is preserved without local stock decrement or charge.
- Local edit conflicts are reviewed; signed local SOAP never changes through sync.
- Wrong-practice identity/attachment access is rejected; secrets absent from browser/log output.
- A sample patient history reconciles against the source, including files and units; missing capabilities documented.

## Reference behaviors to avoid

Reference sync can return partial API results then delete absent clients (`ezyvet-sync` around lines 170–205 and 409–443); it logs some chunk errors yet reports success. It overwrites mapped fields without field ownership. Clinical proxy can translate a provider parameter error into an empty result. Its hourly cron helper changes a SQL function return type via replacement, requiring correction. Reuse mapping knowledge, not these failure behaviors.
