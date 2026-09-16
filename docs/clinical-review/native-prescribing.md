# Native prescription and dispensing review

Status: **pending**. The renderer and synthetic copies are implemented; the complete native prescribing workflow is still being built. These examples do not establish authorization, real stock/billing effects, legal compliance or production readiness. Dr. Susan Edler's review has not been recorded.

Open the [signed order example](native-prescription-order-example.html), [partial-fill example](native-prescription-partial-fill-example.html) and [canceled historical example](native-prescription-cancelled-example.html). All inputs are fictional. The synthetic directions are not a dosing recommendation.

## Decisions to record against the implemented revision

| Review | Question | Decision/reviewer/date |
|---|---|---|
| P01 | Are the medication identity, strength/form, route, exact signed directions, quantity/unit, validity dates and prescriber fields sufficient and clearly labeled? | Pending |
| P02 | Are initial quantity, authorized refill count, partial-event quantity and absence of a current remaining balance clearly distinguished? | Pending |
| P03 | Does a canceled or replaced copy preserve prior facts without appearing usable for new dispensing? | Pending |
| P04 | Does the practice-stock versus external-pharmacy distinction make clear what has and has not been filled or transmitted? | Pending |
| P05 | Are practice/client/patient identifiers, credential details, lot/expiry details and print dimensions suitable for the intended order and dispensing-label workflow? | Pending |
| P06 | Are authorization, packaging/dispensing, pickup, returns and correction actions separated appropriately in the completed staff workflow? | Pending; requires implemented workflow |
| P07 | Are prescriber verification, delegated staff permissions, manual renewal/expiry rules and partial-fill closure behavior appropriate for practice use? | Pending; requires configured workflow |
| P08 | Does cancellation clearly stop future local authorization without claiming a pharmacy was notified, reversing prior dispensing, or refunding payment? | Pending; requires implemented workflow |
| P09 | Does replacement require sufficient manual review of prior use and a deliberately authored new allowance, especially when external fulfillment is unknown? | Pending; requires implemented workflow |

The current renderer produces a printable order/dispensing record, not a claim of fit on a particular label printer. Final label dimensions and required clinical/operational wording must be confirmed and verified in the actual print workflow. Controlled-medication and electronic pharmacy requirements remain separate outstanding parity/commissioning work.

The full workflow review must include changing alerts before signing/dispensing, a canceled authorization, exhausted refill quantity, two partial fills in the same fill slot, a lost save response, stock/invoice rejection, reprinting without stock movement, and selected medical-record delivery. Do not approve those behaviors from these static examples.

## Cancellation and replacement review scenarios

Review the actual patient workspace with synthetic patients once this slice is verified. Record approval against the implementation revision, not this checklist alone.

1. Cancel an order with a reason, then open its original signed instructions and a fresh printed copy. The instructions must remain unchanged; the current cancellation notice must be conspicuous.
2. Replace an order using a separately authored draft. Compare old and new instructions, quantities and refills, and verify the new authorization points back to the old order's replacement event.
3. Review an external-pharmacy order whose fulfillment is unknown. A replacement requires an explicit, attributed manual reconciliation; the software must not imply it contacted the pharmacy or verified fulfillment.
4. Repeat a request after a lost response. Confirm the original receipt returns, without creating another authorization or event.
5. Attempt cancellation for an archived/deceased patient. Stopping an existing order must remain possible; creating a replacement for an inactive patient must remain unavailable.

Until native fill accounting is implemented and verified, unavailable use and remaining quantities must display as unknown rather than zero. Review the final dispensing workflow separately before approving live use.

## Refill intake review scenarios

These checks concern staff request tracking, not prescribing or dispensing approval. Clinical sign-off remains pending.

1. Select a household and explicitly select the correct patient; record the requested medication and source without creating a prescription or stock charge.
2. Link a request to the exact signed order after reviewing patient, household and current order status. Medication-name similarity alone must never choose the authorization.
3. Cancel the linked order. The request must retain the original link and disclose cancellation; it must not silently follow a replacement or imply medication is ready.
4. Close or deny the operational request with a reason. These actions must not fabricate clinical refusal, dispensing, pickup or client notification.
5. Open a legacy request marked approved/ready/picked up. Its original information must remain available and visibly unverified, without an editable status or a generated clinical approval message.
6. Confirm a lost response can be recovered without duplicate intake or transitions and that request/event pagination preserves all history.

## Reproduce the examples

Run `node --experimental-strip-types docs/clinical-review/generate-native-prescribing.ts`. The script uses the actual shared renderer and synthetic test fixture; each artifact includes SHA-256 hashes of both. It makes no network request. Regenerate after renderer or fixture changes. Record the exact implementation revision and source hashes with any review decision; renderer changes require re-review of affected content.
