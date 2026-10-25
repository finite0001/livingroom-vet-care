# Clinical staff signing and recovery proof

Two completed local tests exercised the shared staff login, review queue,
clinical evidence display, preparation and signing dialog. Each test deliberately
lost the response to a successful save, accepted the actual leave-page warning,
reloaded, and explicitly recovered the original result. Treatment and anesthesia
used separate fresh SDK login sessions for the same synthetic reviewer. These
are not two distinct physical witnesses.

The parent completed normally in 147.329975291 seconds with 34 Python HTTP
requests. The treatment browser completed in 13.722066250 seconds and anesthesia
in 14.476349917 seconds. Each made exactly five business calls: list, detail,
prepare, execute and recovery read. All original rows, declared Auth and audit
changes, clinical effects and normal owned cleanup passed. The independent
retained-artifact review cleared this finite engineering proof.

| Location | Contents |
| --- | --- |
| `source.tar.gz` | Exactly 2,150 backend and 646 frontend source files; 192,471,959 uncompressed bytes. |
| `authority/` | Unchanged original backend manifest/profile and frontend/tool binding. |
| `archive-index.json` | Complete member sizes and original source-authority hashes. |
| `harness/` | Eight byte-identical historical harness copies with `.txt` appended. |
| `run/result.json` | Original safe parent result. |
| `run/root-direct-tool-return.json` | Original serialized root tool returns, not universal operating-system attestation. |
| `run/browser-summary.json` | Explicitly labeled projection of both browser results and supervisors, retaining original hashes. |
| `reviews/` | Unchanged independent frontend, backend and actual-run reviews, plus actual inspection records. |

Verify from the repository root:

```sh
python3 -I -B evidence/controlled-record-review/clinical-workspace-sdk-v1/verify.py
```

The fixed verifier checks complete source membership, every source hash, archive
metadata and the safe recorded results. It never extracts or executes archived
code, opens historical source/tool paths, starts services or contacts providers.
Installed dependencies and Chromium binaries are hash-bound in the historical
authority but are not distributed here. No raw Auth response, password, token,
browser input/storage, screenshot or raw clinical response from the actual run
is exported. Synthetic clinical reference fixtures remain among the original
source files.

This archive preserves bytes, not original inode identities or admission of a
fresh runtime. A new execution requires separately reviewed placement and exact
source/tool admission; changing expected bindings to observed values is not
reproduction. The active harness files accompany this package for review, but
they introduce no production route, migration, grant or dependency change.

The clinical reference checks retain computed complete original/new tuple
comparison outputs. They do not retain separate raw original graph documents.
The independent review did not re-examine screenshot pixels or establish
universal operating-system/process guarantees. Earlier failed attempts remain
preserved separately; none is relabeled as a pass.

All records are synthetic and local. Full Auth, protocol, native, general browser,
natural-expiry and restore acceptance remain false. Clinical activation and
hosted/provider writes remain disabled. This proof does not commission physical
stock, real staff, clinical policies or the clinic.
