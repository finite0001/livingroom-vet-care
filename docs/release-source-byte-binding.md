# Schema5 original-byte binding

Schema5's selected laboratory and external medical originals retain the immutable source receipt, capture and document/version identity. The selected source and its private attachment must agree on content SHA-256, MIME and size. Reciprocal `provenance_captures` entries bind each attachment to every selected associated version. Ordinary documents without these source associations retain the previous metadata-only contract; they do not acquire a retrospective verification claim.

Both shared builders hash actual downloaded original bytes before freezing base64 content. Migration4800 independently hashes decoded attachment bytes against the stored schema5 snapshot in both email and document-link captures. A matching length or PDF signature alone is insufficient. Existing whole-payload hashes and per-original manifests continue protecting artifacts after capture. The private SQL helper has no application-role execution grants.

Capture retries preserve original immutable payloads. The email capture RPC checks an existing exact payload before current-source inspection, and the preparation handler returns an already-captured result only after the actor-bound prepare RPC confirms exact request arguments. This recovers historical evidence; it does not authorize enqueue or delivery. Document-link preparation already skips capture after its grant becomes captured/reviewed. Existing final source guards remain in place and stop invalidated sources before a provider attempt.

Rendering uses only the frozen schema5 snapshot and labels local source review separately from unknown outside authorship. Original filenames and one-based attachment numbers match the bundle order, even when filenames repeat. Capture fingerprints stay in the frozen snapshot without appearing as normal report prose. Schema1–4 rendering is unchanged, including a saved schema4 golden SHA-256. Existing frozen payloads are not regenerated.

## Local checks

```sh
node --experimental-strip-types --test tests/record-releases/provenance.test.ts tests/record-releases/source-provenance.test.ts tests/release-email/payload.test.ts tests/document-links/backend.test.ts tests/document-link-sms/dispatch.test.ts
python3 tests/record-releases/source-disposable.py --run-synthetic-local
```

The guarded runner creates a randomly named disposable local Auth/Storage project with all migrations through4700/4800, verifies unused ports and container/volume identities, and invokes the raw fixture using `PAYMENT_TEST_PROJECT`. The raw fixture requires the disposable project prefix and matching Docker project/workdir labels; it refuses the shared foundation. Edge execution is disabled and local Auth uses only its mail catcher. No existing stack is reset or stopped. Private keys stay in memory and protected temporary logs. Successful cleanup removes containers, volumes and private temporary files, retaining only a sanitized result with checks, Git revision, script/migration hashes and cleanup status.

During development, an initial 20-check run used the shared local foundation with a temporary synthetic release-policy row, restoring its exact prior JSON and removing owned audit records afterward. The final runner now prevents that path; cross-connection acceptance runs only in its disposable project.

It uploads a synthetic medical-record PDF, captures its actual downloaded SHA-256 through4100 and4200, links a lab original and separately approves an external original against a synthetic animal mapping. Separate schema5 email/SMS releases retain both source proofs on the deduplicated original. No ezyVet network request or outside-authorship claim is involved. Both production builders consume real private Storage bytes; both real capture RPCs reject an equal-length altered PDF and accept exact bytes. Replacing only the owned Storage object cannot alter already-frozen artifacts. Exact preparation/capture recovery survives later document invalidation, changed intent is rejected, and both final attempt paths leave zero provider attempts. There is no provider transport in this runner. The test restores the exact prior local release-policy row and removes its synthetic Storage object, Auth identity and application/audit records; it does not record practice clinical acceptance.

The reusable example fixture is `tests/record-releases/source-provenance-fixture.ts`, exporting `sourceProvenanceArtifact()` and `sourceOriginalBytes`. It contains synthetic lab original/correction and external original/replacement examples with both acknowledged and unacknowledged versions.


Validation: 31 focused/golden/transport tests,14 new rollback SQL assertions and203 existing release-email/document-link/document-SMS/payment-delivery SQL assertions passed. The disposable Auth/Storage/PostgREST workflow passed24 checks. No provider requests or clinical approval were performed.

## Integrated local evidence — 2026-09-13

At `38fdc90995df3a748d9d6765941dc4720bab8bb9`, repository lint/typecheck, all382 unit tests and build passed; all Edge entrypoints passed frozen Deno checking. The41 combined record-release, original-document, document-SMS, lab and external-record browser cases passed. The five read-only inventory-comparator counterexamples passed. Existing AuthContext fast-refresh and build chunk-size warnings remain.

The fully integrated backend at `8dc12d50483b4de52cef302a088fe4a54edb13a9` passed24 disposable Auth/Storage checks with all68 repository migrations and no overlay. The only subsequent application commit adds UI invalidation/refresh, covered by the browser run. Runner SHA256: `2e4ca7ed846530930e0d7cc2c8c21b9638c64839306ba3f6b96d205bb00ce631`; harness SHA256: `e7f733ccaf5c8950ef0ee871ca252545655617e9992b0436e2ebb6f18b632bac`. Cleanup of all owned containers, volumes and private logs passed.

The observed51-version database subset plus direct-grant differences upgraded locally through68 migrations, matched canonical function/trigger permissions, and restored synthetic records and private Storage into a separate destination. Login, original bytes, immutable signed history, ledger/stock values and denied anonymous access passed; outbox remained empty and cron absent. Total135.63seconds, cleanup verified. This fixture restores the full schema but does not populate every provenance family; the separate source workflow supplies that evidence. Runner SHA256: `47ed8c8a64e7c436eafc7d583524f25d2af5e302c1572ebd4375244334037da3`; database archive SHA256: `13d230f21cab3110954004ebcaaf6feb5f245361f6f8d4aeb38ad022312e1ae1`. Protected local artifacts are outside Git. This is not hosted backup coverage or a recovery-time commitment.

Five production-rendered synthetic review artifacts were regenerated at the integrated application revision; schema5 remains visibly unapproved. Required PR CI is separate from this local evidence. No hosted mutation, provider delivery or clinical acceptance was performed.
