# Medication return reconciliation — clinical and operational review

Status: implementation under local verification; not approved for clinical use. Reviewer: Dr. Susan Edler.

## Workflow to review

The original prescription, dispense, invoice and pickup history remain immutable. A correction references one exact prior intake, disposal or restock entry and a quantity from its original allocations. New events explain the incorrect claim and the physical facts reviewed. These corrections do not increase prescription allowance or create credits/refunds.

- Retract intake only for an incorrectly recorded receipt quantity. This is a correction to the claim that medication was received.
- Retract disposal only after explicitly confirming the affected medication was not destroyed and remains physically held.
- Retract restock only after explicitly confirming the affected medication was removed from available stock and remains physically held. The database records an exact negative movement against the original lot and original positive return movement.
- If available stock cannot support the negative compensation, staff report the discrepancy. The system does not invent stock to complete the correction.

A discrepancy report identifies the exact source event, affected allocations and observed facts. Open cases hold affected lots from dispensing, manual adjustment and further positive return restocking. Receiving stock remains possible; receiving alone does not resolve the case or remove the hold. Negative correction compensation remains possible under a hold.

Staff may report and append notes. Active DVM authority is required for quantity corrections and resolutions. A corrected resolution identifies the case-linked corrections accounting for exactly the reported quantities. Confirmation that the original quantities, custody and stock remain accurate requires an explicit factual attestation and is unavailable once corrections have been linked to that case. Neither resolution erases the report or notes.

## Records and recovery

Current print format4 and record package schema13 disclose effective balances, original claims, retractions and discrepancy history. Order-only selections include a summary without silently selecting individual dispensing notes. Historical package formats remain readable; a current older-format request fails if it would omit reconciliation evidence.

An interrupted save keeps its original operation identifier and reviewed request. Staff recover that receipt before creating another request. A changed quantity history or discrepancy decision requires a fresh review.

## Review questions

1. Are the physical-fact attestations clear and sufficient for the practice's custody procedures?
2. Are the staff/DVM responsibilities and discrepancy resolution choices appropriate?
3. Do the lot holds and receiving behavior fit actual inventory handling?
4. Are patient-facing correction and discrepancy notes understandable and suitable for released records?
5. Does the separate future credit/refund workflow preserve the desired division between custody accounting and billing decisions?

Restock policy acceptance remains a separate explicit review and defaults to disabled. Synthetic test results do not constitute clinical acceptance, hosted rollout or provider commissioning.
