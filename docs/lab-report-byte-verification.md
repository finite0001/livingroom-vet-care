# Private lab-report byte verification

`prepare-lab-report` stages staff-entered source references and verifies the actual bytes of an existing ready private patient document. It requires migration 4100. It is a local provenance workflow: no Antech authentication, API endpoint, result interpretation, source-patient match, clinical acknowledgment, or client delivery is performed.

The function defaults off with `LAB_REPORT_VERIFICATION_ENABLED`. `APP_URL` defines its allowed browser origin; JWT verification remains enabled. Active staff operations execute with the caller's JWT. Only the original receipt actor can recover its envelope. Recovery remains available when new verification is paused and requires no file download.

## Exact staff contract

POST JSON only, maximum 16 KiB, with no query parameters. Every response uses `Cache-Control: no-store, private` and no-referrer headers. A supplied Origin must match configuration.

`action: "prepare"` requires exactly the eight staging fields:

- `p_id`: stable receipt UUID;
- `p_source_account_id`, `p_document_id`, `p_document_version`;
- `p_source_patient_reference`, `p_source_order_reference`, `p_source_report_reference`;
- `p_received_at`: original staff-entered timestamp, preserved exactly for retry.

No content hash, path, URL, patient override, or proof is accepted from the browser. SQL creates the metadata receipt hash. `action: "recover"` takes only `p_receipt_id`.

Success returns `{receipt,capture,report}`, with null capture before verification and null report before separate reviewed linking. The capture contains `receipt_id`, `actor_id`, `receipt_hash`, `document_version`, `content_sha256`, `file_size`, `mime_type`, `capture_hash`, and `captured_at`. Receipt and report fields are allowlisted against their corresponding 4100 records; service paths, private bytes and raw errors are omitted.

A 202 response is `{error,receipt_id,retry_requires_recovery:true}`. Keep the same receipt and original staging arguments. Exact SQL staging must succeed before capture recovery can return success. A changed intent—including sub-millisecond timestamp changes—returns 409; JavaScript timestamp equivalence never overrides PostgreSQL equality. Unknown capture acknowledgment can recover only the exact digest that this call computed. Definite SQL rejection returns 409/404 and is never replaced with inferred success.

## Private-byte boundary

The service context supplies the original receipt plus exact ready document ID, version, bucket, path, size and MIME. The handler checks these against the staged receipt and binds path patient/document segments. Only `patient-documents` objects with the expected UUID path layout are downloadable.

The production runtime fetches that object from the configured Supabase authenticated Storage endpoint using a server credential. It follows no redirects, uses a 20-second timeout, requests identity encoding and accepts only a canonical HTTPS backend or a local development backend. It never fetches a URL supplied by staff or source-report text.

Responses must be HTTP 200 with the expected MIME and, when present, exact Content-Length. A streamed read stops at the expected length, with a hard 20 MiB maximum. Truncation, extra bytes, compression mismatch, wrong MIME or redirect cannot produce a capture. SHA-256 is computed from downloaded bytes. The service then supplies the exact metadata receipt hash, document version, byte digest, size and MIME to `capture_lab_report_bytes`; SQL rechecks readiness/version and preserves an immutable capture.

Allowed MIME types match existing private documents: PDF, JPEG and PNG. Matching MIME metadata and a byte digest do not validate PDF structure, image semantics, malware absence, result authenticity or clinical correctness. A captured digest proves which original bytes were observed at that time. A later void retains historical capture metadata; separate linking/acknowledgment RPCs must still enforce current document eligibility and exact reviewed proof.

## Verification evidence

- Eleven focused handler tests cover actual SHA-256, size/MIME/redirect rejection, context path binding, active staff authorization, forbidden caller hashes, changed SQL intent, lost staging/capture acknowledgments, post-download version rejection and private-field omission.
- Frozen Deno checks cover the production entrypoint and local server; focused ESLint and diff checks pass.
- `deno check --frozen tests/lab-reports/local-server.ts` followed by `node --experimental-strip-types tests/lab-reports/local-roundtrip.ts` executes 13 checks through the production runtime, actual localhost Auth/PostgREST and real private Storage upload/download. It confirms exact byte proof, immutable replay, changed-source rejection, historical recovery after document void, no automatic clinical link and cleanup.

The local test uses the existing running Supabase environment and optional `PAYMENT_TEST_PROJECT` configuration convention. It never starts, stops or resets Supabase. Keys remain in memory. Deno networking is restricted to localhost, the source document is synthetic, and only that run's random database fixtures, private storage object and Auth user are removed. This evidence does not establish an Antech integration or clinical acceptance.
