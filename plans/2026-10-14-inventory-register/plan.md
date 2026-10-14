# Phase 5 — Native inventory, supplier imports, iPhone scanning and controlled register

Status: researched implementation plan; no Phase 5 feature or vendor acceptance claimed. Requirements N01, N02, N19, H11, H12 remain launch scope. Supplements the original October 8 Phase 5; does not replace any of the original 45 requirements. PR251 merged as d273144163e6dbb8ed101289bb430877faefd160; implementation starts from that merge. Research describes its unchanged c2db1ca0 feature source.

| Package | Work | Dependency / completion evidence |
|---|---|---|
| 5A1 | Reviewed product packages, supplier SKU crosswalks, identifiers and exact conversions | Existing inventory products; genuine reviewer/session API and browser proof; no physical stock writes |
| 5A2 | Bounded file capture, preview and exact reviewed apply | 5A1; untouched actual MWI Excel and supported Midwest sample/interface; both actual vendor imports required |
| 5B | iPhone camera capture, bundled decoder and identifier confirmation | 5A1; provisional ZXing WASM spike, real HTTPS iPhone/labels acceptance required |
| 5C1 | Common controlled-stock enforcement, explicit contexts and reviewed opening containers | Existing stock/custody writers; practice container/unit/role decisions; every writer linked before activation |
| 5C2 | Independent witness, corrections, transfers, counts and reports | 5C1; exact immutable event signatures; two-user browser/concurrency and Dr. Edler acceptance |
| 5D | Combined receiving → administration/dispensing → witness → count rehearsal and hosted release | All packages plus real supplier/device evidence; staged first, exact-head CI, populated restore |

Implementation details: [supplier identity/import](phase-01-supplier-identity-import.md), [scanner](phase-02-iphone-scanning.md), [controlled register](phase-03-controlled-register.md). Research: [stock boundary](research/stock-boundary.md), [vendor/camera](research/supplier-camera.md).

Do 5A1 first. It is useful native work without inventing either supplier's schema and does not activate controlled drugs. Then implement the bounded neutral import and scanner foundation while actual samples/device access are pending. Controlled enforcement can be built unactivated, but reviewed opening quantities and operational policy require Dr. Edler. Do not call that foundation a usable controlled register.

Decisions still needed: untouched supplier files/labels; Midwest supported interface; package/canonical units and concentration conversions; controlled products/containers/mobile locations; event-specific actor/witness permissions and timing; physical count workflow; real iPhone models/builds; import budgets derived from samples. Current Colorado/federal authoritative record requirements must be verified before register activation; no certification claim follows from implementation.
