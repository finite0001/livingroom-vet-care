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
