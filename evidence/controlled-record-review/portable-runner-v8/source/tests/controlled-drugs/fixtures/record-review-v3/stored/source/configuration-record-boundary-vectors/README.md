# Independent finite boundary addendum

This new sibling directory supplements, and does not replace or edit, original corpus manifest SHA256 `124145aed3ca5b82f35526b4486ba5d54b117e014879da897cc1d93b545fd7e1`. Contract remains `69e182574806c78a8bbc0fd4da1e4713bb0b83ceb2b9d86f2ce8bb12c6309e0f`. Scope is17 positive literal families and85 cases:68 successful D/R/Q/pair checks and17 targeted refusals. No helper bodies or target runtime were used.

`build_boundaries.py` first verifies the original manifest hash and every one of its12 file hashes, then loads only its pinned independent encoder/authoring functions and frozen literal families. Encoder SHA256 is `ff0c31eece06e4fed23a7632ea907a995e87ca9dd86ceeba11f0635696446488`; original family literal SHA256 is `02cf2efb2413a2d528984847a293a0d9b991ae01fa81dd2edb9aefea2e7ee6ae`. Bytecode writes are disabled. No target SQL, descriptor, driver or application code is imported. The imported authoring function assembles expected values from declared data; it is not the tested projector. All output literals freeze before target implementation.

## Finite inventory

| Boundary | Legal examples | Refusal examples |
|---|---|---|
| Staff publisher name |1,199,200 Unicode characters |0 and201; independent record hash recomputed |
| Approval reference |1,199,200 Unicode characters |0 and201 in stored D |
| Owner reason |1,3999,4000 Unicode characters |0 and4001; correct new request hash and bound receipt retained |
| Administration roster |99 and100 sorted unique valid members |101 sorted unique members; enabled empty roster |
| Eligibility/routing roster |100 sorted unique valid members each |101 sorted unique members each; enabled empty roster each |
| Lower UTC range |now and at at2026-01-01T00:00:00.000000Z |stored timestamp one microsecond below lower bound |
| Microsecond policy semantics |at exactly one microsecond after publication; now at an adjacent microsecond |resolved at one microsecond before publication; original now resolved one microsecond after publication with coherent record/scalar/hash/receipt |
| Fractional-hour retained calendar |20700-second (+05:45) offset with exact midnight/close candidates |offset20699 or20701 with the same UTC candidate, producing exactly one-second arithmetic inconsistency |

The17 positive families each have four explicitly frozen successful outcomes. Successful Q expects the separately authored complete R; D/R/pair return unchanged input. Targeted refusals are not transport failures; each argument is valid JSONB text and expects its declared23514 code. Failure cases are narrow lexical/cardinality/arithmetic violations with valid surrounding shape. Where a record/request hash would otherwise fail first, it is independently recomputed and reciprocal receipt fields are rebound; supporting changes are disclosed in the case.

Roster101 values remain ordered and unique, with all member keys/roles/capabilities intact. Thus duplicate/order/type failures do not substitute for the intended count boundary. Owner reason examples use clean nonwhitespace Unicode, and name/approval examples use U+1F43E, four UTF-8 bytes per character. PostgreSQL character count, not octet count, determines their200/4000 limits. Original corpus already covers retained internal LF/tab owner text and disabled empty rosters; this addendum does not multiply those examples.

## Golden values and offline proof

`families.json` retains C/D/R/Q/P/T/stream/pair as full literal JSONB text with exact UTF-8 length and SHA256. It additionally retains literal record-without-hash and original-request preimages; their SHA256 values are the frozen R.record_hash and P.request_hash. `cases.json` retains each expanded argument and expected return/error, base family, primary delta and any supporting changes. `inventory.json` records totals and pinned dependencies.

`check_boundaries.py` separately checks stored byte counts/hashes and exact shapes, complete reciprocal metadata, original requests, boundary character counts, valid sorted roster sizes, microsecond arithmetic, range and fractional-offset arithmetic. It does not implement the target validators or prove their refusal behavior. `build_boundaries.py --check` independently reproduces authoring artifacts and verifies that the entire original corpus remains unchanged. Actual check stdout is preserved in the two logs.

The original literal JSONB-renderer anchors and encoder subset apply unchanged. A later separately authorized SQL harness must compare PostgreSQL `::text` UTF-8 bytes and SHA256 to every frozen anchor/preimage/case before invoking the tested helpers. No PostgreSQL renderer agreement has yet been measured, and no expected value may be regenerated from the target projector or captured/resealed from a database. A mismatch is a corpus-version failure, not permission to normalize the expected values.

## Reachability and remaining limits

These examples demonstrate reachable **character and roster bounds**, not a near128KiB byte boundary. Observed largest positive values in this addendum: C22825, D22855, R23269, Q23567, P23832, T1374, stream187 and pair47435 bytes. Every nested and outer cap remains comfortably satisfied;101-member and overlong-text refusals also remain far below byte caps, so oversized transport is not an alternative explanation for those intended errors.

The new examples close the original corpus's listed maximum-text/roster, valid lower2026, microsecond and fractional-offset representative gaps. They do not claim the exhaustive inherited22-rule/role/scope/null/type matrix, every timestamp-field cross-product, isolated byte-guard execution or a maximum-legal-size theorem. No real timezone existence/candidate exhaustiveness, owner authority, current roles/references, actual now/clock, replay equality, Auth timing, publication, installation or unchanged14-stub runtime behavior is asserted. The fractional zone is deliberately `Synthetic/Fractional` and requires no current timezone lookup.

All original files and candidate inputs remain unchanged. Independent review of this separately frozen addendum is required before it is adopted for helper implementation. No automatic SQL launch follows.

Read-only checks:

```
PYTHONDONTWRITEBYTECODE=1 python3 -B build_boundaries.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -B check_boundaries.py
```
