# Native prescribing implementation contract

Status: planned; based on repository inspection at `50a27d7`. No dosing recommendation or legal compliance claim. All clinical values are manually authored and reviewed by the practice. No provider requests are necessary for this implementation.

## Authority and records

Use additive migrations; preserve legacy refill requests, imported history, invoices and movements. Do not rewrite old migrations or backfill legacy APPROVED into clinical authority.

1. **Prescriber configuration:** a native, audited eligibility record, separate from vaccine-certificate approval. Active DVM role and active staff membership are required for signing/canceling/replacing. Preserve prescriber identity and practice-reviewed credential snapshot at signing. ADMIN alone is not a prescriber. Configuration changes need narrow administration authority and history; never use a browser-entered name as identity. Synthetic configuration is allowed in fixtures, never represented as production clinical approval.
2. **Draft:** UUID, patient and current household, optional native encounter, exact manually entered medication identity/strength/form, SIG/directions, route, quantity and stock unit, allowed refills, start/expiry dates, author, revision and server timestamps. Explicit linked catalog product only for stocked dispensing. Support a documented external-dispensing order without debiting stock, while marking external fulfillment unknown until separately recorded. Freeze fulfillment mode as `practice_stock` or `external_pharmacy` on the signed authorization. Only practice-stock authorizations permit native stock fills. Changing mode requires an explicit DVM replacement and reconciliation of prior/local/external use; unknown external fulfillment must be disclosed and cannot silently become fresh local allowance. No implicit product substitution or unit conversion. No automatic dosing defaults.
3. **Signed authorization:** immutable full draft snapshot/hash, patient/household versions, prescriber configuration/version, signature attestation, alert-review snapshot/hash, signed timestamp. Signing neither dispenses nor bills/sends. Concurrent draft edits or changed alerts invalidate signing review.
4. **Authorization events:** append-only cancellation, replacement and annotations with exact predecessor/version and reason. A signed direction/quantity/refill change requires a new authorization; link to the old and supersede atomically. Prior fills remain attached to the original. Replacement starts with explicit new allowance; never silently copy remaining balances. DVM review must show original used/unused allowance before replacement.
5. **Refill requests:** requests are operational intake, not authorization. Native requests require patient/household consistency and may start unlinked for medication identification. Link an exact signed authorization through an attributed action. Request status cannot manufacture remaining refills, dispense, or signal a signed prescription without receipt evidence. Retain old request/status/timestamps as legacy/unverified history. Replace direct INSERT/UPDATE/DELETE with validated, server-attributed RPCs and append-only transition history. Read access must require active staff. Audit service-role paths as well as authenticated grants.
6. **Operation receipts:** every mutation accepts a caller UUID and strict exact request/version. Server derives actor from `auth.uid()`. Same UUID + same actor + exact payload returns the original result; changed payload fails. Recovery reads by UUID validate identity and return immutable original results despite later cancellation or drift, subject to current read authority. A lost reply requires recovery before retry. Do not claim a negative recovery read proves the original transaction cannot still commit.

New tables use RLS, explicit grants and append-only guards. No direct client/service-role clinical ledger writes. Staff read access is practice-scoped; mutation actor and delegated authority are separate from patient ownership. Historical other-author prescriptions are usable only through explicitly authorized practice workflow, not by pretending the current user authored them. Active-role checks must run again after waits.

### Alternatives considered

Extending imported prescription tables would confuse outside history with local authority and preserve an unnecessary source dependency. Reusing `patient_treatments` would fabricate administration and cannot model signed allowances. A dedicated native authorization/fill model above existing inventory/billing ledgers preserves meaning with a small, explicit transactional integration. Avoid a broad stock-engine refactor unless needed to share actual invariant enforcement.

## Fill allowances and atomic dispensing

Define allowance precisely before SQL/UI implementation:

- A signed order authorizes one initial fill plus an explicit integer number of refills; each fill has the signed maximum quantity in the signed unit. Quantity precision matches existing inventory `numeric(14,3)`; reject excess precision and nonfinite values before casts/rounding can hide them.
- A fill slot has an immutable index, authorization reference and maximum quantity. The initial slot is index 0. Opening another slot requires the preceding slot closed and index within authorized range. Opening/dispensing must be atomic; do not consume refill count merely by viewing a form.
- Partial dispensing appends events to the same open slot until its maximum is reached or a staff user explicitly closes it with a reason. Closure forfeits the undistributed remainder of that slot; it cannot carry into another slot. Display both remaining quantity in this slot and unopened refill slots. Exact clinical acceptance of this rule remains pending.
- One dispensing event may allocate across multiple lots of the exact same product/unit. Quantities must sum exactly to event quantity; duplicate lot IDs are rejected/normalized deterministically. Never split lots into separate refill authorizations.
- Returning medication, crediting an invoice or correcting paperwork does not automatically restore prescription allowance. No silent stock return. Correction references the original event with a reason; any physical stock adjustment, financial credit or renewed authorization is separately explicit and linked.
- External-pharmacy dispensing is not a local stock event. Printing/exporting an order is not proof a pharmacy filled it; do not decrement local stock or invent a local invoice.

A dispense request freezes authorization/head, slot/version, quantity/unit, exact lot allocations, current reviewed patient/household/alerts, same-household draft invoice and reviewed catalog pricing/version. Server preview returns an explicit canonical snapshot/hash. Reject changed price instead of silently charging a different reviewed amount. Invoice issuance, stock exhaustion, cancellation, expiry, patient transfer/deactivation and alert changes must be rechecked inside the transaction.

Write one atomic transaction: immutable dispensing event and lot allocations, negative inventory movements, invoice line(s), invoice version update, allowance consumption and related request transition. Either all effects commit or none do. Link every stock movement/charge to the dispense receipt; never rely only on description text. Do not insert a `patient_treatments` administration record or due-plan entry. Do not call Resend/Stripe or insert outbox work.

### Locking and currentness

Before implementation, map the latest definitions of stock, invoice, patient and alert writers, including additive patches. The effective treatment definition includes the `20260913260000` patch: request lock → patient FOR SHARE through alert review → invoice FOR UPDATE → repeated patient FOR SHARE → lot FOR UPDATE → product FOR SHARE. The original unpatched invoice-first order is not the current contract. Preserve compatible lock modes as well as order; do not substitute a patient FOR UPDATE lock casually. Prescription-only serialization must never reverse the invoice/stock order or cause new shared-lock cycles. Other current paths: receiving locks request → product FOR SHARE → lot FOR UPDATE; adjustment locks request → lot FOR UPDATE; service charges lock request → invoice FOR UPDATE → product FOR SHARE. Acquire multiple lots sorted by UUID. Cancel/replacement/slot writers must share authorization serialization; recheck role, patient state and exact preview after waits.

Use real observed-contention tests, not sleeps alone. Explicitly distinguish transaction-serialized allowance/stock guarantees from the alert/role snapshot guarantee. Existing `read_patient_treatment_alerts` holds patient FOR SHARE, and the problem-write trigger takes that patient FOR UPDATE; profile/allergy updates also conflict on the patient row. Preserve that real transaction-wide protection for the covered alert sources. A new private advisory lock alone would not replace it. Audit any additional native alert source before claiming equivalent protection. If stronger signing/dispensing consistency is required, amend all affected writers under a reviewed lock protocol and test it.

## Staff workflows

Patient page: separate native prescription panel with draft/signed/canceled/replaced history and fill details. Preserve outside prescription history under its original label. Compose draft/uncertain state into the existing single patient route/unload guard.

Editor: staff may prepare a draft; only configured DVM can sign. No auto-filled dosing instruction. Explicit save, reopen, stale-version feedback retaining typed text, and patient/encounter validation. Signing review shows exact patient, household, signed directions/quantity/refills, prescriber and current alerts; requires an explicit acknowledgment.

Fulfillment: open exact authorization from patient or refill request; display cancellation/expiry, used and remaining allowances, current alerts, medication/unit, lot balances/expiry, draft invoice and exact price. Review partial/full quantities and slot closure separately. Only an authorized staff action records dispensing. Pickup acknowledgment may follow without another stock debit or invoice line. A READY label must state what has actually been recorded; do not infer physical handoff from packaging.

Use strict `prescription-api.ts` request/response validation and dedicated state transitions for editing → review → committing → uncertain/recovering → confirmed. Freeze UUID/payload while uncertain, disable conflicting edits, ignore actor/patient-stale responses, and distinguish confirmed rejection from transport failure. If recovery is absent, retry the same UUID only. Server history must permit discovery after reload; unsaved draft memory must not be advertised as durable. Do not store private prescription content in localStorage.

The refill page must display load errors/retry separately from empty results. Replace arbitrary clinical status dropdown and browser timestamps. Native status-driven client notices must derive from an authoritative linked event, require review, and use the existing durable sending path; historical unverified statuses cannot produce “approved prescription” copy as a clinical assertion.

## Labels and record release

Create a versioned, escaped label/order renderer using immutable signed instructions and, for a dispensed label, the actual fill/lot quantities and timestamp. Distinguish order copy, prepared label and confirmed dispense. Reprinting does not create another fill. Retain snapshot/hash and renderer version; current cancellation/replacement warnings appear outside immutable historical content. Dr. Edler reviews required fields and exact layout before live use. No uncontrolled print-window HTML interpolation.

Integrate native prescriptions/fills as explicitly selected record-release groups. Current release schema is 9; allocate a new schema version deliberately and update all renderer, selection, source-validation, email, document-link and original-verification consumers together. Preserve validation/rendering of schemas 1–9 and their imported-history meaning. Do not merely widen numeric schema allowlists without validating the new native fields. Freeze signed authorization, relevant events and selected fills; expose omitted/partial selection honestly. A native prescription release cannot imply automatic pharmacy transmission or medication administration. Delivery remains reviewed and uses existing durable release routes.

## Files and ownership

All paths below have root `/Users/davidedler/livingroom-vet-native-prescribing/`; no file deletions planned. Reserve local migration versions using Supabase CLI after checking canonical pending branches. A hosted metadata read stalled and was interrupted during this phase; local generation may proceed with a unique timestamp while that ledger check remains explicitly unverified. Re-read and reconcile the hosted ledger before any deployment; local generation is not permission to apply it.

| Action | Full path | Responsibility |
|---|---|---|
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/supabase/migrations/<reserved>_native_prescriptions.sql` | Authority, drafts/signed/events/requests/allowances/fills, RPCs and legacy write closure |
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/supabase/tests/native_prescriptions.test.sql` | Contracts, access, lifecycle and atomic side effects |
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/supabase/tests/native_prescriptions_concurrency.py` | Real observed races with owned cleanup |
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/src/hub/features/prescriptions/` | API/state, PatientPrescriptions, PrescriptionEditor, SignReview, Fulfillment, History |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/src/hub/features/patients/PatientPage.tsx` | Native panel and combined guard |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/src/hub/hooks/use-refills.ts` | Actor-scoped validated request API, no raw status updates |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/src/hub/pages/RefillsPage.tsx` | Request/authorization/fill navigation, error states, truthful notices |
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/supabase/functions/_shared/native-prescription-renderer.ts` | Versioned print contract |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/src/hub/features/record-releases/` | Native group selection and preview |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/supabase/functions/_shared/record-release-*.ts` and dependent release/document-link consumers | New native snapshot validation/rendering, preserve older schemas |
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/tests/prescriptions/` and `/Users/davidedler/livingroom-vet-native-prescribing/e2e/native-prescriptions.spec.ts` | Contract/state/rendering and staff workflows |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/scripts/restore-rehearsal/` | Populated authorization/fill/stock/charge restore verification |
| Modify | `/Users/davidedler/livingroom-vet-native-prescribing/.github/workflows/ci.yml` | Native SQL/runtime/concurrency gate |
| Create | `/Users/davidedler/livingroom-vet-native-prescribing/docs/clinical-review/native-prescribing.md` | Exact revision review cases; no inferred approval |

Use the [schema10 consumer audit](release-integration-map.md) and resolve remaining SQL email/link consumers and native runtime entry-point files before implementing those phases. Existing migration-named runtime harness may need a standalone entry point; preserve its regression coverage, rather than disguising native prescribing as ezyVet work.

## Verification and rollout

- [ ] Unauthorized/inactive/non-DVM signing, forged actor, unknown request fields and direct table/service writes fail. ADMIN alone cannot sign. Authorized staff fulfillment is distinct from prescriber authority.
- [ ] Exact retries/recovery after cancellation, changed same-UUID payload rejection, missing recovery while first call commits, reload discovery, wrong actor/target receipts and pagination cursors.
- [ ] Draft version/alert/credential drift, DVM role revocation after observed wait, cancellation versus fill, replacement versus fill, same and different UUID contenders.
- [ ] Initial/refill limits, partial remainder and explicit closure, multi-lot atomic sums, numeric precision, expired lot/order, inactive patient/product, household mismatch, same lot competition and invoice issuance race.
- [ ] Failure rolls back receipt, allowance, movement and invoice effects. Success creates exactly one linked effect set. No treatment administration, due plan, outbox or provider side effect.
- [ ] External-mode orders cannot be locally dispensed; mode change requires explicit replacement/reconciliation with unknown external use disclosed.
- [ ] Legacy status remains unverified; direct status bypass closed; new linked status/notifications require actual supporting events.
- [ ] Desktop/mobile workflows: prepare→DVM sign→request→partial/full dispense→pickup→history→label→selected release. Error/loading/empty, stale review, lost reply, sign-out and dirty navigation cases.
- [ ] Renderer escaping, printed quantity/instructions consistency, old/new release schema validation, cancellation/replacement disclosures, selected/omitted history, delivery retry integrity.
- [ ] `npm run check`, focused browser suite, relevant existing clinical/inventory/billing/release browser regressions, real Auth/PostgREST/RLS runtime and observed concurrency against exact canonical migrations.
- [ ] Populated backup/restore preserves authorization/events/fills, stock/charge links and existing records/private Storage. Canonical counts/hashes updated deliberately; every process terminal and owned cleanup verified.
- [ ] Independent review, evidence receipt with revision/commands/counts/limits, stacked implementation PR and clinical review artifacts. Tests are not Dr. Edler acceptance.

Hosted rollout requires fresh canonical ledger/source checks, backup and compatible migration/UI/provider artifact deployment; no destructive rollback of signed history. Keep live prescriber commissioning disabled until explicit clinical configuration/review is recorded. Existing provider setup is unchanged. A deployed route alone does not prove commercial readiness.
