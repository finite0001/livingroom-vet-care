# VetRocket imaging

Date: 2026-10-16. Base: main `989c9e588f00eba22c65377bde013fbfdbbf2bf8`.

## Outcome and boundary

Original requirement N20 is a patient-linked VetRocket X-ray integration. The owner also authorized functional investigation/recreation using Firecrawl and reverse-engineer-anything. We will deliver in distinct increments, without presenting a viewer shortcut as a completed automated integration.

| Increment | Status | Completion evidence |
|---|---|---|
| Public source and demo investigation | Complete, bounded | [Evidence ledger](research.md) |
| Native manually linked study register | Implemented; pending PR release | [Contract](contract.md), migration197, unit/SQL/Auth/browser/restore proof |
| Authorized account and identity proof | Awaiting access information | Actual practice account, stable patient/study identifiers, representative study/report |
| Supported study/report exchange | Pending account contract | Verified adapter, unmatched review, replay deduplication, outage/expiry tests |
| Native viewer recreation, if required | Design after imaging-format/access proof | Representative DICOM codecs, calibrated tools, comparison and persistence tests; no source-code copying |

## Current implementation

1. Add private imaging roots, immutable revisions/action receipts and guarded staff RPCs. Root patient/account/external identities cannot change. Corrections and voiding retain history; no hard delete. Exact-intent recovery handles uncertain saves.
2. Add lazy Medical → Imaging, shared patient identity and dirty-navigation guard. Save requires manual source identity confirmation, explicit source IDs and date. Link optional exact-version encounter and ready private PDF; do not edit SOAP.
3. Open the supported vendor share-link family only on explicit action. No server fetch, embedding, token creation, credentials, diagnostic-image ingestion or silent link disclosure. Report opening checks current source availability; outgoing PDF selection follows existing document/release controls.
4. Test authorization, source identity/version errors, unsafe URLs, uniqueness, concurrent writers, lost-response recovery, source voiding, history, mobile layout and dump/restore. Maintain all migration-count inventory pins.
5. Open a reviewed PR after checks; require green CI before merge. Hosted account acceptance remains a separately identified dependency; no provider gate or clinical policy activation in this increment.

## Files and ownership

Paths below are relative to `/Users/davidedler/Developer/lrv-vetrocket-20261016/`.

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20261016215048_patient_imaging_studies.sql` | Study, source guards, audit/recovery and complete-record omissions |
| Create | `src/hub/features/imaging/` | Strict contracts, RPC boundary and patient workspace |
| Modify | `src/hub/features/patients/PatientPage.tsx` | Lazy section and existing editor/navigation guards |
| Create | `supabase/tests/imaging_studies.test.sql` | Access/source/history/retry invariants |
| Create | `tests/imaging/` | Model and owned Auth/browser/concurrency/restore proof |
| Modify | Existing migration inventory harnesses | 197 exact migrations, latest version and SQL suite inventory |

## Remaining questions

- Practice portal/account and authorized access location; requested asynchronously October16.
- Supported custom-PIMS interface, report format, identity fields, authentication, expiration, notifications and order/worklist requirements. Public demo requests do not establish this contract.
- A practice representative test study and report on which to prove correct-patient mapping. Public demonstration content must never be imported as a real clinical record.

No vendor enrollment, payment, configuration changes or outgoing email are part of this increment.
