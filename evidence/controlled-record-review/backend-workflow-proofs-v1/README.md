# Three retained backend workflow proofs

This package preserves three separately reviewed local runs. It adds no application route, database migration, grant, scheduler, or activation switch. Sharing identical source bytes in one archive does not combine the three source profiles into an integrated candidate.

| Profile | Retained result | Finite behavior checked |
| --- | --- | --- |
| Natural overdue review | `runs/natural-result.json` | A real 797.304-second wait across the declared midnight and review deadline; three approve/reject/worker-first overdue channels; a fresh reviewer session after waiting. The whole run took 902.881 seconds and used 40 Python HTTP requests. |
| Native discrepancies | `runs/native-result.json` | Eight genuine prepare/save/recovery cycles for four discrepancy kinds, complete reference comparisons, source-derived stock and package versions, exact audit/Auth effects, and cleanup. The run took 218.935 seconds and used 119 Python HTTP requests. |
| Selected populated restore | `runs/restore-result.json` | A selected logical restore on the same owned server, fresh Auth sessions, a real database restart, recovery of old saved work, cross-session execution, physical-write denial, and removal of the clone. The parent run took 404.236 seconds and used 50 Python HTTP requests; the clone probe separately made eight business calls. |

Run the read-only verifier from the repository root:

```sh
python3 -I -B evidence/controlled-record-review/backend-workflow-proofs-v1/verify.py
python3 -I -B evidence/controlled-record-review/backend-workflow-proofs-v1/test_verifier.py
```

Verification hashes the unchanged original profiles and manifests under `authority/`, derives each source set from those original authorities, and checks all 3,628 unique source members. It also checks the original successful process returns, saved results, source gates, and independent actual-run reviews. It does not extract or execute archived code, start services, make network requests, or admit a runtime. It requires no credentials or third-party Python packages.

`source.tar.gz` retains 279,001,054 raw source bytes in a deterministic 38,812,194-byte archive (SHA-256 `a77a148e1310e1e70acf2b575dbdfccb8be64097cf05756ef66a6af96f4f71e4`). Each original relative source path has the prefix `source/`. The three source sets contain 2,292, 1,983, and 1,904 members respectively; shared members have identical original digests. The archive contains source module ZIPs, with their original bytes and embedded published test fixtures, but no runtime/browser binaries. Supplemental upstream license texts and their provenance are in `third-party/`.

The `reviews/` files preserve separate source gates and independent artifact reviews. Each review states its conditional assumptions and limits. A historical gate is evidence for its named profile; it is not permission to execute a different profile.

The natural run retains six computed comparisons against original references; it does not separately retain the raw original cold graphs. The discrepancy run retains raw initial/final tuple and base diagnostics and computed bundle/effect/reference comparisons; it does not separately retain all raw effect preimages. Its successful eight-second database calls are finite observations, not a maximum-cost or contention guarantee. Immediate-report escalation and the worker are outside that discrepancy proof.

The restore proof covers selected same-cluster logical history. It does not establish whole-cluster or storage-byte recovery, the full native extension-owner installation chain, or physical post-backup reconciliation. Its exact two new refresh-token sequence allocations are source-derived and narrowly checked; other sequence and metadata changes remain forbidden. The helper projection includes only boolean/integer fields and the digest of its privately retained original result.

Actual Auth inputs, generated passwords/tokens, private actual request and response exports, database snapshots, and screenshots remain outside this package. `privacy-scan.json` records the check against actual credential values without publishing those values. Retained summaries and process receipts are intentionally limited evidence; they do not replace the private complete artifacts reviewed at the time.

No broad Auth, protocol, origin-security, browser, integrated all-kind, production, or physical-commissioning acceptance is claimed. Earlier failed whole runs remain failed in their original local evidence; these three successful successors do not relabel them. Staff identities, site/drug classifications, physical opening counts, operating procedures, training, and clinic commissioning still require actual practice facts.
