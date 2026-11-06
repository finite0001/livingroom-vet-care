# Beta diagnostic PDF operation — November 6, 2026

This is the existing **staging, operator-invoked, one-job** path. It does not create a queue consumer, recurring service or delivery provider. Persistent staging commissioning is pending the complete current-image workflow proof and the exclusive migration window; the bounded acceptance runner restores its original policy rows after every attempt. Empty policy rows are the existing engineering default, not a requirement for new clinical approval.

## Exact candidate and configuration

- Supabase project: `kothoqicubowyhwfsrte` (staging).
- Vercel project: `prj_Dn1g9AIBEth78S7V3pqhYHueICl7`; team: `team_BDI4hvAq1AWGIREoc8sRwNLH`.
- Immutable image: `lrv-diagnostic-pdf@sha256:a8ce75e5241a44d1f566eafde611c77414e2f9106e6ee58f3fad34ce319bf22b`.
- The accepted template, worker, validator, font and print settings come from [`trustedProvenance()`](../services/diagnostic-renderer/trusted.ts), which first verifies the actual local source hashes. Do not substitute a mutable tag or compute settings from a separate hand-maintained configuration.
- [`Native image proof`](evidence/beta-renderer-uuid-proof-2026-11-06.json) covers this exact successor. The prior dependency image and historical receipts remain separately retained.

The existing `diagnostic_pdf_runtime_policy` row needs `enabled=true`, the exact image, full trusted provenance, and an attributable existing operator profile in `accepted_by`. The existing `diagnostic_pdf_worker_policy` row needs `enabled=true`, `renderer_sha` equal to the image digest, the same operator attribution, and `settings_sha` calculated in PostgreSQL as:

```sql
encode(sha256(convert_to((provenance->'settings')::text,'UTF8')),'hex')
```

The hash must use PostgreSQL's `jsonb::text` representation. Hashing JavaScript `JSON.stringify` text would produce a different binding. Both singleton rows should be installed together in a transaction after confirming the expected empty state, with a readback through `read_diagnostic_pdf_runtime_config()` and `verifyTrustedProvenance()`. A previously configured row must be compared explicitly before any replacement. Installation must not rewrite historical jobs, captures, manifests or evidence.

The operator profile supplies administrative attribution; it does not assert that the operator clinically reviewed a patient. A persistent staging operator must be selected from verified active profiles. Retired synthetic acceptance actors must not be relabeled as Dave or a clinician's approval.

Staff access is separately controlled by the existing `diagnostic_pdf_staff_disclosure_policy`. Enabling its singleton row permits the existing authenticated review/download path with its current patient, job and staff checks. Record release and recipient disclosure policies remain separate boundaries; generation alone does not authorize an export or delivery. The full acceptance runner temporarily exercises those boundaries, then restores them.

## One-job command

Use the repository checkout that contains the admitted source and installed lockfile. The trusted parent process requires:

- `DIAGNOSTIC_PDF_BACKEND_URL=https://kothoqicubowyhwfsrte.supabase.co`.
- `DIAGNOSTIC_PDF_SERVICE_KEY` loaded securely from the existing staging credential source.
- Existing project-scoped Vercel Sandbox authentication, obtained by the project-scoped OIDC flow used by the proof runner. Do not place credentials in frontend variables, command-line arguments, guest environment variables or logs.

Run the existing entrypoint with the exact finalized panel-version job ID selected for processing:

```sh
node --experimental-strip-types scripts/diagnostics/process-private-pdf.ts JOB_UUID
```

The command prints only a bounded state. `off` means policy configuration has not admitted processing. `stored_private` means exact private bytes were registered; staff disclosure and release eligibility are separate. Retry the **same job ID** after uncertain completion to recover the frozen manifest or captured bytes. A prior claim can require waiting for its existing 90-second lease. `registered_unavailable` is a missing or changed registered object, and does not trigger regeneration or overwrite. Investigate that object through the existing recovery contract.

The command processes one explicit job and does not scan the pending queue. For beta, an operator selects and invokes each job. Automatic processing would be additional implementation; it is not implied by enabling the two policy rows.

## Current resource and isolation limits

Each generation or independent validation session uses the exact image, one vCPU, 2 GiB RAM, a 60-second nonpersistent VM, no exposed ports, and deny-all networking. The rendering command has a 45-second deadline; independent validation has a 30-second command deadline. The worker runs as UID 12001 with no credentials or sudo capability. The VM is stopped in `finally`; sessions and snapshots are not resumed to generate replacement bytes.

Admission limits include a 3 MiB PDF, 40 pages, 5,000 objects and streams, and 16 MiB inflated data. The frozen HTML is limited to 512 KiB and must match the manifest's exact hash. Exceeding a bound fails closed; operators must not enlarge bounds or bypass admission to clear a job.

## Evidence and remaining execution

The current native renderer proof passes. Two bounded staging attempts are retained as incomplete workflow evidence: [first attempt](evidence/beta-staging-renderer-initial-attempt-2026-11-06.json), [second attempt](evidence/beta-staging-renderer-second-attempt-2026-11-06.json). The second confirmed configured deployed email preparation containing the exact PDF, then stopped on a proof-harness parameter omission. Both restored their original policy and outbox snapshots.

The isolated beta runner now uses the actual protected-link Edge preparation boundary without loading signing keys, retains tampered-byte rejection, and revokes every exact owned grant in `finally`. Its three scripts and the operator CLI pass scoped lint and TypeScript checks. Complete current-image hosted workflow proof and persistent staging policy installation must receive separate dated receipts. Neither is implied by the native image proof or this operating document.
