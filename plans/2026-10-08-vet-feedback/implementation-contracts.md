# Senior review and shared implementation contracts

**Review result:** the scope and native feature reuse are coherent. Vendor feasibility remains conditional. The review tightened six cross-phase contracts that could otherwise produce duplicate physical/financial events, stale disclosures or misleading communication status. These are requirements for implementation; this document does not claim the corresponding code changes or tests have been performed.

**Source check:** `origin/main` was fetched again during this review and remains `1790f11c1989b3a5daac94757ddbe104299c14b8`. No newer source revision was omitted. Hosted production was not probed.

## 1. Authoritative records and atomic writes

| Domain | Authoritative record | Required boundary |
|---|---|---|
| Client/patient identity | Existing client and patient records | Persisted client writes enforce real phone/email; patient creation validates existing contact-complete client on the server |
| Whogot | Actual completed treatment, dispensing and performed-service evidence | Query sources with their real event types and correction status; prescribing/billing alone does not prove receipt |
| Controlled drugs | Existing physical stock movement, linked to a controlled-register event | Both commit in one transaction; every controlled-product write path enforces the link; witness adds attestation, not movement |
| Diagnostic PDF | Reviewed clinical snapshot and its versioned artifact registration | Snapshot and pending job commit together; asynchronous render/upload registers only matching bytes/version |
| Records disclosure | Reviewed recipient authorization, immutable source manifest and exact artifacts | Preparation/share validates source scope and destination; full-chart packaging cannot silently truncate |
| Invoice payment | Existing verified payment allocation | Native Stripe methods reuse Stripe identities; separate-provider evidence has its own account/transaction namespace; allocate once |
| Doctor production | Attributed invoiced lines plus economic reversals and the saved calculation policy | Rates/splits/rounding and closed-period treatment are reproducible; cash refund and its credit count one economic reversal |
| Gusto input | Approved app batch and identifiable returned draft/result | A repeated or uncertain write cannot create duplicate time/earnings; final payroll action stays in Gusto |

Use existing RPCs and durable jobs where they fit. Do not introduce a generic event bus, new clinical chart store or duplicate payment/stock balance merely to connect these phases. New service boundaries are justified by an actual runtime/interface requirement, such as the PDF-rendering proof.

## 2. Reminder cancellation has a defined cutoff

The current [dispatcher](https://github.com/finite0001/livingroom-vet-care/blob/1790f11c1989b3a5daac94757ddbe104299c14b8/supabase/functions/_shared/outbox-dispatch.ts) commits `start_communication_attempt` before making the external HTTP request. The [current SQL wrapper chain](https://github.com/finite0001/livingroom-vet-care/blob/1790f11c1989b3a5daac94757ddbe104299c14b8/supabase/migrations/20260928190000_no_retryable_sqlstate_for_permanent_conditions.sql) performs final reminder/contact checks and records `attempt_started_at`. The provider request is outside that database transaction.

- **Before authorized attempt start:** a committed death/status change makes routine patient-specific work ineligible. Prove ordering with real concurrent transactions, including the existing invalidation trigger and wrapper locks.
- **After attempt start:** the request can be in flight even if the provider has not returned an ID. Preserve its actual accepted, delivered, failed or uncertain result. Record the status change and suppress future routine work; do not promise recall.
- **Uncertain provider result:** reconcile before any resend. In particular, the current CloudTalk path has no provider idempotency key and deliberately does not blindly retry an ambiguous send.
- **Household scope:** only the affected patient's routine care/birthday work is suppressed. Living pets, authorized staff-directed communications and billing retain their separately reviewed rules.

Choose a consistent lock order for patient/source and outbox state across all participants. Adding a patient lock to a wrapper that already holds an outbox lock without inspecting inverse trigger paths can deadlock. Permanent policy/version conflicts retain the project's `PT409` pattern; do not reintroduce deliberate retryable errors.

## 3. External and asynchronous jobs have different retry rules

| Operation | Stable identity | Recovery rule |
|---|---|---|
| Staff database write | Request ID + immutable submitted payload/version | Repeating identical accepted work returns the existing result; changed payload/version produces an explicit conflict |
| Supplier catalog import | Supplier + file fingerprint + staged row/SKU mapping | Preview/apply can replay without new catalog duplicates or invented physical receipts |
| Device/PACS ingestion | Provider account + source study/export/event ID and source version | Preserve raw receipt; hold unknown identity; replay cannot duplicate observations or drug movements |
| PDF generation | Snapshot/version + render job + artifact hash | Retry the same snapshot; recover upload/registration gaps; never resnapshot silently to newer clinical content |
| Webhook ingestion | Provider + account + event ID | Record/deduplicate receipt and process through verified state transitions; out-of-order events cannot regress settled facts |
| External payment/payroll write | Supported request/idempotency key and provider result reference | Reconcile ambiguous results before another write; use the actual provider's documented idempotency limits |
| Clinical AI generation/acceptance | Source snapshot + generation job/version + acceptance request | Regeneration creates a reviewable version; accepted insertion occurs once and cannot overwrite signed history |

Jobs require bounded claims, clear pending/running/succeeded/failed/uncertain states appropriate to their operation, last actionable error, and a staff owner for unresolved work. Use existing queue conventions; one universal job table is not required. Dead jobs cannot disappear behind an indefinitely spinning UI.

## 4. Precision, dates and provenance are explicit

- Monetary values use integer cents. Percentages/splits and drug quantities use fixed precision with explicit accepted rounding. Deterministically allocate residual cents; report totals must reconcile to source amounts.
- Stock quantity is meaningful only with its unit/container/lot. Package and concentration conversions are reviewed mappings. Opening physical counts establish dated balances; they do not fabricate old clinical events.
- Store instants in UTC; use America/Denver for practice-day views and quiet hours. Clinical due dates use calendar recurrence with reviewed month-end/leap-day behavior. A year is not universally a 365-day duration.
- Diagnostic trends combine only clinically compatible analyte/specimen/unit/method series. Original values, units and reference context remain available after a correction.
- A generated note, document or imported result retains source, actor/reviewer, version and correction lineage. Linking another record does not grant permission to expose that record.

## 5. Rendering and AI access remain narrowly scoped

The PDF renderer receives the authorized source manifest and needed display values, with narrowly scoped access to those artifacts. It cannot fetch arbitrary user-supplied URLs or execute uploaded markup. Select its runtime only after proving actual private-source access, long-document output, bounds, hashing, registration and crash recovery.

AI receives only the selected authorized patient/encounter sources. Source text is data; instructions embedded in a document or transcript cannot redirect record access or trigger inventory, payment, communication or chart-signing actions. Every proposed SOAP, recap, call note and dental change remains reviewable before insertion.

Media/source retention is configured separately from signed-chart retention. Disabling an adapter or deleting disposable source audio cannot erase referenced signed clinical history. Credentials, real patient files and payroll data do not enter this public repository or its synthetic fixtures.

## 6. Proofs precede estimates and activation

| Early proof | Concrete output | Go/no-go condition for dependent work |
|---|---|---|
| Hosted/source baseline | Dated migration/function/configuration inventory and existing-workflow results | Known repairs and target environments; no assumption from an older rollout receipt |
| PDF runtime | One long reviewed diagnostic report rendered, stored, downloaded and retried | Supported deployment/runtime and verified version/hash binding |
| iPhone decoding | Real product labels decoded and confirmed on the target iPhone/Safari | Actual usable labels/formats; desktop mocks are insufficient |
| Supplier access | One representative export/interface and mapped preview from each vendor | SKU/package/unit semantics proven independently for MWI and Midwest |
| Gusto access | Field-by-field supported operation results, including duplicate/uncertain draft recovery | Required two-way field map covered; missing operations remain explicit launch dependencies |
| Imaging/anesthesia | Actual interface specification and representative matched study/export/feed | Identity, time/unit and automatic-arrival mechanism known before choosing the adapter |
| Financing | Susan's selection, practice eligibility, supported test payment/refund flow | A listed Stripe payment method or website purchasing account alone is insufficient |

The single-practice architecture does not justify speculative multi-tenant infrastructure. Measure representative chart size, catalog size, history queries and job throughput during the proofs, then set bounded query/export/media limits and acceptable response times from that evidence. Revisit these limits if practice volume grows.

## Required cross-phase acceptance cases

1. Missing contacts rejected by every persisted client-write path, while historical charts remain readable.
2. Concurrent death and attempt start have a defined outcome; claimed-but-not-started work is suppressed; in-flight uncertainty is preserved without duplicate SMS.
3. Controlled receipt/dispense/administer/waste/return/transfer/adjustment either posts both stock and register evidence or neither; witness and device replay never debit again.
4. Snapshot commit followed by worker failure, or upload followed by registration failure, recovers the same PDF version without losing a referenced artifact.
5. Complete-chart manifest exceeds old source-selection and email limits, yet includes each authorized selected source exactly once and excludes unrelated records.
6. Native Stripe or separate-provider webhook replay plus manual reconciliation cannot pay an invoice twice. A redirect or financing application approval alone cannot mark it paid.
7. Production splits, a one-cent residual, a credit/refund pair, a changed rate and a late refund reproduce the accepted policy exactly.
8. An uncertain Gusto submission and repeated device/media jobs reconcile without duplicate earnings, observations or accepted clinical notes.

These cases belong in the affected phase's tests and the final [release rehearsal](phase-08-release.md). They are not extra feature scope; they establish that the requested workflows remain correct across retries, concurrency and integration failures.
