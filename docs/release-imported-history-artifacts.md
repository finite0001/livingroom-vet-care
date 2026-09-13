# Imported history in schema6 record releases

Schema6 adds explicitly selected imported narratives and automatic provenance for selected native problems. Compact source references retain the exact imported version, source observation, administrator review and local DVM extraction. A source narrative is included only when its version was selected. Later discrepancy reviews identify their separately reviewed source versions and disclose when those narratives were not selected.

The renderer separates outside comments, opaque category/date/clinician references, administrator import review and a locally authored DVM decision. Original extraction fields remain visible after local edits. Current source discrepancies and their review history do not overwrite the local problem or imply an outside signature. Unknown source values stay literal and escaped; no date is inferred from approval time. Private preparation reasons and duplicate-decision prose are not rendered.

Existing schema5 laboratory/external file proofs remain mandatory in schema6: both builders compare actual downloaded originals to the frozen captured SHA-256. Text-only imported history receives no invented file digest or attachment. The database capture functions independently enforce original-byte binding. Formats1–5 remain frozen, including a pre-change schema5 renderer golden SHA-256 of `01155bd6efa7ceb8e4f559d1f4f89a7b621f0020144f12baeeae268981061870`.

The synthetic example exports `clinicalHistoryArtifact()` from `tests/record-releases/clinical-history-fixture.ts`. An omitted-narrative example clears `imported_histories` and sets `narrative_included:false` on every extraction source and every discrepancy review source. The native problem and its provenance remain selected.

## Local acceptance

```sh
node --experimental-strip-types --test tests/record-releases/clinical-history.test.ts tests/record-releases/provenance.test.ts tests/record-releases/source-provenance.test.ts
python3 tests/record-releases/source-disposable.py --run-synthetic-local --fixture clinical-history
```

The second command requires migrations5000/5100 and runs only in a randomly named, owned disposable Auth/Storage project. The original `--fixture source` remains the default. All project/container/volume identity checks, protected local credentials, fixed aggregate output, migration/script hashes and cleanup checks are retained. The raw clinical harness rejects the shared foundation. Clinical policy6 is activated only as a synthetic fixture inside the disposable project; this is not Dr. Edler's acceptance.

The actual fixture connects scoped source staging, administrator history approval, DVM problem extraction, important treatment alerts, later local edits, schema6 email/link capture, source-only invalidation and separate discrepancy review. It uses real local Auth/PostgREST/private Storage and synthetic data. It contains no ezyVet or delivery-provider transport.

Initial acceptance passed 39 focused renderer/golden/payload/dispatch tests and 37 actual disposable Auth/Storage/PostgREST checks. The latter verified all owned application rows were absent, the synthetic Auth identity returned404, and the disposable project's containers, volumes and private temporary files were removed. No shared foundation policy was changed.

The tested migration overlays were:

- `20260913500000_reviewed_imported_history.sql`: SHA-256 `3bc44a636aee8be39509d302a575539560db9bf11c7a5fde5939af863d24f2f4`
- `20260913510000_release_imported_history.sql`: SHA-256 `9e33b3b8cb741e8c4df1e1278400b3fe4da0144a196ab0549cc775a1161c373d`

The sanitized runner result also records the Git revision and hashes of all migrations and test scripts. Database review and contention work continued after this initial run; final integrated acceptance must use the final migration hashes. This evidence does not substitute for commissioning or clinical acceptance.
