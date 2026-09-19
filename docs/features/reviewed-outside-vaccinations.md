# Clinician-reviewed outside vaccination history

An active DVM can review imported ezyVet vaccination evidence in the patient chart. ADMIN-only source intake remains separate. All active staff can read approved outside vaccination history.

Review starts from an approved mapping and exact scoped vaccination/consult observations. The clinician explicitly chooses date interpretation and status, can select an optional versioned local vaccine catalog match, and supplies a rationale. Raw source values remain visible; unknown historical dose, route, lot and manufacturer remain unknown. Catalog selection cannot fill those historical facts.

The browser retains the full intent and operation UUID before preparation. Recovery validates the original actor, patient, payload and prepared hash. Server request discovery supports lost browser state; explicit abandonment prevents a delayed request from reviving an operation. A shared patient navigation guard protects unsaved work. Late responses cannot replace another patient's chart.

Approval writes immutable outside history. Identical source interpretation across operation UUIDs reuses the existing receipt. Corrections name the exact predecessor and append a new version; concurrent replacements cannot create competing successors. Patient, source and catalog changes require fresh review for a new approval. Exact committed recovery preserves the receipt after source changes while still requiring the current original DVM. The chart displays separate latest-version and source-discrepancy status.

Schema7 record releases support explicit outside-vaccination selection alongside imported narratives and existing clinical records. Print, email and SMS-linked artifacts use the same validated rendering; original-byte checks remain enforced. Source vaccination/consult changes and new reviewed corrections invalidate affected pending releases. Already issued artifacts remain immutable. Schemas1–6 remain supported.

No review operation creates a native treatment, due plan, reminder, stock movement, invoice charge, certificate or message. Explicit due-plan adoption, global source-product mapping and authorized practice-sample acceptance remain later work. Dr. Susan Edler's [clinical review cases](../clinical-review/outside-vaccination-history.md) are prepared and unapproved.

## Verification

Integrated application checks pass:418 unit tests, type checking, lint and build. Lint retains the existing AuthContext Fast Refresh warning; build retains the existing bundle-size warning.

Database evidence:57 focused review assertions,143 existing import/history regressions,59 observed concurrency checks, and24 schema7 release assertions. Actual local API evidence:70 Auth/HTTP/PostgREST checks for intake/review/recovery and42 Auth/Storage/PostgREST checks for mixed record releases and artifact delivery preparation. All source responses are synthetic, no provider request occurred, and disposable cleanup was verified. See the [database contract](../plans/ezyvet-vaccination-review-contract.md), [review runtime evidence](../evidence/reviewed-vaccination-runtime-local-20260913.json) and [release runtime evidence](../evidence/reviewed-vaccination-release-local-20260913.json).

All45 targeted browser cases passed. The51→74 migration upgrade and restore preserved14 source/review tables, including an approved vaccination and its request, plus existing Auth/clinical/billing/private-file fixtures. Canonical functions, grants and triggers matched; disposable cleanup passed. See [restore evidence](../evidence/reviewed-vaccination-restore-local-20260913.json). Hosted staging remains at72 migrations with the prior intake importer; this increment is not yet deployed and does not activate clinical release policies.
