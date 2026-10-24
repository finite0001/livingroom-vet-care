# Frozen local record-review runner proof

The complete local V8 run passed on macOS: **67 guarded jobs / 927 IDs plus
22 implementation-regression jobs / 467 IDs**, for 1,394 distinct ordered test
IDs. Its actual process exited zero after 869.130641875 seconds. Independent
review revalidated all 423 saved output slots, all 67 guarded pairs and all 22
regression terminals against the fixed profile.

This establishes the local offline runner gate. It does **not** establish CI,
Linux, database, Auth, clinical activation or universal descendant cleanup.
Operational record-review signing and genuine Auth acceptance remain separate.
The staff presentation work is separately tracked in PR 295.

## What is preserved

| Location | Contents |
|---|---|
| `source/` | Exactly 908 frozen canonical relative paths, 163,795,442 bytes. This directory contains only the original source manifest's members. |
| `bindings/` | The exact V8 profile, controller, bound entries and original assembly provenance; an additional identity recipe maps the tracked snapshot to a fresh publication without changing source expectations. |
| `authority/` | Unchanged original 807-file public-slice map and 656-source map. |
| `run/` | Byte copies of all 423 indexed slots, seven final auxiliary/result files and four outer process records. The archive manifest identifies copies; it does not mint source expectations. |
| `reviews/` | Independent source, diagnostic and complete-run reviews and retained admission receipts. |

The full profile SHA-256 is
`bc7c134b9521697664bc5b18c7784b1d967d531289712672f3b2a1d49124ecb1`.
The original maps retain
`119fb7f9c0cfb6ee30153d6a16926dac04c48e86e9549e94fba333df97714e25`
and `e709921de08e167a01f61ef435434dbcf025b7596277da46903eb3e2baf5ca73`.
The complete source manifest remains
`82f91a8765b078778615c9314af37a0a1a895f2bede4ff2f843c0e00b1a54186`.

These are historical inputs. Twenty corresponding files on current `main`
already differ, including CI and disposable-runtime fixes. They are preserved
here under their own root rather than replacing current application files.
The four historical vendor TypeScript inputs are excluded from application
linting only inside this exact frozen directory; their byte hashes still apply.
No active migration, application route, backend grant or current runtime is
replaced by this package.

## Preparing a reproduction

A Git checkout preserves bytes, not the original runtime's file identities,
ownership or private modes. **Do not treat `source/` as an admitted runtime
publication or run the historical preparation freezer to regenerate its pins.**

From the repository root, create an owned private placement directory and use
the prepare-only wrapper:

```sh
mkdir -m 700 /private/tmp/lrv-proof-reproduction
python3 -I -B evidence/controlled-record-review/portable-runner-v8/assemble.py /private/tmp/lrv-proof-reproduction
```

The wrapper admits its fixed bindings and uses the reviewed complete assembler
to make a fresh owned publication with 0700 directories and 0600 files. It keeps
one original 600-second preparation deadline, refuses placement anywhere inside
the package or existing bound tool directory before creating output, and writes
its receipt outside the exact publication root. It executes no
tests, installer, Auth service, database or provider request.

The retained entries bind the original local macOS tool profile and receipt.
When those bound files are available, the wrapper reports concrete four-path
commands, clearly marked as pending execution and runtime tool admission. It
does not download tools, replace a binding, accept a caller-supplied hash, choose
a subset or infer success from this old result. Another machine requires its
own separately admitted tool/entry binding; this package does not claim that
bootstrap or a Linux/CI run.

The original run artifacts remain at
`/private/tmp/lrv-full-run-attempt-jfyo292w/output/portable-run-106fd8b17752490a85431f94f117bbb6`.
`preparation.json` records creation and relocation of the tracked snapshot only,
with runtime admission explicitly false. It is not an execution receipt for
this checkout. A fresh execution must start at job one and complete both stages.
Prior failed prefixes and the separate successful regression diagnostic cannot
replace that execution.

The initial wrapper and package manifest are retained under
`assembly-review/author/v1-archive/`. Review found that its source-only placement
check also allowed output under the bindings or tool directory. The revised
wrapper rejects those physical placements before creating any directory;
negative checks preserved every protected key and file identity. No existing
source or tool file was overwritten by either version.

## Evidence limits

The copied slots are byte archives. Their current inodes do not inherit the
original identities recorded in the indices. The independent review checked
those original identities while the original artifacts remained present.
Historical scratch/boundary trees are not duplicated in this archive.

Full per-child Transport receipts were not persisted by the reviewed runner:
the indices retain canonical receipt digests. Actual exit/timing requirements
were checked by the source-bound parent before it credited a job. The saved
slots permit terminal/pair replay, but do not independently reconstruct all
per-child Transport timing or establish a portable signed execution attestation.

Historical trees have an explicit authority-retirement point between jobs.
Active admission and final declared hashes remain checked; the result does not
claim every retired historical inode or directory keyset was held unchanged
through the end. The final review states these limits and the local tool-trust
scope explicitly.

No old failure was converted to success. The retained earlier attempts exposed
missing read dependencies, a historical-path variable collision, stored-adapter
placement, regression class ordering and exact finite child-policy forms.
Their corrections are prospective; original maps, original worker/policy
sources and failed attempts remain separate.
