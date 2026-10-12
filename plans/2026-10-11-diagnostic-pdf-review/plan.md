# Package 3C — staff PDF review and private download

Implemented on `feat/diagnostic-pdf-review-20261012`; exact-head CI and specific PR merge approval are pending. #242 is merged as `ef12883` and both hosted backends are at176 migrations with processing/disclosure/release off. This package adds migration177, staff review UI and verified download; its migration/function are not installed or commissioned on hosted backends. [Implementation and local verification](../../docs/launch-evidence/2026-10-12-diagnostic-pdf-review-implementation.md). All45 launch requirements and Susan's practice acceptance remain required.

## Staff experience

Patient 360 should show the exact reviewed diagnostic version and its PDF state: waiting for configuration, preparing, processing failure, stored privately, or registered but unavailable. The existing B1 job status and the new processing/object projection are separate; `captured_unverified` alone never enables a download. Reuse the current patient/diagnostic context and warm semantic tokens, with mobile touch targets and accessible progress/error messages.

Offer an internal review/download action only when the separate disclosure policy permits it and the actual registered object is current. Show reviewed/source dates and whether the report is historical after a correction. Original finalized review already supplies clinical approval; do not invent a second medical approval requirement. Susan still accepts the rendered layout and workflow before launch.

Existing finalized versions remain visible for archived/deceased pets. Their automatic communication suppression is separate from retaining clinical records. A missing/replaced object should show an explicit unavailable state and support escalation; do not automatically regenerate or overwrite an immutable capture. Physical object repair needs an explicit audited recovery contract.

## Download boundary

1. Extend the staff projection and strict Zod DTOs without exposing manifests, processing claims, Storage paths or service keys to the browser. Keep actual actor attribution server-derived and Lovable-generated types unchanged.
2. Add a JWT-authenticated bounded binary endpoint and scoped authorization RPC. Resolve the requested job/version/pet internally; accept identifiers only, never caller bucket/path/URL/base64 values. Use current active-staff authority for the reader independently of the original capture owner, preserving access to historical records after staff offboarding.
3. Recover actual stored bytes with a streaming 3 MiB bound. Compare SHA-256/length to the immutable capture, and verify object UUID, creation/update times and body generation against registration before offering bytes. Current metadata presence alone is not a substitute for byte verification.
4. Recheck current reader eligibility, patient scope, disclosure policy and exact object/source identity after relevant waits and immediately before the response. Use short-lived, patient/version/actor-bound authority; a cached or historical receipt cannot override current authorization.
5. Return PDF MIME, `nosniff`, private/no-store caching and a sanitized filename. Do not publish a public object URL or permanent signed link. Audit what bytes were offered without claiming the user saved or received a file merely because preparation completed.
6. Enable the browser action only from validated response data, and handle expired access, offboarding, object change/loss and transport failure honestly. Preserve source and capture history when retrying; a retry cannot silently create a new PDF for an old capture.

## Verification

- Genuine staff Auth → Patient 360 review/download → exact saved PDF bytes, at mobile and desktop widths.
- Anonymous/inactive/cross-patient requests and arbitrary object-path input denied; staff direct Storage access still denied.
- Current object replacement or deletion, mismatched bytes, oversized streamed response and stale authorization rejected.
- Observed offboarding/disclosure/object-change waits; retained access for a different authorized active staff reader after original-owner offboarding.
- Historical/corrected reports clearly identified; archived/deceased records retained; no provider communication created.
- Restore preserves source/capture/registration/download audit evidence. Do not claim provider object-body backup from database restoration alone.
- Required exact-head frontend, Edge, database and browser checks; specific PR merge approval, then staged default-off hosted rollout and bounded acceptance before commissioning.

## Next dependency

3A2 adds reviewed diagnostic artifacts to selected record-release packages, including vaccine-only versus diagnostic selections and verified client contacts or explicitly authorized third parties. Internal staff download does not enable sending records. Object-body disaster recovery, cleanup, operational monitoring and clinical worker commissioning remain explicit follow-ups.


## 2026-10-12 completion

#243 approved and merged as `deb836e3e69cc1ed4ab4a6f40dff54208c345c9a`; all four required checks passed at exact approved head `e6f7c900bf419fc2f00247f757984ad62c1734e1`. Default-off migration177 and JWT-protected download function are installed on staging and primary, with48 genuine staging checks,19 rollback assertions per backend and unchanged provider/history baselines. [Rollout receipt](../../docs/launch-evidence/2026-10-12-diagnostic-pdf-review-rollout.md). Next is [3A2 sharing-scope and record-release integration](../2026-10-12-diagnostic-pdf-release/plan.md).
