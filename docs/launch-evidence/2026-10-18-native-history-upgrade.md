# Genuine native 187/188 history upgraded unchanged

Two sequential owned local projects replayed the canonical migration ledger to
checkpoints 187 (`controlled_draft_configuration`) and 188
(`stock_writer_provenance`), created genuine native records through the actual
canonical APIs of that era, then applied every remaining migration unchanged to
204. The unpublished isolated controlled-stock candidate was installed only after
the independently pinned original-189 catalog matched. Seven separately classified
entry projections were then observed read-only, with whole final-state fingerprints
compared after each one. No history was rewritten, no provenance was backfilled,
and no controlled site, policy, opening, cell or event was created.

The final run, forced through the official GHCR mirror, used source base
`2f06547fd6156577b135d3e9d9e70163c7fddd1e`, Supabase CLI
2.118.0 and Postgres `17.6.1.171`. All 240 bound source hashes matched after
completion. The trusted-189 reference pin
`7c39d7d55b7aed8f11159555bbcd880c5910b1fa2891e495c28d2a1b6dbc5ac1` was not
regenerated. The rehearsal shares the ordinary runner's installer through a
narrow extraction; the assembled installer is byte-identical to the previous inline
assembly (349,809 bytes, SHA-256
`47577a5b932a8295694e8cc36a4b4f601b7e2c128636bb1c0d2ca1283f3ef736`).

| Checkpoint | Original relations / rows preserved | Final relations unchanged per case | Original provenance rows |
| --- | --- | --- | --- |
| 187 | 63 / 46 | 456 | none (pre-provenance era) |
| 188 | 66 / 116 | 456 | 14 movement, 1 custody, 1 discrepancy; 0 pickup, 0 correction |

No retrospective provenance appeared in either replay. The 25 controlled-data
relation families remained empty in both. All ten post-canonical-upgrade writer
definitions were unchanged by candidate installation and by every observation.
The owned scheduler was paused, drained and restored; exact-label containers,
volumes and working directories were removed; exact-label absence was verified
again after the rerun.

| Case | Outcome | SQL checks |
| --- | --- | --- |
| 187 prepared native dispense | Refused, SQLSTATE 23514: `Stock movement source required` | 11 |
| 188 prepared native dispense | Accepted entry projection | 12 |
| 188 clinical annotation | Accepted entry projection (correction head version 1) | 12 |
| 188 operational annotation | Accepted entry projection (correction head version 1) | 12 |
| 188 pickup | Refused, SQLSTATE 23514: `Verified original pickup row, operation and provenance required` | 12 |
| 188 pickup amendment | Same original-pickup provenance refusal; not an independent amendment rejection | 12 |
| 188 unresolved discrepancy | Refused, SQLSTATE 23514: `Unresolved cutover discrepancy requires an unavailable exception workflow` | 12 |

The 83 SQL checks are counted separately from the Python relation fingerprints.
Accepted annotation projection is entry projection only: it does not establish
managed-source eligibility, a physical hold, or admission as a new managed action.
The 188 seed contains six canonical dispenses, two pickups, one return, three
corrections and one discrepancy; the 187 seed contains one canonical dispense.

Two earlier fixture attempts failed before any observation and are retained
privately: the first used the reserved PL/pgSQL name `authorization` for a local
variable; the second performed an authenticated raw allocation-table read instead
of the authorized read RPC and actual intake receipt. Both were fixture-only
corrections; no candidate business logic changed. Their owned resources were
removed and exact-label absence was root-verified. They are not counted as coverage.

The full ordinary candidate compatibility run was started before an owner-requested
reboot and deliberately interrupted at `supabase start`; no result was claimed and
its runtime was removed. The final source-bound rerun after the port-isolation and
image-content guard fixes passed: 166 canonical SQL suites / 7,338 assertions with the candidate installed,
four trusted drift cases rejected with exact rollback, smoke, native managed,
opening and real-Auth probes, and 404 bound source hashes.

| Evidence | Observed result |
| --- | --- |
| Repository | 1,687 unit tests, three TypeScript projects, build; zero lint errors / four existing warnings |
| Python | all three runners compile; `git diff --check` clean |
| CI | new step runs the rehearsal after the existing full candidate runner; no canonical migration or application change |

The first PR CI run passed ordinary compatibility, then stopped before historical
stack creation because the historical runner reused the ordinary runner's local
port block (`socket.bind`, Errno 98). Lingering Auth/API connections are a likely
mechanism; their socket state was not directly captured. The runner now uses
64630/64631/64632/64634 for 187 and 64640/64641/64642/64644 for 188, separate from
the ordinary 6462x block and all other repository runner allocations. Occupied-port
guards remain intact and socket reuse is not enabled. The port-only source passed
the full ordinary run and both historical replays with 403/239 matching inputs
and independent cleanup checks. Repository checks were rerun under Node 22.
Those proofs are retained as superseded by the final content-guard proofs below;
the initial CI failure is excluded from coverage.

The next CI run passed ordinary compatibility, started the historical stack and
stopped at the exact ECR-reference assertion. Its full log shows ECR rate limits
and the pinned CLI's official GHCR fallback. The revised guard accepts only the
exact ECR or GHCR 17.6.1.171 reference and a reviewed repository-qualified content
digest for Linux amd64/arm64, inspected through the container's immutable image ID.
The independently hashed raw GHCR index is
`sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9`;
it matches the retained reviewed ECR image and a fresh GHCR pull. The index's two
platform manifests also match Docker Hub independently. A matching tag alone is
insufficient. The original CLI, trusted-189 catalog and all canonical sources are
unchanged. [Pinned CLI registry-selection source](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/command-internal/docker-registry.ts)
documents this fallback.

Six new unit methods exercise accepted registry/platform forms and rejection of
changed versions, unreviewed registries, platforms, content and repository or
architecture mismatches; all 23 harness tests pass before database startup in CI.
The final complete ordinary run and then both historical replays passed with GHCR
forced explicitly, with all 404/240 inputs matching and independent exact-label
cleanup checks. Both failed CI attempts remain excluded from successful coverage.

Private historical-proof result SHA-256:
`1db553012b22a5a2a4b27e6eae68caf06bc7a32f1f3d7184e2a71f92affe81fb`.
Sanitized ordinary rerun result SHA-256: `721df27f6acd0c67090d5db175412b89ab4a71bc86ed002d5e734a0557298247`.
[Machine evidence](2026-10-18-native-history-upgrade.json) retains per-case
counters, replay summaries, implementation hashes and cleanup receipts without
fixture identifiers, projections or private paths.

This characterizes synthetic prefix upgrades. It is not a production backup
restore, a historical clinic-data certification or a clinical activation approval.
Generic old available-only stock positive opening acceptance is a separate deferred
test. Capacity bounds, exception workflows, C1b assembly, C2 workflows, C3 actual
counts and practice rules, and Susan's SOP approval remain pending. This batch does
not install a production engine or commission the register. Exact-head CI and the
frontend deployment are recorded in the PR and private release receipt.
