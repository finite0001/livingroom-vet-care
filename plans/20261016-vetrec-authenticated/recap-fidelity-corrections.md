# Recap fidelity corrections and second baseline

Status: implementing on `fix/clinical-recap-fidelity-20261016`, stacked on evaluation PR269. Dave authorized addressing the remaining plan and using agents on October16. Start with recap defects; clinical policy approvals and live delivery/processing remain separate.

## Scope and ownership

1. Backend: versioned general source-coverage and independent-claim provenance guidance; generation-only native problem field coverage checks. Preserve stored v1 readability and existing payload shape. Required unknown measurements and correction qualifiers belong in cited claims, not only review flags. No case-specific source rewrites or automatic paid retries.
2. UI: display frozen birth date/precision, death date and exact archive timestamp independently in saved recap and source preview. Verify the real components and owned-runtime Patient360 workflow at desktop/mobile widths.
3. Database: new service-only finish-function migration accepts exact v1/v2 prompt versions; preserve authority, replay, signing and policy boundaries. SQL tests exercise both versions, unknown/null refusal and duplicate receipt recovery.
4. Evaluation: preserve the original corpus/receipt/failures. Freeze a new implementation/request plan only after deterministic verification. Under Dave's current instruction, select one complete new eight-request synthetic baseline, once per A-H, no retries, maximum8000 output tokens/case and60-second timeout. Same byte-identical captured corpus controls source differences. No real patient records, hosted clinical writes or key extraction. Existing runner's expiring fixed-input probes, cross-isolate one-shot guards, source-download attestation and finally cleanup apply.
5. Review: inspect every claim, citation, qualifier and forbidden inference against the unchanged fact inventory. Preserve failures. Engineering source-fidelity review does not substitute for Susan's clinical adjudication.

## Verification and release

- Scoped unit/schema/UI tests, offline Python safeguards, TypeScript/lint/build.
- Owned local actual Auth/SQL/HTTP/browser/concurrency and populated restore; complete SQL regression on the final source tree.
- Before/after staging fingerprints and temporary-resource metadata for the bounded provider run.
- Scrubbed new evidence, full private synthetic review packet, CI and reviewable stacked PR. No merge until Dave's specific PR approval under AGENTS.md.
- Real processing stays off until Susan's separate approval, production secret setup and explicit commissioning.

## Following packages

After the recap correction increment, continue patient-linked call drafts and dental proposals with explicit patient/source mapping and existing reviewed-note/chart writes. Supplier, PACS, Gusto and anesthesia exchanges require supported vendor access/sample data. Do not claim a manual register, CSV contract or synthetic probe proves the live integration.

## Bounded run decisions and retained failures

- V2 run `fa894caa00cf466a9728`: exactly8 calls, no retries, all resources removed;7 accepted, H rejected because a historical unrecorded measurement was labeled native problem status. Its raw wording covers the missing measurements; no output was retained for H. Preserve the complete failed run and separate clinical adjudication.
- Under Dave's instruction to address the remaining defects and execute, the coordinator selects **one additional full A-H baseline, at most8 requests**, after tightening this classification instruction as promptv3. This is a new complete comparison, not a retry of only H. Total selected correction budget:16 provider requests across the two fully reported runs; no automatic retries or additional follow-up run is scheduled. Same source corpus/inventory, same model alias, original parser rejection retained.
- Promptv3/schema description explicitly reserve `recorded_status_as_of_capture` for native problem status and classify encounter measurements as historical/uncertain. Do not relax the parser to admit the observed invalid output. The unreleased prompt-version migration now preserves exact v1/v2/v3 receipts.
