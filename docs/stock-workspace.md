# Stock and patient treatments

The Inventory screen manages medication, vaccine and service catalog entries; stock receipts; lot numbers, expiration and location; and reasoned count adjustments. Lot balances are computed by the database over the complete movement ledger. Search results are bounded and explicitly labeled when more matches exist. The displayed movement history is recent history, not the source of the balance.

The patient treatment panel records medication dispensing and vaccination, or imports historical records without stock/billing effects. New treatment requires a draft invoice for the same household. Important diagnoses, including resolved historical flags, and legacy allergy information are shown before recording. Administration timestamps use America/Denver and reject ambiguous/nonexistent DST wall times. Clinical dose and stock quantity are distinct inputs.

Retry state retains the operation UUID and exact payload across network failures and same-session navigation. Server rejection clears a rejected intent; uncertain outcomes offer the same-operation retry. Successful changes refresh stock, treatment and household invoice queries. Browser reload after an uncertain operation still requires reviewing history before entering another operation.

Original treatments remain visible after reasoned correction. Corrected records are excluded from the displayed due-date subset. Dates on the currently displayed records are clinician-entered dates, not a complete automated vaccine schedule or a certificate. The full due engine, automatic reminders and reviewed certificates remain separate launch requirements.

Verification: four stock policy tests, two browser workflows for ambiguous catalog/treatment retries, and the existing mobile patient scenario. The read-model migration has 12 SQL assertions and inventory/billing has 58. Mobile flex/grid sizing explicitly allows the form to fit a phone viewport. Clinical workflow acceptance belongs to Dr. Susan Edler.
