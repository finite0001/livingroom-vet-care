# Native physical returns — implementation contract

Scope: implement attributable physical intake into held custody, partial disposal, and explicitly gated return to available stock. Do not alter original dispensing/pickup, refill state, consumed prescription allowance, invoice, credit or cash. This is the next increment after correction121; financial attribution remains separately required. Clinical commissioning is not inferred from local synthetic configuration.

## Records and chronology

One immutable event chain per exact authorization/patient/dispense, sequence1..2147483647, same head shape as correction121. Event ID equals stable operation UUID. All accepted request UUID strings are canonical lowercase. Original native allocation ID is the attribution key; lot ID comes from the verified original. Each accepted intake adds held quantity, with cumulative intake per original allocation <= original dispensed quantity, regardless of later disposal/restock. A disposition names one exact prior intake and may consume some or all of its remaining held allocations. No state is reopened or edited. Corrections of mistaken physical-return claims require a future explicit reconciliation workflow; never overwrite quantities.

Requests accept positive exact decimal strings with at most3 decimals, same upper bound as native fulfillment. Events and balances use fixed3-decimal strings. Allocations sorted strictly by original allocation UUID,1..100 entries, no duplicates or zero quantities. No silent truncation or autoallocation. Unknown origin cannot be linked to a convenient lot; this workflow requires attested exact original attribution. Unknown custody, condition or storage is honestly represented and never restockable.

Every event records server-observed time >= original dispense and predecessor and, for disposition, intake time. The original immutable source is verified again before append. Actor name/authority freezes at commit; blank profile names fail. Intake/disposal require active staff; restock requires active DVM, not prescriber commissioning. After waits recheck current actor and relevant authority. Same actor may recover an old receipt with current active staff eligibility even after DVM role removal.

## Closed RPCs

Types in `supabase/functions/_shared/native-dispense-returns.ts` are the exact JSON boundary.

- `read_native_return_policy()` -> ReturnPolicy. Default version0 disabled with null reviewer/time/reference; no fake approval.
- `configure_native_return_policy(p_id uuid,p_request jsonb)` -> ReturnPolicyReceipt. Request `{expected_version:number,enabled:boolean,review_reference:string,attest_review:true}`. Active ADMIN+DVM required for a new policy decision, exact historical same-actor recovery allowed to active staff. Increment version, immutable prior decision and operation. Disabling uses same review boundary. Request UUID retry cannot create another decision.
- `recover_native_return_policy(p_id uuid)` -> ReturnPolicyReceipt|null; wrong actor unavailable.
- `preview_native_dispense_return(p_intent jsonb)` -> ReturnPreview. Validate exact origin/quantity and return context. For valid restock target, return structured blockers instead of pretending policy approval. Returned intent preserves exact reviewed strings.
- `record_native_dispense_return(p_id uuid,p_request jsonb)` -> ReturnReceipt. Request `{intent,expected_context_hash,expected_head,attest_review:true,attest_restock:boolean}`; attest_restock must equal action==='restock'. Require fresh context, allowed preview and active authority after waits; keep receipt request byte-exact.
- `recover_native_dispense_return(p_id uuid)` -> ReturnReceipt|null.
- `read_native_dispense_returns(p_authorization_id,p_pet_id,p_dispense_id)` -> ReturnRead|null with current verified head and per-original-allocation balances. Wrong exact target returns null.
- `read_native_return_intake(p_authorization_id,p_pet_id,p_dispense_id,p_intake_id)` -> ReturnIntakeRead|null, closed `{version:1,target,head,intake:ReturnIntakeBalance}`. Current per-intake held quantities are readable before choosing a positive disposition quantity; UI verifies head coherence.
- `list_native_dispense_returns(p_authorization_id,p_pet_id,p_dispense_id,p_before_version=null,p_limit=25)` -> ReturnPage; descending exclusive sequence, max100, exact next cursor. Current head included so browser never merges history across a changed head.

Intent has exact fields `target,action,intake_id,allocations,custody,package_condition,storage_history,reason,note`. Intake action requires intake_id null and nonnull custody/condition/storage; disposal/restock require exact intake ID and these3 fields null (the immutable intake defines them). Note and reason are explicitly reviewed as client-shareable. Reason max2000,note max4000; trim/codepoints/control rules from correction121. No client timestamps or actor fields.

## Policy and stock boundary

Restock blockers (stable codes; show all applicable): `policy_disabled`, `dvm_required`, `custody_not_retained`, `package_not_sealed`, `storage_not_controlled`, `original_pickup_exists`, `product_inactive`, `unit_changed`, `lot_expired`.

All must be absent: enabled reviewed policy; active DVM; intake custody `clinic_retained`; package `sealed_intact`; storage `controlled`; no original native pickup ever recorded for this dispense (a disputed pickup amendment does not remove it); current product active with unit matching signed dispense; every selected original lot unexpired on current America/Denver practice date. Policy criteria are fixed software guards, not an assertion that they satisfy every clinical/legal requirement. Live policy commissioning still needs Dr. Edler's review. General audited inventory adjustment remains a separate workflow; do not claim this policy controls every manual stock change.

Intake/dispose have no inventory movement. Restock inserts dedicated positive `inventory_movements.kind='native_return'` entries atomically with disposition attribution and receipt, one per original allocation. No nested call to independently replayable public adjust_inventory. Bidirectional immutable links verify event/allocation/lot/quantity/actor/time and movement ID. Existing balance readers must include the new positive kind correctly; UI must label it. Never mutate old negative dispense movements. Product SHARE before sorted lot UPDATE; no invoice lock required because money is unchanged.

Locks: operation UUID, authorization gate, policy SHARE when restocking, product SHARE, sorted lot UPDATE. Global policy update only policy decision gate/row; it must never acquire authorization or inventory locks. Original pickup and correction writers share authorization gate. Read/print/release gates use the same global sorted authorization order. Context includes exact source hashes, current return head/balances, original pickup/correction head, intent and, only for restock, current policy/product/lot balance/practice date. Receipt replay verifies immutable evidence without requiring current policy/product/expiry to remain eligible.

## Print and release

Add current native printV3, preserving V2 fields plus `return_summary` and `dispense_returns`. V2/legacy print fail closed for an authorization with any return events; historical saved copies stay immutable. Root shared renderer preserves old V1/V2 behavior and validates V3 complete chains.

Release schema12 adds `returns:ReturnSummary` to each selected native prescription and `returns:ReturnDisclosure` to each selected native dispense. All schema11 fields remain. Summary contains event_count, affected_dispense_count and canonical heads_hash (zero=hash([])). Full disclosure ascending1..head, max100events; >100 fails explicitly, never truncates. Only selected fills disclose their event details. Disposition evidence includes no invoice/payment data. Server verifies full immutable documents/hashes before projection; JS checks identities, complete chain, quantities and references, not PostgreSQL JSONB hash recomputation.

Return append invalidates saved10/11/12 releases selecting parent or fill. Old10/11 previews refuse affected authorizations; unaffected formats and exact historical confirmation/recovery/rendering remain supported. New12 uses explicit policy12 acceptance; preserve original-byte verification and worker source gates. Staff UI uses current12. No client/provider delivery is part of local acceptance.

## Acceptance

Actual SQL/API/browser: role/UUID retry/stale target checks; partial multiple-lot intake; cumulative cap despite dispositions; held→partialdisposal/restock; every restock blocker; policy changes/role revocation after wait; competing intakes/dispositions; stock adjustment/receiving/catalog contention; original pickup racing restock; immutable original stock/invoice/allowance/refills; stale saved releases and new complete disclosure; paginated history; >100 explicit disclosure bound. Populated restore must verify return events, policy decisions, operations and linked positive movements. Reuse provider-free owned runtimes and clean up only verified owned resources.

### Original pickup after a return

A new original pickup is refused after any return event on that dispense. The current pickup format has no per-quantity handoff and cannot honestly describe an already partly returned or restocked dispense. Existing original pickup and exact historical receipt replay remain preserved. Preview/commit enforce this under the same authorization gate: pickup wins first -> restock blocked; return wins first -> new original pickup refused. Later narrative clarification uses the attribution workflow rather than manufacturing an unqualified original pickup.
