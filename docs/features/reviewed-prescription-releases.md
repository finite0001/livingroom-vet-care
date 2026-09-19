# Reviewed outside prescriptions in record releases

Staff explicitly select current veterinarian-reviewed outside prescriptions in the patient record-release screen. Each package supports up to20 prescription versions. Partial accounts show the clinician's disclosure before selection; bulk selection fails visibly when the limit is exceeded and preserves existing choices.

Schema8 includes the approved parent and medication-item originals, selected interpretations, outside prescriber reference, reconciliation and missing/omitted item evidence, and correction history. Original quantities and remaining values remain text, not local dose or refill authorization. Unselected observed items remain clearly labeled unreviewed source context. Print, email and linked-document artifacts use the same validator and renderer.

Fresh confirmation requires the latest approved versions, matching patient membership and current parent, consultation and every observed medication-item revision. Even an omitted item's changed source invalidates the account. Corrections and changed source heads append invalidation events without rewriting frozen packages. Exact captured delivery requests still recover their original bytes after invalidation; eligibility to queue or send is checked separately.

Schemas1–7 remain readable. The new format retains original-file digest checks for mixed lab/external documents. No clinical policy, provider resource or delivery mode is activated by this increment.

See [the frozen API contract](../plans/prescription-release-contract.md) and [Dr. Edler's synthetic review cases](../clinical-review/outside-prescription-release.md). Software validation and clinical acceptance are separate; live practice samples and Dr. Edler's approval remain pending.

## Validation

The integrated application passed459 unit tests, type checking, lint and production build; the existing Fast Refresh and bundle-size warnings remain. The31 combined release/prescription browser cases passed on an isolated local port. Database verification passed441 SQL assertions. The161 contention checks cover release confirmation against actual parent/item/consult ingestion and prescription correction, both orders; those checks preceded the later empty-selection normalization, which changed no locks.

The [actual local API evidence](../evidence/prescription-release-runtime-local-20260913.json) records51 Auth/Storage/PostgREST checks, zero provider requests and verified cleanup. It includes partial prescription-only rendering, mixed print/email/SMS artifact parity, independent same-length original-file tampering checks, source-only correction invalidation and frozen-byte recovery. All30 frozen Deno entrypoint checks and isolated invoice/document bundles passed.

The [populated restore evidence](../evidence/prescription-release-restore-local-20260913.json) verifies51→84 migration backfill and restoration of two prescription versions, three review requests, two item runs, the frozen release and original fixtures. After restoring the verified backup,473 functions,252 triggers,191 relations,235 policies and six default-privilege records match canonical state exactly. All owned resources were removed. The rehearsal found and corrected restore-account default-grant leakage; see [the runbook](../restore-runbook.md).
