# Selected medical-record release packages

This module creates an actual review artifact and immutable confirmed package. It does not send records, generate a PDF, fetch original file bytes, or enable attachments on the existing communication outbox. Confirmation remains disabled until a trusted operator records Dr. Edler's acceptance of the release form and workflow in `record_release_policy`. The table starts empty, is not writable by staff or service-role callers, and has an audit trigger. Preview remains available for clinical review before activation.

## Dependencies and stacking

Based on committed `codex/lab-work` (`e52188f`). Certificate backend `f856437` was cherry-picked as `83d030f` because it was not yet upstream. When stacking, retain the certificate backend exactly once and skip this duplicate commit if already integrated. The certificate UI commit is not included. Lab, SOAP, patient-document, and communication normalization schema are existing dependencies. No enqueue/recovery function or raw `attachment_ids` contract is changed.

## Explicit content boundary

`p_selection` contains optional arrays `encounter_ids`, `certificate_ids`, `lab_order_ids`, and `document_ids`. Omitted arrays are empty: no records are included by default. Each array allows up to 100 unique UUIDs. “Some” means selected IDs; “all” means all explicitly reviewed eligible IDs within that bound, split into additional packages if necessary. There is no silent catch-all selection that grows after review.

- A selected SOAP encounter must be signed and belong to the patient. Its S/O/A/P text and **all** signed-record addenda are included. Individual addenda cannot be omitted to hide a later correction. Draft encounters, problem notes, visit-location workflow fields, and other unselected clinical modules are excluded.
- Selected certificates must belong to the patient and have no invalidation events. The exact issued snapshot, issuer signature/attestation, and issuance time are retained. Current patient/catalog values never rewrite the embedded certificate.
- A selected lab must be in resulted status and have its original report explicitly selected in `document_ids`. Only test name, accession, collection/result dates, order version and report reference are included. Lab notes, ordering/planning instructions, interval/template settings, and override reasons are excluded. Lab order versions are frozen; a changed result requires a fresh package.
- Every original must be `ready`, `client_shareable`, and owned by the same patient. Private/internal, uploading, voided, abandoned, other-patient, and missing Storage objects are rejected. Name, version, MIME, byte size, document date and immutable private object reference are frozen. No signed URL is created.

All contents must still be reviewed for disclosure: signed SOAP text may itself contain sensitive information. This module does not automatically redact the original. Exclude an unsuitable encounter or use a separately approved redaction workflow; do not claim the software can recognize private prose automatically.

## RPC contract

`preview_record_release(p_pet_id uuid, p_client_id uuid, p_channel text, p_recipient text, p_selection jsonb)` returns `{snapshot, source_hash}`. It requires active staff. The patient must belong to the specified household, and the normalized EMAIL/SMS recipient must match that household's current primary email/phone. Wrong-household recipients cannot be substituted. Snapshot v1 freezes patient/household identity versions, selected structured content, all selected source versions, and original metadata. The SHA-256 covers PostgreSQL's canonical JSONB snapshot serialization; it is **not a hash of attachment bytes or rendered HTML**.

`confirm_record_release(p_id uuid, p_pet_id uuid, p_client_id uuid, p_channel text, p_recipient text, p_selection jsonb, p_reviewed_snapshot jsonb, p_reviewed_hash text, p_attest_review boolean)` requires enabled clinical acceptance and explicit review of both contents and recipient. Pass the complete preview and its hash unchanged. The server recomputes both under source locks and rejects stale/altered contents with `40001`. Keep the UUID and original payload through ambiguous responses. Identical retries by the original actor return the same row, including after later invalidation; the caller must read current eligibility before exporting for delivery. Changed payload or another actor cannot reuse the ID.

`read_record_release(p_id uuid)` returns `{release, events, eligible, ineligibility_reason}`. The release omits its internal retry request and always retains the original immutable snapshot. This read verifies current source eligibility/hash when no event already disqualifies it. Storage absence or recipient changes fail closed. Source eligibility is **not proof of messaging consent or successful delivery**.

`withdraw_record_release(p_id uuid, p_release_id uuid, p_reason text)` appends a reasoned, actor-stamped event. The event UUID and exact payload are idempotent. No history update/delete is available.

`authorize_record_release(p_id uuid, p_client_id uuid, p_channel text, p_recipient text)` requires active staff, enabled clinical acceptance, current package eligibility, and the exact household/recipient association. It returns the authorized package bundle; it accepts **no raw document IDs**. No transport worker is granted execution. A future server-side outbox adapter must recheck consent/suppression, actual recipient, current package eligibility, immutable original references, provider size/MIME limits and delivery state at send time. A package must not become a bypass for existing messaging preparation or recipient controls. Keep the current raw-attachment rejection intact until that adapter is reviewed and tested.

## Invalidation and concurrency

New encounter addenda, certificate invalidation events, lab-order revisions, document changes/voids, or patient/household changes append `source_changed` events to existing packages. Original package contents never change. These conservative invalidations may require rereview even when a source edit affected a field excluded from print, because the reviewed version changed.

Encounter/addendum and certificate/event parent locks coordinate confirmation with concurrent corrections. Lab locks precede document locks, matching the lab writer's lock order. Read/withdraw locks coordinate package eligibility. Original Storage metadata is rechecked during authorization; ordinary staff cannot replace finalized originals. A privileged operator changing Storage outside the application is not covered by a cryptographic hash of the original bytes. A transport adapter should verify any additional binary integrity evidence it needs before attaching bytes.

Already downloaded or delivered copies cannot be remotely recalled. Withdrawn/changed copies remain available as visibly invalidated historical artifacts; only a new reviewed package can restore delivery eligibility.

## Review/export component

`renderRecordRelease({preview, confirmed?})` returns deterministic, escaped, self-contained HTML. Without confirmed metadata it is watermarked **REVIEW DRAFT**. Confirmed exports must use a fresh `read_record_release` result. Ineligible/event-bearing copies are marked **INVALIDATED RELEASE** and prohibit delivery. Certificates use the existing frozen certificate renderer. The original attachment manifest lists filenames, MIME and sizes; private Storage paths and file bytes are not placed in the exported HTML. No PDF or attachment download is implied.

`RecordReleaseArtifact({artifact})` displays the HTML in a sandboxed iframe and its **Save review HTML** button downloads those actual HTML bytes. It provides no confirmation, sender, raw-document download, or provider call. Root integration owns selection controls, explicit confirmation UI, fresh status retrieval, shared dirty-state handling, and later delivery integration. A field named `eligible` must never be treated as a live guarantee after the underlying RPC response becomes stale.

Validation covers signed-only and same-patient boundaries, private content exclusion, explicit lab report selection, frozen size/MIME, recipient matching, clinical gate, snapshot/hash conflicts, UUID/actor retries, corrections/voids, withdrawal, RLS/audit, HTML injection, certificate snapshot composition, the sandboxed review component, and an actual HTML download.
