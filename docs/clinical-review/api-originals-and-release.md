# ezyVet originals — chart and client-package review

**DRAFT · NOT APPROVED · prepared September 14, 2026**

For Dr. Susan Edler and the practice administrator. Implementation baseline: `69f509aa98189d774e6d16768417b4f96999a1f6`, [PR #130](https://github.com/finite0001/livingroom-vet-care/pull/130), migrations 7000–7200 and release schema 9. This is a review script, not a completed rehearsal. All decisions remain pending. Record the actual deployed revision before starting; another branch or staging environment may implement different behavior.

## What Dr. Edler is reviewing

An administrator checks a captured ezyVet file's source and patient association, then admits it to the chart. A veterinarian downloads and acknowledges the exact admitted version. Staff can subsequently select that version for a client record package. These are separate actions.

PR131 corrected the baseline chart's outdated release-exclusion copy and clarified package limits. The subsequent [preview-download increment](../../plans/20260914-release-original-preview/plan.md) lets active DVMs use “Download selected API original” directly within the preview, preserving package selection. This uses the existing reviewed-original endpoint and checks the selected version's bytes. It does not broaden ADMIN-only or other staff access. Starting a download clears the package-review checkbox; successful download does not check it automatically. A preparer who cannot inspect the files must have an authorized DVM complete package review rather than attest to work they did not perform. Record the actual deployed revision and assess this handoff in the session.

The application preserves the file; it does not interpret its contents into a diagnosis, treatment, prescription, active due plan or certificate. Review whether the words “provenance reviewed,” “clinically reviewed” and “acknowledgment” communicate those limits to staff and recipients. Record requested wording changes rather than assuming the existing language is approved.

## Prepare one supervised synthetic session

The technical facilitator prepares the environment and synthetic source receipts; Dr. Edler need not enter IDs, hashes or SQL. Use an isolated local test environment or a separately verified staging revision. The existing automated fixtures are engineering evidence, not a ready-made staff login or a clinical review session.

Prepare a fictional household with two pets, an administrator account and a separate DVM account. If one staff member holds both roles, also check an ADMIN-only account so combined permissions do not mask the distinction. Prepare:

- One captured PDF for the first pet, clearly labeled synthetic, containing an outside-history statement and no real patient details.
- A second captured original for the same source attachment series, with visibly different synthetic content, for replacement review.
- One historical provider observation and one unrelated original associated with the second pet.
- One ordinary patient document for a mixed package. It remains distinct from the API original.

Use the existing capture/review workflows or their synthetic fixture harnesses; do not manufacture clinical approval by editing database rows. First demonstrate the unaccepted release-policy gate. Positive confirmation/delivery preparation requires the facilitator to document a **synthetic-only test policy**, using the established test setup. A fixture policy is not practice approval. Keep real sends disabled. Do not send to an invented address: `.test` recipients are fixture values only.

## Chart review cases — C12

| Case | Staff action and expected result | Dr. Edler's decision to record |
| --- | --- | --- |
| A01 · Source and patient | ADMIN opens “Review your captured originals for admission,” checks source association, downloads the captured original and enters a reason. The attestation identifies provenance review separately from clinical review. | Are the source, patient and reason sufficient for admission? Is any required information missing? |
| A02 · Separate acknowledgment | After admission, the chart says “Clinical review pending.” ADMIN-only admission does not count as DVM acknowledgment. | Can staff distinguish an available historical file from a clinically reviewed file? |
| A03 · Review the exact file | DVM selects “Download chart original version 1,” inspects the file, then checks “I clinically reviewed this exact downloaded original version 1.” The acknowledgment becomes available only after verified download and attestation. | Does the attestation mean what the practice intends? Does it avoid implying agreement with an outside author or creating a local signature on that author's record? |
| A04 · Historical source | Admit a permitted older observation. The chart discloses “Historical source at admission”; release selection says “Historical provider source at admission.” | Is it clear that the preserved file is historical and the application does not certify today's provider contents? |
| A05 · Replacement | ADMIN admits a different captured original as the next version. The earlier file and acknowledgment remain in history; the new version needs its own DVM review. | Are the sequence, reason and need to re-review obvious? Could staff mistake the old acknowledgment for review of the replacement? |
| A06 · Withdrawal | ADMIN prepares withdrawal with a reason. The current file is labeled withdrawn and history remains available. DVM historical download remains possible, but new acknowledgment of the withdrawn version is unavailable. | Is the distinction between withdrawing use and deleting evidence clear? Is the reason visible enough? |
| A07 · Failed or interrupted review | Facilitator demonstrates a failed verified download and an uncertain save response using synthetic fault injection. Failed download cannot satisfy attestation; recovery resolves the saved operation instead of creating a duplicate decision. | Does the feedback tell staff whether they must reopen the file or recover the prior action? Does navigation retain unfinished review work? |

ADMIN-only staff can retrieve their own captures under the capture workflow. That is different from DVM access to admitted chart originals. Staff can see permitted chart provenance without gaining direct private Storage access.

## Client-package cases — D02 and D04, schema 9

| Case | Staff action and expected result | Review decision to record |
| --- | --- | --- |
| R01 · Policy gate | With schema 9 policy unaccepted, demonstrate that confirmation is blocked. Record the test environment and policy state before positive cases. | Is the operational gate understandable? Clinical acceptance and configuration acceptance must have separate evidence. |
| R02 · Select one original | Select one latest, nonwithdrawn, DVM-acknowledged API original. Unacknowledged and other-patient originals are not eligible choices. Review patient, recipient and selection before confirming. | Can staff identify exactly which version and recipient they are authorizing? |
| R03 · Report versus original | DVM previews the package and downloads the exact selected files using the preview's download buttons without clearing selection. Starting download clears any prior package attestation; open the verified file and review before attesting again. A failed download or changed staff session must not produce a file. Inspect originals from both synthetic delivery paths. Printing the report alone does not embed the source PDF/image. | Can the DVM match every downloaded original to the selected version? Is the separate attestation clear? Is ADMIN-only handoff practical? Would recipients distinguish the report from the original and understand omitted chart content? |
| R04 · Mixed package | Select an ordinary document and an API original. Ordinary files precede API originals; the API filename includes its source attachment ID. Compare the preserved original content across both prepared delivery paths. | Can recipients match the provenance entry to the correct original without confusing an API capture with a staff-uploaded document? |
| R05 · Source refresh | A later metadata observation alone does not erase admitted historical evidence. Demonstrate the historical disclosure and recheck the selected record identity. | Is the distinction between a newer observation and an actual replacement understandable? |
| R06 · Replacement or withdrawal after confirmation | Prepare a package, then replace or withdraw its selected original. The prior package remains historical and new delivery is denied. A fresh package requires current eligible evidence. | Is stale-package feedback prominent enough to prevent staff from treating an old confirmation as current permission? |
| R07 · Patient/household mapping changes | Facilitator changes the relevant synthetic mapping. Pending delivery is blocked; changing it back does not silently reactivate the old package. | Does the recovery path lead staff to fresh recipient/source review? |
| R08 · Recover a captured package | Capture a synthetic payload before withdrawal, then retry preparation after withdrawal. Exact captured content can be recovered without rereading Storage; this does not permit a new queue/send or public retrieval. | Are historical recovery and current delivery permission clearly distinguished? Withdrawal cannot recall a file already downloaded or emailed. |
| R09 · Selection limits | Demonstrate the 20 API-original selection cap and the combined 24-original limit. Oversized packages are rejected rather than silently shortened. | Does staff understand how to prepare explicitly selected smaller packages and disclose their partial scope? |

The engineering limits are PDF/JPEG/PNG, at most 20 MiB per API original and 32 MiB of encoded payload per package. These are software constraints, not clinical retention or completeness rules. Inspect the actual generated report at the recorded revision; the older schema 4–6 HTML examples in this folder do not demonstrate schema 9.

## Evidence and decisions

Use [the session worksheet](api-originals-session-worksheet.md). Record one result for every A/R case, exact revision, roles, observed wording, requested change and supporting synthetic evidence. “Not exercised” is not a pass. If behavior differs, record the discrepancy and reopen the affected case after correction.

Clinical decisions cover C12 and the schema 9 extensions to D02/D04 only. They do not approve the other clinical forms, authorize patient sharing, enable policy 9, establish live ezyVet entitlement or certify complete patient migration. Record clinical acceptance before a separately documented operational activation.

## Engineering references for the facilitator

- [Chart workflow and access boundaries](../features/reviewed-api-originals.md) and [schema 9 delivery behavior](../features/reviewed-api-original-releases.md).
- [Chart review contract](../plans/attachment-original-review-contract.md) and [release contract](../plans/api-original-release-contract.md).
- Staff screens: `src/hub/features/imports/PatientAttachmentOriginals.tsx` and `src/hub/features/record-releases/PatientRecordReleases.tsx`.
- Synthetic delivery acceptance: `tests/ezyvet/attachment-original-release-local-roundtrip.ts`; rendering and byte-integrity cases: `tests/record-releases/api-originals.test.ts`.
- Replacement/withdrawal/mapping contention: `supabase/tests/ezyvet_api_original_release_concurrency.py`.

No live patient samples or credentials belong in this repository. Record authorized practice acceptance separately in the practice's private review system.
