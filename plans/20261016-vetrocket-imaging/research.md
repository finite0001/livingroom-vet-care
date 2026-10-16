# VetRocket evidence ledger

Investigated October16,2026 with the Firecrawl and reverse-engineer-anything skills. Scope: public official pages and the public viewer explicitly linked by VetRocket. No practice login, private tenant, source repository, device or DICOM export was supplied. Our source was inspected normally, not described as REA binary analysis.

## Sources and observed evidence

| ID | Method / boundary | Finding |
|---|---|---|
| VR-P1 | Live Firecrawl scrape of [RocketPACS product](https://www.vetrocket.com/rocketpacs-product), scrape `01a146b0-a06f-7668-95a3-d279bfca8fa4` | Vendor describes a cloud archive/browser viewer, mixed modalities, comparison and measurement controls, uploads, routing and sharing. These are product claims, not practice-account acceptance. |
| VR-T1 | Live Firecrawl scrape of [training](https://www.vetrocket.com/rp-onboarding-videos), scrape `01a146b0-f1c0-701b-be10-6af51e1616b5` | Official training indexes search, viewer, study editing, sharing and specialty measurement workflows. Videos were indexed, not watched; no claim of full video review. |
| VR-T2 | Live Firecrawl scrape of [training source](https://www.vetrocket.com/rp-onboarding--source-videos), scrape `01a146b0-a752-7379-aa40-cbe8eb8d3eb6` | Additional public training links include snapshots, uploads and measurement topics. Linked Drive videos were not downloaded. |
| VR-R1 | REA `capture_browser_scenario`, Evidence `ev_d200080c64b22367f94d945f73e5360e8aefd486541024fc8ef58a317a58a856` | Launched owned Chrome155 temporary profile, loaded the product-page public demo and waited4seconds. Captured DOM/accessibility and network metadata. Vendor viewer rendered controls and requested images successfully. DOM SHA256 `ae16e4e3955a695b158fbed0c0cb160b04c820b545e7e65eb0d01c64ac6ff366`. Some image requests remained unfinished; this is an incomplete network window, not exhaustive traffic. |
| VR-R2 | REA controlled scenario, Evidence `ev_585af2d2e4a0f6bea3c205a1ef4cc1a07f846a586dcc1d946def718492f16679` | New owned Chrome temporary profile, same public demo, waited3seconds, clicked the observed Help control. Help opened and identified viewer version1.64.266.11. Accessibility SHA256 `b47fbb61c022f80d2f4a2dc727fd7a39133710d65325148e23016d65444f5989`. Help describes view transforms, layout, calibrated measurements, annotations, multiframe controls and browser-local annotation persistence. These tools were documented in runtime Help; their measurement accuracy was not exercised. |
| VR-S1 | Bounded official-domain Firecrawl search `site:vetrocket.com API integration DICOM conformance RocketPACS`, search `01a146b5-cc57-746f-8261-a91c5c5b0653` | No indexed matching results. This does not prove that a supported/private API or DICOM conformance statement does not exist. |

Raw REA bundle is retained locally at `tmp/vetrocket-rea-evidence-all.json` (two records,494461bytes). Both owned browser processes reported cleanup `terminated-owned-process`. No authentication storage, header values or network bodies were requested. Full DOM includes vendor code and public demonstration data; it stays out of the public repository. No vendor code was copied into application code.

## Interpretation

**Observed:** the vendor's own published demo uses `https://<host>.vetrocket.net/view.html?link=…`. It loads application resources and image metadata/pixel requests from vendor-specific `.ashx` routes. The captured request paths are browser implementation details, not evidence of a supported integration API. We did not replay those routes independently, enumerate patients or perform writes.

**Design judgment:** preserve diagnostic image rendering in the vendor viewer for the first native register. Keep a private, patient-specific study identity and PDF association in Living Room Vet. This gives staff a useful chart workflow while the actual account contract is obtained. Strict share-link validation supports only the observed URL family; a different genuine account URL needs a documented extension rather than accepting arbitrary hosts.

**Unknown:** practice portal/product/version, tenant identity, supported APIs/DICOMweb/HL7/DIMSE, machine credentials, SSO/embedding permissions, order/worklist support, callback/report semantics, link expiry/revocation, study corrections/merges and device/network connectivity. A public demo establishes none of these for the practice.

## Capability map

| Requested capability | Existing app at base | This increment | Further proof |
|---|---|---|---|
| Patient-specific imaging history | No imaging model | Native manual register and immutable history | Account-level study matching |
| Open study | None | Explicit protected vendor share link | Real practice study on desktop/phone; expired/revoked link |
| Report in patient file | Existing private PDFs | Exact patient/document/version association | Actual vendor report exchange |
| Automatic results | None | Not implemented or claimed | Supported feed, unmatched-review queue, deduplication |
| Viewer transforms/measurements/comparison | None | Retained in external viewer | DICOM samples/codec and calibration validation before native recreation |
| Email/release | Existing reviewed document packages | Independently shareable report PDFs use existing selection; viewer links excluded | Vendor-authorized sharing semantics if later required |

The original integration requirement remains open until a representative practice study/report passes identity, replay, failure and access tests through the agreed interface.

## Infrastructure reference check

Live [Supabase changelog](https://supabase.com/changelog) and [database function documentation](https://supabase.com/docs/guides/database/functions) checked October16. The November10 TLS cipher change is unrelated to these database-only RPCs using the existing client. Private tables retain RLS/no direct grants; guarded staff RPCs have explicit EXECUTE ACLs and pinned search paths.
