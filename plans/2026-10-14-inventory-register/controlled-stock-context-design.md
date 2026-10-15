# C1b — controlled stock context implementation contract

Status: implementation design, not implemented or commissioned. This refines [phase03](phase-03-controlled-register.md), using the C1a source boundary. It does not approve [Susan’s draft rules](../../docs/controlled-drug-rules-susan-review.md), create a real classification/opening or narrow the [original 45 requirements](../2026-10-08-vet-feedback/requirements.md). C2 workflows and C3 actual practice acceptance remain required.

Implementation split after source inspection: C1b0 first closes the pickup/correction provenance gap in a separate additive migration. Its [implementation boundary](../../docs/features/native-handoff-boundary.md) covers ten early producers without adding unused policy/container tables. The controlled execution schema remains private design work until the complete protocol and its invariants are implemented. C1b0 alone does not complete C1b.

## Reuse the complete entry boundary

Keep all eight canonical signatures, strict request fingerprints, original committed receipts and existing first-entry hooks. Each writer already enters the shared practice barrier before its old locks. Extend the private common entry helper with controlled-operation reservation checks; do not add a second late barrier or repeat large canonical function bodies merely to accept a new context parameter.

An owned wrapper stores the original canonical arguments separately from the strict controlled context and invokes the canonical writer once. New managed-source guards cover stock, custody-only returns and discrepancy/hold events. A generic call without the required execution context fails atomically, including earlier clinical or invoice changes in that same SQL transaction. Ordinary products retain their existing authorization and behavior when no controlled reservation applies.

Prepared packets hold no database locks while a staff member reviews them. Execute reacquires locks and revalidates current facts. Exclusive freeze/opening barriers are short state transitions, not transactions held open during physical counting.

The common early helper denies adoption of an owned pending or cancelled controlled UUID by an unrelated generic stock operation. A committed original receipt can still reach its existing actor/payload retry comparison; this is recovery, not permission for a new physical effect. Nested anesthesia-to-treatment entry requires the actual active outer context and matching C1a writer/root/actor admission; sharing a UUID alone is insufficient. New controlled prepare must reject pre-existing canonical identifiers, including legacy receipts and historical/non-stock clinical records that have no C1a movement-source row.

## Additional custody and correction boundaries

C1a covers the original eight stock/return/hold producers. Current source inspection also finds `record_native_pickup` and `append_native_dispense_correction`: pickup and pickup amendments can change handoff facts without an available-stock movement. C1b must instrument these two entry points before their existing locks and cover their immutable native source tables, preserving all ordinary signatures and receipts. The original eight hooks stay unchanged. A controlled correction subtype that is not complete must fail closed until C2; it cannot fall back to an ordinary unlogged call.

## Owned physical operation protocol

1. **Prepare:** validate bounded, versioned canonical arguments and controlled context; require the actual matched live Auth session and allowed current role; take the shared barrier before resource locks; reserve the root UUID permanently for this actor/writer/request. Freeze policy/unit/package versions, explicit physical observation time, exact expected source effects, container allocations and expected heads. A prepared review packet is not a second-person attestation.
2. **Execute:** take the shared barrier first, then serialize the owned action; revalidate live actor/session and current policy after waits. Recover an already committed receipt before current catalog/container freshness checks. Reject a cancellation, changed actor/writer/payload, unsupported state or stale uncommitted packet. Install one private active execution context, call the original canonical writer once, then finish controlled posting in the same transaction.
3. **Finish:** read the exact C1a source rows and canonical receipt, acquire sorted container locks after the canonical product/lot lock tail, validate frozen effects and heads, append event/lines/links, advance maintained projections and save the exact owned receipt. Anesthesia keeps one nested treatment, one debit and one charge. Clear the execution context before returning.
4. **Read:** bounded, owned original-UUID recovery under a current valid session. Lost acknowledgement/reload reads; it never generates or executes a replacement mutation.
5. **Cancel:** append a permanent tombstone if no commit exists. It cannot erase an event, overwrite another actor’s work or free the UUID for a different physical operation.

The execution context must match backend/server/transaction identity, operation UUID, writer, actor, session and an active execution nonce/phase. It is technical mutable state, not clinical history. Caller GUCs never authorize execution. Multiple commands in a PostgreSQL simple-query packet can share `statement_timestamp()`; clear completed contexts and enforce exact deferred source/event/action consistency rather than relying on timestamp separation. [PostgreSQL semantics](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

## Private data and source invariants

Only create relations used by the implemented C1b flows. Later review/count/report relations belong to C2 when their actual invariants and flows are implemented.

| Data family | Required invariant |
| --- | --- |
| Reviewed policy versions and current product state | Explicit canonical product/unit classification and reviewed configuration snapshot; separate from C0 draft metadata. Frozen/suspended/retired products never regain an ordinary unlogged route. Every lot is covered, including old lots and later legacy returns. |
| Registered-site/location/container identity | Controlling registrant/site is separate from physical clinic/mobile-kit location and custodian. Stable container identity binds the actual product/unit and initial provenance, with explicit per-lot cells for native allocations. Supplier package identity is not a physical vial identity; old lot free-text location is not rewritten. |
| Opening context and membership | Actual dated container allocation, explicit opening evidence and exact per-lot movement membership/head boundary. No timestamp/UUID cutover inference, invented old administrations or automatic backfill. Reviewed reconciliation is included in opening once. Actual opening workflow/acceptance remains C2/C3. |
| Immutable events and ordered lines | Original root/writer/source, policy/version, actual recorder/session snapshots, observed physical time separately from server recorded time, relevant clinical references and exact signed container effects. Do not infer a dose or concentration conversion from free text. |
| Movement/custody/discrepancy links | Every managed source maps to the exact event/action and every event line maps back to its actual canonical source. Each available-stock movement appears once; allocation sums match its exact signed quantity and unit. Separate prepared/return-held custody cells preserve drugs that are outside available stock. Pickup or a clinic-retained return must not debit inventory or count held units a second time. Custody-only/hold-only events are represented without inventing available-stock deltas. |
| Position/head/hold projections | Maintained in the event transaction and reconstructible from opening plus immutable sources. Raw balances are never editable. Controlled holds and native-return holds compose. Expected heads become stale on concurrent movement. |
| Prepared operations/actions/cancellations | Immutable owned arguments, context, original receipts and cancellation tombstones. No changed-payload retry, shared signer identity or automatic approval. |
| Execution contexts | Private technical lifecycle only; an earlier completed call in the same query packet cannot authorize a later managed write. |

All relations require RLS and revocation of raw PUBLIC/anonymous/authenticated/service-role access, fixed-path narrow helpers and restrictive identity FKs. Preserve recorder/session/name snapshots without requiring old Auth sessions to stay live forever. Protect immutable evidence from UPDATE/DELETE/TRUNCATE; allow only guarded advancement of maintained heads. The database owner’s privileged ability to replace code or disable triggers is outside application authorization and must not be confused with staff permissions.

## Canonical adapters must be exact

Native dispensing has a unique allocation per dispense/lot, and return lines refer to the immutable original native allocation. Use those actual stable identities when preparing container splits. Inspect the effective native helper/preview/receipt structures before finalizing source selectors. Some native allocation or movement UUIDs are minted at commit, so prepare cannot pretend those IDs already exist. Bind frozen container allocations to actual stable source allocation identities and exact lot/effect slots, then reconcile them to the saved receipt at finish. Reject ambiguity. Do not net opposite compensation movements away or infer an order from generated UUIDs.

Receiving identifies new actual physical containers after the canonical lot exists; it does not silently top up an existing vial. Native dispensing keeps its exact reviewed FEFO/per-lot allocations. Return v1/v2 compensation, retraction and discrepancy resolutions keep their original source heads and holds. Drugs already debited into custody are not debited a second time on disposal.

Routine client controlled-drug takeback remains unavailable regardless of generic medication-return policy. Any exceptional custody route needs its separately reviewed authority and SOP. Housecall residual-waste handling remains unresolved in Susan’s inactive draft. Do not turn these unknowns into active defaults.

Known managed inventory products do not identify arbitrary free-text or off-system medication names. Do not infer legal classification from a name or claim that inventory guards alone cover every possible clinical note. C2 must make controlled product/container selection explicit in the relevant workflows; C3 must verify the practice’s actual administration and exception paths before activation.

## Engineering proof and release order

- Prove managed receive/adjust/treatment/native dispense/anesthesia and every return/custody/discrepancy/pickup/correction subtype, ordinary compatibility, exact fractional splits and single debit/charge. Include all-ten early shared-barrier coverage and fresh Auth/session checks after observed waits.
- Prove direct generic managed calls fail, private sources cannot be manufactured, one-query-packet context borrowing fails after execute returns, missing/orphan/forged links roll back, opposite compensations retain both real movements, and changed/cancelled/same-UUID/lost-response paths are exact.
- Prove policy freeze drains admitted writers before changing state, pre-cutover lots remain covered, stale container heads fail and controlled/native holds cannot clear each other. No late global barrier or shared-to-exclusive upgrade.
- Inject failures after clinical, stock, controlled-line and action inserts; require atomic rollback. Restore populated policy/container/opening/event/action/source data and exact original receipts. Post-backup physical-history reconciliation remains a real C2/C3 requirement, not a claim inferred from restored hashes.
- Keep canonical SQL, genuine native Auth/browser/restore and parent scheduling/task/camera/C0 regressions. Deliberately advance migration guards only for the actual added migration; preserve old release receipts and generated Supabase types.
- Require exact-head CI, stage-first source/ACL/advisor comparison, rollback probes and owned-session cleanup before primary additive rollout. No provider call, secret change, legacy-backend write or real primary controlled activation is included.

No public commissioning API or active policy seed belongs in C1b. Positive engine fixtures are explicitly synthetic in owned disposable local runtimes; shared hosted checks must preserve existing data and must not create a real controlled opening. The register remains unavailable for clinical activation until C2 is complete and Susan’s real configuration/counts/SOP/current-authority acceptance is recorded in C3.
