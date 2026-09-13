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

It uploads a synthetic PDF, captures its actual downloaded SHA-256 through4100, links the original and confirms separate schema5 email/SMS releases. Both production builders consume real private Storage bytes; both real capture RPCs reject an equal-length altered PDF and accept exact bytes. Replacing only the owned Storage object cannot alter already-frozen artifacts. Exact preparation/capture recovery survives later document invalidation, changed intent is rejected, and both final attempt paths leave zero provider attempts. There is no provider transport in this runner. The test restores the exact prior local release-policy row and removes its synthetic Storage object, Auth identity and application/audit records; it does not record practice clinical acceptance.

The reusable example fixture is `tests/record-releases/source-provenance-fixture.ts`, exporting `sourceProvenanceArtifact()` and `sourceOriginalBytes`. It contains synthetic lab original/correction and external original/replacement examples with both acknowledged and unacknowledged versions.


Validation: 31 focused/golden/transport tests,14 new rollback SQL assertions and203 existing release-email/document-link/document-SMS/payment-delivery SQL assertions passed. The disposable Auth/Storage/PostgREST workflow passed22 checks. No provider requests or clinical approval were performed.
