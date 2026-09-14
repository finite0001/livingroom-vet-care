# Canonical capture to reviewed-original contract

Compared canonical74d0c0c with alternativef8c63ca. These are distinct persistence contracts, not interchangeable migration receipts.

| Concern | Alternative | Canonical integration decision |
| --- | --- | --- |
| Owned request | `ezyvet_attachment_download_requests.actor_id`, status `captured` | Use `ezyvet_attachment_capture_requests.requested_by`, status `ready` |
| Receipt | `ezyvet_attachment_captures` keyed by request | Reference existing `ezyvet_attachment_original_captures.request_id`; retain its independent receipt/intent IDs |
| Object location | `ezyvet-attachments`, receipt stores path | Keep `ezyvet-attachment-originals`; obtain path from the unique original intent |
| Observation | run/page/snapshot/head | Preserve run/page/ordinal/snapshot/head plus separate external attachment ID and file ID |
| Metadata | source payload/hash | Preserve sanitized metadata, stable metadata SHA256 and separate raw observation SHA256; URL renewal must not erase that distinction |
| Receipt identity | alternative capture hash | Keep canonical capture hash binding request hash, intent ID, Storage object ID, bucket/path/digest/MIME/size and canonical entry method |
| Parent | synthetic Animal/Consult contract | Preserve existing canonical Animal parent context; extend other parents only through reconciled contract work |
| Ready-file access | staff Storage policies after review | Canonical bucket has no direct SELECT/UPDATE/DELETE policy, even for uploader; use bounded authenticated server retrieval and exact byte verification for future chart access |
| Approval provenance | `staff_reviewed_api_attachment_v1` | New records use `staff_reviewed_api_attachment_v2` and explicit `capture_contract: canonical_api_original_v1`; no silent reinterpretation of alternate hashes |

## Implemented first increment

New additive migration20260914010000 creates immutable approval/correction records against canonical ready receipts. It retains owner/admin scoping, explicit inspection attestation, exact request/capture identity, latest predecessor, source currentness and exact object metadata. Its saved context contains canonical parent, observation ordinal, file ID and stable/raw hashes. It does not duplicate originals, edit existing migration receipts or broaden Storage access. Exact approval retry is historical recovery; fresh approval requires current source.

Lock order is approval operation7300 → canonical request7000/shared request row → canonical source lock helper (run, mapping/patient/Animal, source gate, attachment) → approval chain7301 → Storage object. Active-admin checks run before work and again after waits/before return. Future release validation must define compatible source/chain/Storage order and must not blindly call an owner/run-scoped helper while already holding release locks.

Fourteen new SQL checks cover explicit attestation, canonical provenance/file ID, exact retry, changed-intent denial, correction predecessor/version, table isolation, immutability, anonymous/service denial and historical-versus-fresh behavior after source change. Existing capture contention remains regression coverage; it does not prove new approval/cancellation/release lock races.

## Remaining integration

Add serialized approval cancellation and discovery/recovery; test approval-specific contention; integrate verified inspection UI and chart server reads; compose schema9 on canonical schema8 without relaxing prescription validation/disclosures. Preserve worker-only private paths and leases. Replay/read/link post-wait fixes require additive versions and canonical-source comparisons. Run actual Auth/HTTP/Storage and populated upgrade/restore on this stack before any hosted proposal. Clinical review and policy activation remain separate from staff original-intake approval.
