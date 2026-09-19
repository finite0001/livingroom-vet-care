# Physical medication returns — review packet

Status: locally verified implementation; clinical policy not approved or enabled.

Open the [synthetic example](../../docs/clinical-review/native-dispense-returns-example.html) alongside the [RPC contract](returns-rpc-contract.md) and [evidence](../../docs/evidence/native-dispense-returns-20260916.json). Dr. Susan Edler should review custody terminology, disposal documentation, required storage/package evidence, authorized staff responsibilities and whether the proposed clinic-retained restocking policy is appropriate before commissioning.

Staff record return quantities against original dispensed lots. Quantities remain held until disposal or an eligible reviewed restock. Client-returned, opened, uncontrolled-storage, previously picked-up, inactive-product, changed-unit and expired-lot items cannot use this restock workflow. Only active DVMs can restock under an enabled reviewed policy. Historical policy decisions remain attached to their original events.

Original dispensing, refill allowance, invoice charges and payments remain intact. A return does not issue credit or refund. Corrections of erroneous return claims and quantity reconciliation require a separate forthcoming workflow. A new original pickup is blocked once any return is recorded; existing pickup history and exact retries are preserved. Print and release disclosure fails explicitly beyond 100 events rather than truncating history; paginated staff history remains available.

The restore rehearsal covers selected database rows, grants and return integrity; it does not cover storage binaries or full hosted recovery. All checks used synthetic local data with no provider delivery.
