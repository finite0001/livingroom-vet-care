# Source-cited records recaps

Records recap is a private patient-history review in **Patient → Medical →
Records recap**. It summarizes explicitly selected signed native SOAP encounters,
all their addenda, and an optional complete group of eligible native problems.
It keeps the captured sources, model wording and reviewed wording separate.

## Staff workflow

1. Select signed visits. Optionally include all eligible native active and resolved
   problems. Visit-date filters apply to encounters; later addenda remain included.
   Outside-linked problem rows are excluded, including rows edited locally later.
2. Preview the complete selection and its size. Preview does not contact OpenAI.
   The server refuses an empty or oversized selection rather than clipping it:
   at most 20 encounters, 40 problems, 64 source units, 60,000 UTF-16 clinical
   characters and 240,000 canonical UTF-8 bytes.
3. Record the source and permission, attest the patient/selection, and capture.
   Capture saves an immutable source manifest; it does not generate a recap.
4. Explicitly authorize generation. Only the original operator can initiate paid
   processing for that capture. Every retry uses a new bounded attempt with an
   explicit reason and acknowledgement of possible additional charges.
5. Review every proposed dated claim. **Open frozen citation** checks current
   staff access and opens the captured field with its exact excerpt highlighted.
   **Open current clinical workspace** is a separate view and does not replace
   the captured evidence. Exact IDs, hashes and timestamps remain available in
   expandable audit details.
6. Select and optionally edit existing claims, attest review, and retain the
   reviewed recap. Original wording and original citations remain preserved.
   Alternatively reject with a reason. One terminal decision is retained;
   corrections start a new linked recap.

Review authority matches the existing active-staff/live-session clinical model;
it is not a new DVM-only permission. The reviewer is attributed separately from
the generating operator. Authorized historical review remains available for
archived/deceased patients without enabling new care or communication.

## Changed records and recovery

Patient changes, changed source records, appended addenda, and selected problem
membership/eligibility changes invalidate current-source status. Acceptance
checks sources again inside its transaction. Local review edits remain in memory
after a conflict. Rejection can close stale work; a fresh recap captures a new
manifest rather than modifying the original one.

If a response is lost, use **Recover original recap action**. Recovery reads the
original reservation, attempt or review; it never starts another provider request.
Cancel an undispatched action durably before abandoning it. An already committed
or possibly sent action remains recoverable. After reload, unsaved clinical edits
are not reconstructed: browser recovery metadata contains only identifiers,
versions, hashes and fixed nonclinical intent values.

The worker rechecks both originating sessions, policy and sources after waits.
A source-only change during generation may retain visibly stale output while
authority remains valid. Revoked policy/session permits sanitized outcome
metadata only, without retaining generated claims. A received result can be
persisted again exactly after a lost acknowledgement; paid work is never
automatically repeated.

## Independent activation and scope

The recap policy starts **draft**. An ADMIN can record Susan's review of its
specific processing and retention wording. The backend also requires the
independent `CLINICAL_RECAP_PROCESSING_ENABLED` flag; its default is off.
Audio/template approval does not approve recap processing. OpenAI credentials
remain server-side. Structural tests and fake provider outputs do not establish
clinical accuracy; the separate synthetic-model and clinical review plan remains
an activation requirement.

A retained recap does not update or sign an encounter/problem, create a SOAP
proposal, publish records, send a message, or create an export/certificate. Native
narrative medication/vaccine mentions are historical evidence, not a complete
reconciliation or proof of current administration/protection. Uploaded/scanned
documents, OCR, outside-record ingestion, structured lab/medication/vaccine
adapters and automatic note background are separate increments.
