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

## Final integrated local acceptance

At `ddf3d801426625214e4acdfaa85788122bdce459`, the final guarded fixture again passed all 37 actual Auth/Storage/PostgREST checks with cleanup verified and zero provider requests. The final migration hashes are:

- `20260913500000_reviewed_imported_history.sql`: `934ce9f93334f9c2b8ca363a8241f62d09fd0f4231d3a223136013cc1a171178`
- `20260913510000_release_imported_history.sql`: `0cf7d1430aa717c00ed8c1cc702af1fe05555013f184d29050c0c77c16910ea9`

Runner SHA-256: `8adcc8de44728762759796890232108478e1c78b4854453f85914d0d4c17d707`. Harness SHA-256: `4d698c52f3eec2046666d952fe7810b60b9fe1f91d5ff69344fc2466fc33349f`. The final integrated frontend passed 399 unit tests, 36 affected browser cases, lint, TypeScript and production build; all Edge entry points passed frozen checks. Database verification passed 65 focused SQL assertions, 522 existing regressions and 63 observed-lock checks. CI and the final restore rehearsal are tracked separately; this remains synthetic local evidence, not clinical or provider commissioning.

## Final 71-migration upgrade and restore

At `ddf3d801426625214e4acdfaa85788122bdce459`, the guarded local rehearsal reproduced the observed 51-version subset and six extra direct grants, required ordinary push to refuse the older gaps, then explicitly upgraded the generated source to all 71 migrations. Captured fixture records were preserved. The upgraded source matched a canonical 71-migration destination's function definitions, execution permissions and trigger bindings.

Database and private Storage restoration passed fresh local login, identical records/IDs, signed-history immutability, invoice/credit/stock totals, original-file bytes and anonymous/public denial. Outbox remained empty, cron was absent and cleanup was verified. Total elapsed time was 121.75s (backup 12.26s; restore/verification 5.05s). Runner SHA-256: `ef3e37aac6ea464ef3a194d58acb84734e45c024826c3a37b8be9ef58a6c31a8`. Database archive SHA-256: `b90dfd985cd7e07c04eb52ad65a95231d90a2e67496211d713e87c45ca861ff6`. These are disposable synthetic results; hosted recovery and rollout remain separately pending.
