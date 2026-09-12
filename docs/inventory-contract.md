# Inventory, vaccination and billing contract

All mutations require an active staff session and derive `created_by` from `auth.uid()`. Authenticated clients have SELECT only on eight new tables; all writes use RPCs. No legacy `pet_vaccinations` rows are changed or copied. Prices and totals are integer USD cents; stock quantities support at most three decimal places. `inventory_lots` represent a product/lot/expiry/location combination; balance is the sum of `inventory_movements.quantity` for its ID.

## Catalog and stock

- `save_catalog_product(p_id uuid|null, p_expected_version int|null, p_name text, p_kind medication|vaccine|service, p_manufacturer text, p_unit text, p_unit_price_cents bigint, p_active boolean)` → `catalog_products` row. Null ID creates. Existing ID requires matching version. Kind and stock unit cannot change; deactivate instead.
- `receive_inventory(p_id uuid, p_lot_id uuid, p_product_id uuid, p_lot_number text, p_expires_on date, p_location text, p_quantity numeric, p_reason text)` → `inventory_movements` row. Creates lot if necessary. Existing lot metadata must match. Positive quantity only. Expired receipts are allowed to reconcile physical stock, but cannot dispense.
- `adjust_inventory(p_id uuid, p_lot_id uuid, p_quantity numeric, p_reason text)` → `inventory_movements` row. Signed nonzero adjustment; balance cannot become negative. Required reason documents count corrections, waste, loss or physically verified returns. Does not alter any treatment or invoice.

Client-generated operation UUIDs must be retained through retries. Reusing a receipt/adjustment UUID returns the original only when actor and exact request match. Do not create a fresh ID after a network timeout without reconciling the existing operation.

## Invoices

- `create_billing_invoice(p_id uuid, p_client_id uuid)` → draft `billing_invoices` row, version 1. Exact owner/client retry returns original.
- `add_invoice_service(p_id uuid, p_invoice_id uuid, p_pet_id uuid|null, p_product_id uuid, p_quantity numeric)` → `billing_invoice_items` row. Requires active service product and draft invoice. Patient, if specified, must belong to invoice client. Copies product name and unit price; increments invoice version once. Exact retry returns original even after invoice is issued.
- `issue_billing_invoice(p_id uuid, p_expected_version int)` → issued invoice with frozen `total_cents`, `issued_at`, incremented version. Requires at least one item. Invoice total is server-calculated sum of rounded line totals. Fetch invoice again after every line insertion so issuance uses the displayed revision.
- `void_billing_invoice(p_id uuid, p_expected_version int, p_reason text)` → void invoice. Only issued invoices with no credits can be voided. Preserves items and total. Reason required. Does not modify patient history or stock.
- `credit_billing_invoice(p_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_reason text)` → append-only `billing_credits` row. Positive amount, total credits cannot exceed issued amount. Exact retry is idempotent. Net accounting balance is original total minus credits (or zero if void).

Credits are accounting entries, **not a Stripe refund or proof of payment**. Payment collection, payment/reconciliation records, tax configuration, PDF invoices, dispatch, estimates, and discounts are later integrations. Staff must not label this foundation as a paid invoice workflow. Draft item records are immutable; billing correction uses issue-and-credit or void/recreate at this stage. Clinical correction never silently restores stock.

## Medication dispense / vaccine administration

`record_patient_treatment(p_id uuid, p_request jsonb)` → `patient_treatments` row. Retain a stable UUID **and the exact JSON request** across retries (including original administration timestamp). Unknown JSON keys rejected.

Live request:

```json
{
  "pet_id": "uuid",
  "lot_id": "uuid",
  "invoice_id": "uuid",
  "quantity": 1,
  "dose": "1 mL",
  "route": "SC",
  "site": "right rear leg",
  "veterinarian": "Clinician name",
  "veterinarian_license": "License identifier",
  "administered_at": "2026-09-12T18:00:00Z",
  "next_due_on": "2027-09-12"
}
```

`quantity` is in the catalog stock unit; `dose` is a separate human clinical instruction. Quantity, dose, route, veterinarian and administration timestamp are required. Site, license and next due date may be omitted when unknown or not relevant. Never invent missing clinical metadata. Timestamp may be at most five minutes in the future. Due date, when specified, must not precede administration's America/Denver date. No automatic vaccination interval is inferred.

The RPC locks the draft invoice and lot, checks active matching patient/client, active product, sufficient stock and expiry, then atomically appends treatment, negative stock movement, invoice item and invoice version. Product name/manufacturer and lot/expiry are copied from stock; caller cannot override these snapshots. Medication/vaccine kind derives from product. Retry returns original without another debit or charge, even if invoice subsequently issued. Any validation failure rolls the whole operation back.

## Historical vaccination records

Same RPC, with `historical: true`, no invoice/lot IDs, required source and explicit product metadata:

```json
{
  "historical": true,
  "pet_id": "uuid",
  "kind": "vaccine",
  "product_name": "Name from source record",
  "manufacturer": "Manufacturer if known",
  "lot_number": "Lot if known",
  "expires_on": "2027-01-31",
  "quantity": 1,
  "dose": "Dose from source or unknown",
  "route": "Route from source or unknown",
  "veterinarian": "Source veterinarian or unknown",
  "administered_at": "2025-09-12T18:00:00Z",
  "next_due_on": "2026-09-12",
  "source": "External clinic medical record"
}
```

Historical records may attach to archived patients, never decrement stock or generate charges, and are explicitly labeled historical. Expiry/site/license/due date can remain null/empty where source lacks them. Certificates must independently enforce completeness and veterinarian approval; a historical row is not automatically a valid rabies certificate.

`correct_patient_treatment(p_id uuid, p_treatment_id uuid, p_reason text, p_replacement_id uuid|null)` → `patient_treatment_corrections` row. One correction per original; exact operation retry is idempotent. Optional replacement must be another record for the same patient. Original and frozen metadata remain visible, and corrected records should be marked excluded from current due/certificate selection. No stock or billing side effects: separately record reasoned adjustments/credits when appropriate.

## Reads and errors

SELECT tables `catalog_products`, `inventory_lots`, `inventory_movements`, `billing_invoices`, `billing_invoice_items`, `billing_credits`, `patient_treatments`, `patient_treatment_corrections`; filter by client/pet/lot/invoice IDs as applicable. `40001` indicates stale revision: reload before continuing. `23514` indicates validation/state/idempotency mismatch. `42501` means staff authorization failed. Show errors without discarding pending UUIDs or request data.
