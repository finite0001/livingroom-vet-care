# Stock and patient treatments

The Inventory screen manages medication, vaccine and service catalog entries; stock receipts; lot numbers, expiration and location; and reasoned count adjustments. Lot balances are computed by the database over the complete movement ledger. Search results are bounded and explicitly labeled when more matches exist. The displayed movement history is recent history, not the source of the balance.

## Susan's catalog drafts

The Inventory screen includes 217 searchable source rows from [Susan's November 10 inventory](inventory/README.md). These are catalog setup drafts, separate from active `catalog_products`: the source groups alternatives and strengths, and has no prices or stock units. Original fields and blank counts are preserved in `catalog_source_items`; no physical stock, prices, vaccine schedules or treatment history are inferred.

Use **Set up variants** to create an exact medication or vaccine with its strength/form, stock unit and price. Repeat for each stocked variant, or link an existing product to avoid duplicates. Multiple products can reference one source row, and multiple source rows can reference the same product. Source-to-product links retain the acting staff member and enter the existing audit log. Supply and retail rows remain drafts until their catalog type is supported; do not classify them as medications to receive stock.

Product creation and source linking happen in one staff-authorized transaction. An interrupted create retains the exact operation ID and fields for same-session retries. After a browser reload, inspect linked products before entering it again. Stock units remain immutable, so confirm whether the count is in tablets, doses, mL or another exact unit before creating a product.

After configuration, receive real lots through **Receive stock**, then record administration/dispensing through the patient treatment workflow. That workflow records the catalog product, lot and patient, debits stock and adds the invoice charge atomically. The source-row **Find patients who received this** link opens Whogot filtered to the exact product. Drafts alone cannot be administered or counted as stock. Reorder thresholds and direct appointment-to-treatment associations are not introduced by this catalog import; patient linkage uses the existing treatment record.

Verification: `python3 tests/inventory/catalog-setup-local.py` independently compares all workbook cells, applies the migration in disposable PostgreSQL, and checks variants, idempotency, identity, audit and denied writes. `tests/inventory/catalog-setup.test.ts` validates draft/form boundaries. The catalog-draft browser scenario in `e2e/inventory.spec.ts` verifies mobile layout, explicit blank fields, an interrupted save retry and Whogot links; the existing inventory and Whogot browser suites cover the downstream treatment/search workflows.

The patient treatment panel records medication dispensing and vaccination, or imports historical records without stock/billing effects. New treatment requires a draft invoice for the same household. Important diagnoses, including resolved historical flags, and legacy allergy information are shown before recording. Administration timestamps use America/Denver and reject ambiguous/nonexistent DST wall times. Clinical dose and stock quantity are distinct inputs.

Retry state retains the operation UUID and exact payload across network failures and same-session navigation. Server rejection clears a rejected intent; uncertain outcomes offer the same-operation retry. Successful changes refresh stock, treatment and household invoice queries. Browser reload after an uncertain operation still requires reviewing history before entering another operation.

Original treatments remain visible after reasoned correction. Corrected records are excluded from the displayed due-date subset. Dates on the currently displayed records are clinician-entered dates, not a complete automated vaccine schedule or a certificate. The full due engine, automatic reminders and reviewed certificates remain separate launch requirements.

Verification: four stock policy tests, two browser workflows for ambiguous catalog/treatment retries, and the existing mobile patient scenario. The read-model migration has 12 SQL assertions and inventory/billing has 58. Mobile flex/grid sizing explicitly allows the form to fit a phone viewport. Clinical workflow acceptance belongs to Dr. Susan Edler.

### Appointment links and restocking alerts

- In a patient's **Medical → Treatments → Recorded history**, open **Appointment link** on a saved practice treatment. Pick the visit and enter why it matches. The date starts on the recorded administration day (Mountain time). Links can be corrected or removed with a reason; this does not re-record treatment, change inventory, or alter an invoice.
- Search a vaccine or medication in **Whogot**, then open its administration source to see the linked visit. In **Schedule**, **Visit treatments** lists the saved treatments linked to that visit and opens their source records. Corrected records are marked. Imported historical records do not establish appointment usage.
- In **Inventory → Product catalog**, edit an active medication or vaccine and set **Alert at or below** in its stock unit. Leave it blank to turn off the alert. Zero means alert at zero. **Home** and **Inventory** show the alerts; they refresh as stock changes and periodically while open. No email is sent.
- Thresholds are per exact product across all locations. Totals use the unexpired inventory ledger, including held or quarantined stock, so they are not dispensing authorization. Products with a threshold but no movement history show **Opening count needed**. Susan's draft rows do not create thresholds, stock balances, or appointment links.
