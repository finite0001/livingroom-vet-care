# Independent configuration-record literal corpus

Private source-ready review artifact for contract SHA256 `69e182574806c78a8bbc0fd4da1e4713bb0b83ceb2b9d86f2ce8bb12c6309e0f`. **Not SQL-executed; PostgreSQL renderer agreement remains unproved.** Freeze/review this directory before writing the proposed helpers. It supplies independent expected values, not target-derived receipts or installation metadata.

The frozen inventory contains **34 positive families and 1,509 target cases: 136 successes and 1,373 declared 23514 refusals**, including four SQL NULL cases. The initial1,332-case corpus is preserved; a separate177-case supplement adds coherent provenance/request mutations and primitive coverage. No existing candidate/input/profile/metadata/seal was changed. No target helper bodies, database operations, network calls, clinical facts or hosted actions were produced here.

## Files and consumption

- `families.json`: literal C, D, R, Q, P, T, stream and pair snapshots for each independently authored family. Every value has its complete frozen PostgreSQL-style JSONB text, UTF-8 byte count and SHA256. Record/request hash preimages additionally retain exact UTF-8 hex. R/stream/T are expected values written before the tested implementation, never obtained from its projector.
- `cases.json` and `supplement-cases.json`: fully expanded immutable arguments, stable IDs, declared single-property delta or explicit supporting hash/tuple changes, exact expected error SQLSTATE/message or exact successful return text. Each JSONB value is stored as text inside the artifact so a loader cannot erase1.0/3.0 through an ordinary binary float or integral normalization. SQL NULL has a separate argument-kind tag and must be bound as SQL NULL.
- `anchors.json`: independently written literal renderer anchors plus UTF-8 hex and standard-library SHA256.
- `build_corpus.py`: offline authoring generator, using only standard-library values and this contract's independently authored examples. It imports no candidate, validator, projector, descriptor, database driver or application module. `--write-new` is exclusive creation; `--check` only verifies frozen outputs.
- `build_supplement.py`: additional offline cases, reads the literal families and the independent encoder, never target SQL. Preserves initial artifacts.
- `check_corpus.py`: separate read-only consistency checks for stored bytes/hashes, exact shapes, primitive numeric scale, original now/at and reciprocal bindings, calendar offset arithmetic/adjacency/folds, successful unchanged outputs and function inventory. This is not a reimplementation or execution of the target validators.
- `freeze-manifest.json`: hash-bound complete file inventory, case totals and explicit remaining gaps. Its own SHA256 is delivered separately.

Use all initial and supplement cases; do not silently select only the initial inventory. The generated `inventory.json` deliberately describes the initial corpus only. `freeze-manifest.json` is the combined inventory.

## Pinned encoder subset and independent golden anchors

`pgtext` is a deliberately bounded independent encoder of the PostgreSQL JSONB text representation expected for these inputs:

1. Objects sort keys by **UTF-8 byte length, then unsigned UTF-8 byte lexical order**. They use one space after each colon/comma, with no leading/trailing object spaces. Arrays retain their input order with comma-space separators.
2. Strings preserve non-ASCII Unicode as UTF-8. Quote/backslash and the standard backspace/form-feed/LF/CR/tab escapes are emitted; other U+0001..U+001F controls use lowercase four-digit `\\u` escapes. Slash is unescaped. NUL and lone surrogate code points are excluded from the encoder's domain. These are decoder/JSONB-input failures, not counted target23514 cases.
3. Boolean/null spelling is exact. Python floats are prohibited. Integer literals remain integers. Decimal literals use base-ten expanded notation, retain fractional scale, and remove the minus sign from zero. Anchors include1,1.0,3.0,1e2,1e-2 and-0.0. The corpus does not claim an implementation of PostgreSQL's entire numeric range, overflow or resource-limit semantics.
4. Duplicate input keys are rejected by the authoring decoder. The target receives JSONB and cannot recover duplicate transport keys. No decoder failure is credited as a target's23514 refusal.

Literal anchors are not computed by the encoder and then called expected. They include `{"a": 4, "b": 2, "aa": 1, "é": 3}` (byte-length ordering), direct `Zoë 火 🐾`, all escaping categories, `[1, 1.0, 3.0, 100, 0.01, 0.0]`, ordered arrays, booleans/null and empty objects. Their UTF-8 hex and SHA256 are retained. This provides a finite inspectable hypothesis about PostgreSQL rendering, **not a claim that PostgreSQL confirmed it**.

Before any future target helper is invoked, a separately authorized SQL harness must send every anchor and every case/family/preimage text as a JSONB parameter and require PostgreSQL `::text` UTF-8 bytes to equal the frozen expected bytes. Check numeric1.0/3.0 explicitly. Check SQL SHA256 of the frozen record/request preimages against the literal frozen hashes. A renderer mismatch fails this corpus version; do not normalize, repair, capture/reseal or regenerate expected values from the tested helper. Preserve the failed lineage and seek an explicit corrected independent corpus.

For successful Q projection, compare to the separately frozen R literal. For D/R/pair, compare to the unchanged input literal. For failures, compare the intended helper's23514 code; a driver/decode/parser/signature failure is not success. Original requests and owner reasons remain unchanged hash inputs. A coherent changed reason/hash/receipt is intentionally a positive *different pair*, not proof of equality to an existing saved publication.

## Implemented coverage

Each of the five kinds has enabled/disabled first/successor families. Administration supplies owner_bootstrap and owner_recovery; other kinds supply staff tuples. Policy has now, at-equal, at-future and both native choices; exact22-rule documents retain existing tuple semantics. Eligibility covers read, review and exception_read. Unicode publisher/approval/reason, internal LF/tab owner reason, empty disabled rosters and empty administrative capabilities are included. Referenced UUIDs are deliberately synthetic and need not exist.

Calendar families include one, three and31 days,63 requested local values, closed day, fold0/fold1 and a local2101 upper boundary whose candidate UTC remains below2101. The retained zone is deliberately `Synthetic/Retained`: these examples prove supplied arithmetic only. A PostgreSQL version label is retained descriptive text. No timezone existence, candidate exhaustiveness, actual publication environment or real-world transition is asserted.

All four outer helpers have SQL NULL/JSON null/wrong outer types and missing/extra top-level keys. Pair recursion independently removes every nested key and inserts extras across five representative kinds, including stored/caller bodies, all22 policy rules, members, stream, receipt and observation/candidate objects. Targeted vectors cover primitive spelling/types, UUID/hash case/shape, predecessor pair/version/self, timestamps/range/finite/leap/precision, row/document and all stream dimensions, effective scalar mismatch, forbidden stored caller shape, now/at binding, original request IDs/hash/reason/observation injection, all11 receipt bindings and3.0, noncalendar observation, owner/staff null/name/version/kind matrix, and retained calendar count/order/offset/fold/adjacency/close violations.

Selected R mutations recompute the independent hash to exercise semantics beyond digest mismatch. Supplement mode/kind cases change the complete tuple coherently and rehash, so forbidden kinds cannot hide behind partial-null rejection. Supplement original-request cases recompute request_hash and receipt.request_hash while retaining the original stored record, isolating the allowed transformation/binding rule. All supporting changes are recorded rather than pretending those cases change only one byte.

## Byte-bound honesty and remaining gaps

Observed largest positive values are C7100, D14876, R15370, Q15690, P8196, T587 and pair23922 bytes; stream187. These are legal representative maxima in this corpus, **not maximum legal sizes or near128KiB evidence**. Positive31-day calendar checks structural size/count only, not actual Auth execution time.

Oversize D/R/Q/pair and nested document/stream/P/request/receipt/calendar inputs exist, including multibyte overflow. They also violate shape or lexical constraints. The expected23514 is valid, but these cases do not independently prove which guard fired. The enclosing error code cannot by itself distinguish early size refusal from later exact-key refusal. Source review must inspect pre-traversal cap ordering; an appropriately owned later runtime may additionally instrument/observe that finite boundary without rewriting the contract or calling another refusal byte-guard proof.

Explicit remaining work before claiming complete contract§8 coverage:

1. No legal maximum-name200, reason4000, approval200 or roster100 positives yet; no systematic one-below/exact/one-above lexical/cardinality series for those inputs. Existing accepted input-validator tests are not silently imported as this new corpus's execution evidence.
2. No complete independent boundary corpus for all22 policy tuple mutations, all role/capability ordering choices, all scope/reference constraints or every calendar malformed date/time spelling through every new helper. Representative nested-key/type cases exist; full integration inheritance still needs a declared finite selection or expanded vectors.
3. Timestamp adversaries cover R.published_at, stored policy effective and P.recorded_at; no exhaustive cross-product for each timestamp-bearing calendar/request/receipt field. No valid lower UTC2026 bound or microsecond-adjacent at/now positive beyond the supplied2026 examples, and no fractional-hour-offset positive yet.
4. Individual extra keys are generated per object; all field names are removed individually. Wrong-type/null coverage is systematic at D/R/Q/pair and publication/request/receipt top levels plus targeted nested values, not every nested field/type cross-product. Malformed metadata and nested cap inputs have overlapping failures, explicitly noted.
5. No legal near128KiB input has been established, and no valid value is claimed at the looser internal caps. The separate design proof bounds structurally valid pair values below409600; cap sufficiency is not cap reachability. Exact-cap/+1 malformed renderer fixtures and a sharper maximum-legal-size proof remain optional engineering expansions before byte-guard branch claims.
6. No SQL renderer agreement, target execution, function attributes/ACL/runtime/source-closure checks, permanent/session preservation, real timezone resolution,31-day Auth timing, publication/replay/owner authority or unchanged14-stub behavior has been executed here. Those gates remain independently owned. No14-stub runtime claim follows from this corpus.

This is a source-ready **representative expanded corpus with explicitly unfinished exhaustive coverage**, not a report that all§8 outcomes passed. Independent review must decide the finite implementation gate and require any additional selected vectors before helper bodies. All617 candidate inputs remain outside this directory and untouched by this work.

## Reproducible read-only checks

Run with bytecode disabled, from this directory or using the explicit script path:

```
PYTHONDONTWRITEBYTECODE=1 python3 -B build_corpus.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -B build_supplement.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -B check_corpus.py
```

These complete offline generation/consistency checks only. No DB process or network call is necessary or authorized by these commands.
