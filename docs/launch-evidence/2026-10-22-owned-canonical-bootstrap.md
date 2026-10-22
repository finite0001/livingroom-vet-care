# Owned canonical bootstrap verification — 2026-10-22

The fresh local test bootstrap now defers project migrations until built-in Auth and Storage initialization is complete and the local scheduler is paused and drained. The pinned Supabase CLI then installs the unchanged canonical migrations through its normal local migration command. The helper checks the exact frozen ledger and existing independent seals; it never derives a replacement expectation from the running database.

The triggering post-merge CI failure reported a changed original-row/catalog preservation guard during migration 206. Its original differing rows were not retained, so this change does not establish the cause of that failure. A separate deterministic timer proof established that a real scheduler receipt can produce that exact refusal, with complete migration rollback, and that the same migration succeeds with the scheduler paused.

## Scope

The helper admits only a fresh local Unix Docker project, exact canonical input bytes, an unchanged configuration without dotenv overrides or enabled external delivery, and owned containers/volumes/network. It binds immutable container/network identities and rejects replacement. Startup failures receive bounded owned cleanup; successful callers own normal cleanup. An unverified cleanup retains its work directory and cannot produce a successful cleanup receipt.

Nineteen ordinary disposable runners, the current restore rehearsal, the shared secondary-review runtime and central database CI use the helper. Historical restore 51/84 subsets and the clinical-call-notes 201 upgrade remain explicitly selected. Five historical additional-migration overlay options now refuse before runtime setup; separately reviewed forward-install rehearsals are required instead.

Renderer dependency installation now explicitly uses five APT retries and 20-second HTTP/HTTPS inactivity timeouts on the CI host and inside the pinned Docker layer. APT already retried previously. Image digest, package pins, repositories and the 25-minute job timeout are unchanged. The change does not guarantee mirror availability.

## Local verification

- Fresh actual 206 install: exact ledger and seals, raw catalog/routine/access inventories, owner/ACL schema dump and read-only Auth/REST/Storage health passed. Independent review verified all 312 retained source inputs and the retained owned cleanup. A later live Docker check was unavailable; no full old/new bootstrap catalog equivalence is claimed.
- Clinical notes: 138 SQL tests, 32 API assertions, 14 browser assertions and 3 restore assertions across 456 restored relations passed. Two committed browser responses were deliberately dropped and recovered. Real provider requests: 0. Owned cleanup was independently rechecked locally.
- Source harness discovery: 449 tests passed. Restore-rehearsal offline unit tests: 17 passed; restore diagnostics: 3 passed; Storage metadata: 1 passed. Nine caller cleanup paths were tested under 36 actual finalizer scenarios, including failed bootstrap and failed stop.
- Real timer interleaving: the official migration waited on a foreign-key lock after its preservation baseline; an actual cron dispatch produced local configuration-missing receipts; the exact 23514 preservation guard refused installation. Only the two genuine scheduler receipt tables differed after complete rollback. The identical paused migration then installed with exact ledger, seals and preserved original rows. Work 59.264s and cleanup 5.069s. Independent raw review passed, including all 312 inputs and a fresh live cleanup check.
- Physical Storage restore attempt 1 restored bytes/metadata and exact routine/access inventories, then refused an outdated six-name scheduler fixture. Three later canonical migrations independently define the omitted names. The failed raw evidence and backup are retained. The fixture was corrected from four canonical migration definitions, with negative tests for missing/unknown/duplicate jobs, activation drift and configured delivery. A fresh second restore passed in 103.48 seconds: all 10 physical Storage files and original metadata, exact routine/access inventories, rows and identities, fresh Auth login, private access and immutable history. Both stacks were removed and independently checked absent.
- Canonical migrations, frozen artifacts and expected seals are unchanged.

## Remaining checks

Independent final source, runtime and evidence review passed. Exact-head CI and preview remain pending at this capture. Hosted installation, providers and clinical/register activation remain pending. New PR merging requires Dave's specific approval.

The full historical 51/84 upgrade modes and the distinct 201→206 call-note upgrade have not been rerun locally for this repair. The source retains those selections; final CI must establish the paths it exercises. Renderer mirror recovery is also pending actual CI. The fresh observation records inventories without claiming full old/new startup catalog equivalence. The separate v3 Gate A protocol work is not part of this repair.

## PR #293 diagnostics revision

The first PR run at `55c1233005757319951d3c96bca7647b547902c7` has a READY
preview but failed database and renderer jobs during shared bootstrap, before the
scheduler-interleaving and PDF-registration assertions respectively. Neither
private helper log was uploaded, so the primary startup cause remains unknown.
The renderer's APT installation and pinned image build completed in that run.

The revision adds per-command private status receipts and
[encrypted CI diagnostics](../ci-owned-bootstrap-evidence.md). It preserves the
original command failure separately from cleanup errors and uploads only encrypted
evidence plus fixed public status. Canonical sources, independent expectations,
startup execution and cleanup deadlines are unchanged. This is a diagnosability
repair, not a claim that the unknown startup failure has been fixed.

Fourteen real OpenSSL tests passed locally and on Linux, covering binary roundtrip,
wrong keys, ciphertext/tag tampering, alternate profiles and unsafe/archive inputs.
Linux OpenSSL 3.0.13 encrypted a synthetic binary fixture to the committed public
recipient; Mac OpenSSL 3.6.4 decrypted and verified its exact bytes. The private key
never left this Mac. Independent source, certificate and compatibility reviews
passed. A 64 MiB incompressible fixture sealed in 2.024 seconds locally; this is a
resource observation, not a guarantee for the largest admitted archive.

The complete revision still requires exact-head CI and preview before merge
approval. Hosted installation and clinical activation remain pending.
