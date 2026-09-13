# Patient-scoped clinical ingestion runtime

The consult and history adapters use only the server-derived animal ID from an immutable approved mapping. Both request ten records at a time; history's maximum of ten is documented, while consult uses a conservative bound pending issued-site commissioning. Request bodies accept only the retained run UUID, resource and mapping UUID. There is no caller-supplied filter, cursor, source URL or credential.

Public contracts were rechecked against the downloaded official [consult](https://developers.ezyvet.com/#get-consult) and [history](https://developers.ezyvet.com/#get-history) documentation on 2026-09-13. The web reader could not render the large page; the source audit's downloaded public text supplies the relevant sections. History preserves opaque category, chain, date and clinician references. Text remains untrusted prose; ingestion does not infer SOAP, diagnoses, source signatures or native clinical approval.

Each page validates its envelope, cursor, count, unique resource IDs and every animal relationship before staging. Migration4900 independently enforces patient/run identity and atomic page storage. Exact terminal retries recover their original run without fetching upstream. Legacy unscoped clinical UUIDs return `CLINICAL_RUN_REQUIRES_NEW_MAPPING`, HTTP409 and `retry_safe:false`; they cannot silently gain a mapping. Other database diagnostics and provider bodies remain private.

## Acceptance commands

```sh
node --experimental-strip-types --test tests/ezyvet/adapter.test.ts tests/ezyvet/handler.test.ts
deno check --frozen supabase/functions/ezyvet-import/index.ts
PAYMENT_TEST_PROJECT=/path/to/local/project node --experimental-strip-types tests/ezyvet/clinical-local-roundtrip.ts
```

The actual runner serves the production handler over localhost HTTP, routes the adapter's pinned URLs to a separate synthetic localhost upstream and uses real local Auth/PostgREST. It never calls ezyVet. It uses random synthetic identities and removes only their rows and Auth user, then verifies aggregate row absence and Auth GET404. Its optional temporary project configuration is for read-only status discovery of an existing local stack; it never starts, resets or stops Supabase. There is no clinical-policy activation or provider delivery. CI needs Node dependencies and the existing migrated local Supabase stack, not an extra Deno server.

The fixture covers both resources, mixed-patient page rejection, durable cursor preservation, lost committed page acknowledgment, continuation, terminal recovery, changed-mapping refusal, scoped administrator discovery and legacy UUID refusal. Imported snapshots remain administrator-only staging; native encounters remain unchanged.

Validation: 16 focused adapter/handler tests and 30 actual local HTTP/Auth/PostgREST checks passed. Frozen Edge/harness type checks and focused lint also passed. No live ezyVet request, native chart mutation or clinical-policy activation occurred.

## Integrated local validation — 2026-09-13

Application source at `270629121d4e4c6728c3fda0fa1f7b8d5889eb24` combines database, adapter and UI. Lint, TypeScript, all384 unit tests, build, all Edge entrypoints with the frozen lock, and13 combined clinical/contact/weight browser cases passed. The final generated RPC types passed an additional type check. Existing AuthContext fast-refresh and build chunk-size warnings remain.

Final4900 passed59 focused SQL assertions,156 existing import/review/weight regressions and41 observed-lock contention checks. An independent read-only review found no blocking scope, freshness, recovery or grant mismatch. The integrated HTTP runner passed30 checks against the final shared lease guards, with explicit synthetic row absence and Auth404 cleanup proof. Migration SHA256: `2be6365996c6a9b6f8913c136beed26ed9e7a349b366d1e28db702a9efc8ecda`; HTTP fixture SHA256: `e0b1e2c96e5805493ed8b3ef09009fe4c082ba7f0a658a15ed396a116db56cbd`.

The observed51-version subset upgraded locally through69 migrations and matched canonical routine/trigger permissions. Separate database/private-Storage restore preserved synthetic signed history, invoice/credit/stock values, login and original bytes, while anonymous access stayed denied. Outbox was empty and cron absent; cleanup passed. Total123.66seconds. Runner SHA256: `f0ed26f0b0af84999f437fcbfda508100117e361b48b2d893bacfeb4dd5980e2`; archive SHA256: `ee9c4376845451e056dbc918c60dbf90e9f096b864c47361ecf59063f2da6622`. Five inventory-comparator tests passed. Protected artifacts stay outside Git; this is not hosted backup coverage or a promised recovery time.

PR CI is separate from these local results. Actual ezyVet entitlement/sample validation, clinical-history promotion and full migration reconciliation remain unfinished. No real source request, hosted mutation or clinical approval was performed.
