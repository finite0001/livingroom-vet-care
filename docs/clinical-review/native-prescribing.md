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

The current renderer produces a printable order/dispensing record, not a claim of fit on a particular label printer. Final label dimensions and required clinical/operational wording must be confirmed and verified in the actual print workflow. Controlled-medication and electronic pharmacy requirements remain separate outstanding parity/commissioning work.

The full workflow review must include changing alerts before signing/dispensing, a canceled authorization, exhausted refill quantity, two partial fills in the same fill slot, a lost save response, stock/invoice rejection, reprinting without stock movement, and selected medical-record delivery. Do not approve those behaviors from these static examples.

## Reproduce the examples

Run `node --experimental-strip-types docs/clinical-review/generate-native-prescribing.ts`. The script uses the actual shared renderer and synthetic test fixture; each artifact includes SHA-256 hashes of both. It makes no network request. Regenerate after renderer or fixture changes. Record the exact implementation revision and source hashes with any review decision; renderer changes require re-review of affected content.
