# External-record private-byte verification

`prepare-external-record` is the service companion to migration 4200. An active administrator stages an existing private document against an approved ezyVet animal mapping, then the service downloads that exact object and records its SHA-256. This verifies the observed bytes of a staff-entered manual export. It does not retrieve ezyVet records, establish export authenticity, interpret content, approve the external record, acknowledge clinical review, or send anything.

The endpoint defaults off: `EXTERNAL_RECORD_VERIFICATION_ENABLED=true` is required for new preparation. `APP_URL` defines its allowed browser origin. JWT verification stays enabled; authenticated staging/recovery uses the actor's JWT. SQL requires an active ADMIN and original actor ownership. Historical metadata recovery works with preparation disabled and performs no download.

## Request and response

POST JSON only, no query parameters, maximum 16 KiB. Responses use `Cache-Control: no-store, private` and no-referrer headers. A supplied Origin must match configuration.

`action: "prepare"` takes exactly:

```text
p_id
p_animal_link_id
p_expected_pet_version
p_document_id
p_document_version
p_export_reference
p_received_at
p_previous_record_id
p_review_reason
```

The previous-record field is explicitly null for an original. Preserve the stable receipt UUID and every original argument after an uncertain response. The browser supplies no content hash, receipt hash, URL or storage path. SQL derives the patient and external source identity from the approved animal mapping and generates the metadata receipt hash.

`action: "recover"` takes only `p_receipt_id`. Success is the safe `{receipt,capture,record}` envelope, or null for an unknown owned receipt. Capture and record are independently nullable. Receipt fields mirror 4200; capture contains receipt/actor IDs, receipt hash, document version, actual `content_sha256`, file size/MIME, `capture_hash`, and capture time. A record, when separately approved, includes its original actor, receipt, animal mapping, patient/version, document/version, export reference, predecessor, version/kind, review reason and timestamp. The projection validates these against the receipt and capture. It never returns file bytes or storage paths.

Exact SQL preparation is authoritative. Changed arguments return 409 without overriding the rejection using recovered metadata. JavaScript timestamp equivalence does not substitute for PostgreSQL equality. Unknown staging acknowledgment returns 202 with `{error,receipt_id,retry_requires_recovery:true}` before any download. An unknown capture acknowledgment may recover only a committed capture matching the exact digest computed in that call. Authorization denial returns 404 after authentication. Raw SQL/storage errors are not exposed.

## Storage boundary

The service obtains `external_record_capture_context`, validates its receipt and document ID/version/size/MIME against the staged record, and binds the private path's patient/document UUID segments. Download uses only the configured Supabase authenticated Storage origin and the fixed `patient-documents` bucket. No request or external-source field supplies a network destination.

The runtime rejects redirects, uses a 20-second timeout, requests identity encoding, and streams at most the declared document length with a hard 20 MiB maximum. Expected HTTP status, MIME and Content-Length are checked; short, oversized, compressed or mismatched responses cannot produce a capture. Allowed document MIME types are PDF/JPEG/PNG. The existing tested bounded byte-hashing helper is reused from the lab verifier; there is no duplicated unbounded download path.

`capture_external_record_bytes` receives the original actor, exact metadata receipt hash, document version, actual byte hash, size and MIME. SQL rechecks current eligibility and makes the capture immutable. Later document voids preserve historical proof but do not authorize new approval. Separate administrator approval and DVM acknowledgment remain the 4200 workflow's responsibility.

MIME checking is metadata validation, not a file-format parser, malware scan or authenticity guarantee. A digest identifies bytes; it does not prove that ezyVet generated them or that their contents belong to the mapped patient. Explicit source/document review remains necessary, and Living Room Vet stays the primary record system.

## Local verification

Twelve focused tests cover exact byte hashing, immutable recovery, lost acknowledgments, SQL intent rejection, source/path substitution, size/MIME/redirect rejection, caller-hash rejection, administrator denial, safe projections and approved-record binding.

Run:

```sh
deno check --frozen tests/external-records/local-server.ts
node --experimental-strip-types tests/external-records/local-roundtrip.ts
```

The real local HTTP/Auth/Storage/SQL harness uses an existing running Supabase project and the existing `PAYMENT_TEST_PROJECT` override convention. It creates a random synthetic approved animal-link fixture, uploads a synthetic private document, invokes the production verifier, checks exact SHA-256 and replay, rejects a changed export reference, then separately approves the synthetic receipt through the administrator RPC and confirms fully bound historical record recovery after voiding the document. The verifier itself never approves a record. The synthetic animal mapping is fixture data; no source system is contacted and no authenticity claim is made.

Deno networking is restricted to localhost. Keys remain in memory. The harness cleans only its own private object, random database fixtures and Auth user. It never starts, stops, resets or modifies a hosted backend. The actual local harness passed 16 checks; frozen Deno, focused ESLint and diff checks passed.
