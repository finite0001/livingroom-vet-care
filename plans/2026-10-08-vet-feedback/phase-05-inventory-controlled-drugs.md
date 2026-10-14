# Phase 5 — Supplier imports, iPhone barcode scanning and controlled drugs

**Status:** Planned. **Priority:** high; complete the drug log before using this app as the controlled-drug register. **Requirements:** N01–N02, N19; H11–H12. **Dependencies:** real supplier samples/access; current inventory ledger; Phase 1 product/event search linkage. [Vendor findings](integrations.md).

## 5A — MWI and Midwest product import

1. Obtain supported sample exports or interface contracts from the existing accounts. Scope is **product/SKU catalog import**; purchase-order submission is not implied. Set vendor-specific adapters behind one preview/review contract.
2. Add supplier-product crosswalks keyed by supplier + SKU, mapped to existing catalog IDs. Keep manufacturer/GTIN/barcode identifiers distinct from distributor SKUs. Preserve leading zeros and original identifiers.
3. Map product name, strength/form, package size, purchase unit, stock/dispensing unit and conversion, manufacturer and supplier cost/effective date. Practice selling price changes require explicit review.
4. Stage each import with source fingerprint, row errors, proposed additions/updates/duplicates and audit. Review matches before applying; repeated files and retries do not duplicate products. Conflicts do not auto-merge medically different products.
5. Keep catalog import separate from receiving physical goods. Lot, expiry, container, quantity and location are captured on the actual receipt. Reuse the existing stock movement and billing identities.

Supported file import can satisfy product import if it actually imports both vendors' real data. If the selected requirement becomes unattended synchronization, file import is only an intermediate milestone; obtain explicit agreement rather than silently substituting it.

## 5B — iPhone camera scanning (required)

1. Prototype camera capture and barcode decoding on an actual practice iPhone in Safari, over HTTPS, with real labels from both suppliers. Select a maintained decoding library/runtime only after that proof; do not rely exclusively on the browser's limited-availability `BarcodeDetector` API. See [MDN compatibility](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector).
2. Add **Scan barcode** beside product lookup in receive/dispense workflows. Decode locally where practical; stop the camera on close/navigation. Handle denied permission, glare/unreadable labels and returning from the background. Camera access requires permission and secure context. [Camera API documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
3. Resolve a barcode to product/package; show confirmation and then select/confirm lot, expiry, location, quantity and patient as required. If a supported GS1 label actually encodes lot/expiry, parse and display it for review. Never infer absent information.
4. Unknown/ambiguous codes require staff mapping, not automatic catalog creation. Debounce repeated frames; stock changes occur only through the existing confirmed transaction. Preserve manual entry for recovery, while real-camera scanning remains a launch acceptance requirement.

## 5C — Controlled-drug ledger with independent witness

1. Design the register with Dr. Edler: controlled products, concentration/units, individually identified containers where applicable, storage locations including mobile stock, authorized roles, witness-required events and timing, count/reconciliation workflow, report fields and record policy.
2. Link receipt, administration, dispensing, waste, transfer, return/disposal and adjustments to existing stock events. Each physical movement posts once with a stable event ID; the controlled register and ordinary stock ledger must reconcile, not maintain independent quantities.
3. Use atomic transactions for movement and register entry. Record real physical events promptly; a pending witness is visible outstanding attestation, not a reason to hide stock movement. Prevent unauthorized finalization where a witness is required.
4. Witness signs the exact immutable event/version using their own authenticated identity. No self-witnessing, typed-name substitution or approval reused after a change. Signed corrections use linked compensating/amending entries; do not mutate the original or erase discrepancies.
5. Add count/reconciliation with expected vs observed balance, investigation ownership and explicit resolution. Provide drug/container/date/location audit export showing starting/ending balances, event actors/witnesses and outstanding attestations.
6. Verify the actual practice's applicable controlled-drug requirements using current authoritative sources before production claims. This plan specifies software behavior, not regulatory certification. State reporting, if required for the intended workflow, needs its own explicit connector/acceptance task.
7. Enforce the register link in the common server-side stock-movement boundary, including existing receive/dispense/administer/waste/transfer/return/adjustment paths and future device imports. A controlled-product movement cannot commit without its corresponding register event; ordinary stock APIs and direct table access cannot bypass this rule. Witnessing attests the committed event and never posts another stock debit.
8. Use fixed-precision quantities with explicit canonical stock units and reviewed package/concentration conversions. Serialize container/lot mutations in a consistent order; reject unsupported precision and shortages. Activate each existing controlled container through a reviewed physical opening count and dated provenance. Do not synthesize historical administrations from its current balance.

## Files and schema

| Action | Absolute path | Change |
|---|---|---|
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/inventory/InventoryPage.tsx` | Supplier import, barcode entry and controlled-product linkage |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/inventory/api.ts` | Reviewed import and identifier lookup RPCs |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/anesthesia/AnesthesiaDrugAdministrations.tsx` | Link controlled events to anesthesia administrations |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/inventory/supplier-imports/` | Adapter preview/mapping/apply UI |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/inventory/barcode-scanner/` | Camera capture and decode adapter |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/controlled-drugs/` | Register, witness queue, count/reconciliation and reports |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_supplier_product_identifiers.sql` | Supplier/identifier/staged-import model |
| Create separately | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_controlled_drug_register.sql` | Event/witness/count model and ledger linkage |

## Acceptance

- [ ] Each vendor sample imports correctly; same SKU from different suppliers stays distinct; duplicate import does not create stock/products.
- [ ] A vial/case/tablet or mL conversion is reviewed and exact; historical dispensing prices are unchanged.
- [ ] Scan real labels on iPhone; wrong/unknown labels, permission denial and repeated frames fail safely. No external scanner is required.
- [ ] Controlled receipt → administer/dispense → waste → count reconciles with ordinary stock, including mobile transfers.
- [ ] Self-approval and stale-version approval fail; real independent witness succeeds; actor/witness permissions are tested.
- [ ] Retry/concurrent dispense cannot double-debit or overspend available stock; discrepancy resolution preserves history.
- [ ] Attempt each existing stock-write path against a controlled product: the movement and register event commit together or neither commits. Witness approval and duplicate anesthesia/device receipts do not debit stock again. Opening counts, fractional quantities and concurrent container operations remain exact and auditable.
- [ ] Extend inventory locking/concurrency and fulfillment tests; add controlled-register SQL and two-user browser tests. Dr. Edler signs off on operational/register behavior before activation.
