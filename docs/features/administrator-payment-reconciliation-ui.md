# Administrator payment reconciliation review

The invoice workspace includes a reconciliation panel only for a verified active administrator. It selects known existing provider objects and current actor-owned cases through `list_payment_reconciliation_workspace`. Ordinary staff keep the existing payment ledger and blocking messages without access to resolution controls.

The administrator chooses a request from safe discovery metadata, sees its original observation reasons and previews the exact eligible blocker set. Missing provider objects, unsupported context conflicts and contradictory terminal evidence cannot be cleared through this workflow. Unknown-object absence is never treated as evidence that money did not move.

`verify-payment-reconciliation` uses explicit `preview`, `prepare` and `recover` actions. Preparation requires review of the known object, amount and existing blocker references. Its button explicitly says that it fetches fresh provider proof. A stable UUID freezes the original seven prepare arguments; only those nonsecret identifiers, blocker references and snapshot digest enter actor-scoped session storage. Authentication cleanup uses the existing payment-intent prefix. No provider URL, raw payload, proof or credential enters storage or query caches.

Lost preparation responses preserve that UUID. Exact recovery can confirm its original capture or receipt; it never requests new provider evidence. If recovery confirms that no case was created, an explicit discard action rechecks absence before abandoning the uncreated intent. Existing cases remain in history when an administrator closes the review. No replacement case or proof renewal occurs automatically.

Captured evidence is projected into coarse verified status, exact USD amount, account mode and provider observation time. Completion requires an explicit checkbox bound to the saved proof digest, case snapshot digest and exact case ID. SQL remains authoritative for proof freshness, unchanged facts, blocker eligibility and exactly-once ledger application. The UI disables completion after the five-minute proof window; a new explicit review is needed. Resolution may record verified financial facts but does not itself charge a card or issue a refund.

The original case and resolution receipt remain readable after a lost completion acknowledgement and after proof expiry. Only the preparing administrator can complete that case. New observations remain independently blocking; resolving one reviewed set does not resolve future evidence. Busy, uncertain and unsaved work participates in invoice navigation and competing-edit guards. Invoice or administrator changes clear in-memory state and ignore late responses.

Discovery shows the latest 100 own cases and indicates when more exist; a saved outstanding UUID can still be recovered directly. General pagination of older cases and inbox requeue/resolution workflows are separate increments.

Validation includes strict intent/proof/receipt/discovery parser tests, lost preparation before and after commit with reload, lost completion and receipt recovery, missing known objects, expired proof, active-admin restrictions and dirty invoice guards. Browser tests mock the agreed Edge/RPC contracts; provider/runtime and migration verification are maintained with their corresponding backend increments.
