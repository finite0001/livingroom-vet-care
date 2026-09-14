# Reviewed API originals in record releases

Base: merged PR #129 (`1b78f8865dce4c9a50dcc36713c749d826466fe6`).

Purpose: let staff include admitted, DVM-acknowledged ezyVet originals in immutable client record packages, with independently verified email and document-link delivery.

Contract: `docs/plans/api-original-release-contract.md`.

1. Repair the inherited database-CI cleanup failure: restrict privileged cleanup to positively identified disposable databases, preserve primary errors, and reproduce the restricted-role/superuser-backend case.
2. Implement migration 7200: schema 9 preview/list/selection, policy gate, source currentness and invalidation, serialized review mutations, private delivery contexts, independent capture-byte verification and database tests.
3. Implement schema 9 rendering, validators and bounded private-original delivery for email/document links; preserve prior schemas and captured recovery. Add transport tests.
4. Implement staff selection and provenance disclosures with policy 9 gating and browser coverage.
5. Integrate and validate frontend, Edge, database, contention and local HTTP/restore paths. Record reproducible evidence and create a reviewable PR against the current integration branch.

No production migration, clinical approval, external message, purchase, or provider write-back is part of this increment. Living Room Vet remains primary; ezyVet remains a read-only import source.

Status: implementation integrated, with independent runtime and database review. Verification is tracked in [PR #130](https://github.com/finite0001/livingroom-vet-care/pull/130). The CI workflow includes frontend/browser, Edge, database/HTTP/concurrency, and isolated populated-restore jobs. Its restore job retains only a sanitized receipt. Hosted commissioning and clinical acceptance are not complete.

Next candidate after this increment: an operator-owned migration coverage ledger connecting existing patient/resource runs, reviews and capture receipts. It must distinguish observed, staged, admitted, rejected, unresolved and failed work; a completed page is not proof of a complete source export. Hosted staff rehearsal and clinical acceptance remain separate launch gates. Keep the approved Fastmail + one Resend setup and read-only ezyVet direction.
