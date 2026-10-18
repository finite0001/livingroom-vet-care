# Isolated controlled-stock execution candidate

This is executable **local development code**, outside `supabase/migrations` and the application runtime. It implements the proposed C1b prepare/execute/read/cancel protocol and physical source/container posting so its invariants can be exercised before a production migration is prepared. It does not complete C1b release acceptance, C2 workflows or C3 commissioning. Susan’s rules remain draft and inactive.

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-local.py --run-synthetic-local --include-sql-regression
```

Docker, Supabase CLI and free local ports 64620/64621/64622/64624 are required. The runner requires the exact 204-migration baseline, copies canonical migrations into a uniquely named owned project, verifies Docker project/workdir labels, and preserves all ten canonical writer definitions. It never reads a hosted project link or local `.env`. Automatic jobs are paused and drained only in this owned server using [pg_cron’s documented `cron.launch_active_jobs` setting](https://github.com/citusdata/pg_cron#extension-settings); schedule rows stay intact and every selected relation remains fingerprinted. Before installation, it checks the byte-pinned `trusted-prior-189.json` retained from the original canonical 189-migration replay. The first 189 current migration sources must match the original source digest, and the scoped catalog after all 204 migrations must still equal that independent reference. It never recaptures the current candidate as its expected prior. An exclusive practice barrier precedes the installation’s comparison. The prior snapshot pins 116 functions/30 relations and effective grants, RLS, columns, constraints, triggers and indexes. The untouched replay is compared first, so a CLI/Postgres bootstrap difference fails closed before drift injection and is reported as metadata paths rather than rollback damage. The passing October 18 proof uses Supabase CLI 2.118.0 and exactly matches the retained reference; CLI 2.115.0/Postgres 17.6.1.159 produces different explicit ACLs on three PUBLIC-executable helpers and is not silently accepted. Specifically, it omits explicit `anon`/`authenticated`/`service_role` EXECUTE entries on `has_role(uuid,user_role)` and `protect_profile_privileges()`, and the explicit `anon` entry on `is_active_staff(uuid)`; each still has PUBLIC EXECUTE. CI is aligned to the independently proved CLI 2.118.0 environment. No missing grants are added and no raw ACL differences are normalized away. Four deliberate definition/grant/RLS/trigger changes must each fail before engine DDL and roll back exactly. Never regenerate the reference from hosted drift. It installs the candidate only in this disposable stack, then removes its containers, volumes and private working files on completion or failure. Protected logs and sanitized source-bound results remain in the printed temporary evidence directory. `--include-sql-regression` runs the current 166 canonical SQL suites/7,338 assertions with the candidate installed.

The 21 private relation families have RLS and raw PUBLIC/anon/authenticated/service-role access revoked. Helpers and the four new entry points are initially revoked too. The genuine Auth probe temporarily grants only the four owned entry points to `authenticated` in this owned local runtime. No site/policy/opening/activation RPC is granted. Explicit synthetic sites, product classifications, permissions, units and opening counts are test inputs; neither these fixtures nor their `witness: none` permissions are practice rules.

The protocol reserves each operation UUID, freezes original canonical arguments separately from controlled context, serializes root/product/container work, and rechecks live staff/session authority after waits. It invokes the existing canonical writer once, reconciles every actual movement/native allocation, writes immutable events/lines/custody transitions, advances guarded positions/heads, saves the exact receipt, and clears executing authority before return. Receiving, available stock, prepared medication and return-held medication stay distinct. Return corrections retain actual opposite movements and original cell identities; pickup amendments do not replenish physical stock. Stored provenance can be validated without the original recorder’s live session. Saved receipts retain their original transitions after later head/catalog changes.

| Probe | Evidence |
| --- | --- |
| `probe-smoke.py` / `smoke.sql` | Fractional receive/adjust, stale reviews, changed payloads, permanent cancellation, foreign owner, shared/exclusive upgrade rejection, same-packet generic/raw context borrowing, exact recovery; all source relation fingerprints unchanged after rollback |
| `probe-native.py` / native fixtures | 24 managed actions across nine producers; receiving is tested separately. All six return actions, three correction kinds and four discrepancy actions; independent available/prepared/held and billing totals; one anesthesia treatment/debit/charge |
| `probe-opening.py` / `opening-boundary-acceptance.sql` / `opening-history.sql` | Separately counted populated opening-custody boundary acceptance; original native prefixes, exact cell reconciliation, refusal rollback fingerprints and marked clone/restore cleanup. Synthetic engineering evidence, not commissioning or genuine Auth/API coverage |
| `run-native-history.py` / `native-history-*.sql` | Genuine canonical 187/188 record creation followed by unchanged upgrades to 204; seven separately classified native entry projections, original-column preservation and unchanged final state after every observation |
| `fault-probes.sql` | Failures after inventory, billing, controlled-line and action inserts; every relation fingerprint must match the pre-execution state after rollback |
| `integrity-probes.sql` | Missing/forged lines, foreign source, changed opening, skipped head, broken custody predecessor, rolled-back state head, changed unit, forged event hash/frame and forged new-container identity must fail independent validation |
| Populated managed restore | Eight owned-API rejections under repeatable-read/serializable isolation; four stale-context/recovery checks prove an old server/transaction row is not authority and a new owned action replaces/clears it once. Exact schema/data restore of all selected public/Auth/Storage/extensions relations, manifest equality, source/event/product validation without caller claims; both marked clone databases removed and original runtime unchanged |
| `probe-api.py` | Genuine Auth/PostgREST, raw/helper denials, DB roles overriding misleading Auth metadata, ownership/recovery/cancellation, actual root/product/final-container queues, authority revocation after observed blocking, atomic rollback and concurrent same-UUID exact single commit; an exclusive freeze drains an admitted managed writer, queues the next writer before native resources, and suspension preserves saved recovery while denying an ordinary fallback |

The initial trusted prior reference is checked before any persistent engine object is created; it is not recaptured during normal runs. Local post-install technical-manifest construction and temporary resealing support development fixtures and fault injection only. **Do not reuse those operations to accept hosted drift.** The isolated installer now implements the trusted prior comparison and atomic drift rejection. The dated October 15 receipt reports matching scoped metadata on both hosted backends then; the historical 203 forward-port and the current 204 compatibility run perform no hosted comparison. A production migration must reuse reviewed preconditions and still complete opening/old-source/hold/exception coverage, independent review, exact-head CI, and stage-first installation/rollback/advisor comparison before primary rollout. The new freeze/isolation/stale-context proofs do not commission a physical register. Clinical activation additionally requires the C2 workflows and Susan’s actual product/site/unit/count/SOP/current-authority acceptance in C3.

The restore proves recorded database history, not actual physical history after a backup or Storage binary disaster recovery. No live provider, payment, email, payroll or clinical activation is tested or authorized here.

The separate [migration-204 compatibility receipt](../../../../docs/launch-evidence/2026-10-18-controlled-candidate-204-compatibility.md) preserves the current 166-suite/7,338-assertion proof without relabeling the historical 203 evidence. Its raw `api_checks: 133` counts combined Auth/PostgREST response and SQL setup/state/cleanup assertions, not HTTP-only checks or requests.

## Opening custody contract

`opening.sql` defines the private projector
`controlled_stock_opening_native_entry(opening_id, dispense_id, return_version,
correction_version, discrepancy_version, pickup_id)` and the independent
`controlled_stock_validate_opening(opening_id)` validator. These are candidate
helpers, with the same default revocations and manifest coverage as the other
private engine routines.

The private construction helper
`controlled_stock_opening_native_entry_for_product(product_id, stock_unit,
dispense_id, return_version, correction_version, discrepancy_version, pickup_id)`
produces the same verified native entry before the immutable opening row exists.
The opening-aware wrapper and validator then bind it to the actual opening's
product, policy unit and exact source membership. This avoids updating an opening
or bypassing its immutable trigger merely to assemble a fixture.

Each `native_custody_boundary` entry has exactly `version: 1`, `dispense_id`,
`dispense_document_hash`, `dispense_operation_hash`, `return_head`, `correction_head`, `discrepancy_head`,
`pickup`, and `allocations`. Heads are `{event_id, version, record_hash}`; the empty
prefix is `{event_id: null, version: 0, record_hash: null}`. Pickup is null or
`{id, document_hash, operation_hash}`. Operation hashes cover the existing
`native_fulfillment_receipt` canonical JSON, including the original request,
result and operation timestamp, using UTC. They retain opening-time receipt
content; they are not signatures, raw network-byte hashes, or proof of truth
before the opening was constructed. Allocations sort by original allocation ID and contain
`allocation_id`, `lot_id`, `dispensed_quantity`, `prepared_quantity`, and `held`.
Held entries sort by original intake ID and contain `intake_id` and `quantity`,
including zero quantities needed to retain source membership. Quantity strings
use the existing native three-decimal formatter. A supplied entry must equal its
verified canonical projection, including keys, identities, heads and quantities.

The retained prefix belongs to the opening; later managed activity does not
replace it with today's replay. Source membership, rather than time or UUID
ordering, distinguishes opening evidence from later controlled event links.
Opening available/prepared/held quantities are checked independently; already
dispensed stock is not counted twice. The product validator checks an existing
opening even before the state head attaches it. Unsupported custody/discrepancy
routes remain unavailable. The proof reports its actual assertion counts and
limitations separately from the historical compatibility receipts.

Native dispense and pickup opening evidence also requires the existing C1a stock
provenance and its original immutable operation receipt. Older dispenses missing
movement provenance and older pickups missing pickup provenance are unsupported;
a synthetic missing-provenance mutation alone is not a historical-upgrade proof.
Retained canonical annotation heads have a different guard from managed source
admission: projecting an older annotation does not prove it can be posted as a new
managed action. Available-only old movements retain their exact opening snapshots.
Any supported exception route remains separate work.

The separate populated upgrade rehearsal uses the reviewed CLI 2.118.0:

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-native-history.py --run-synthetic-local
```

It seeds through actual canonical APIs before provenance migrations exist, exports
fixture IDs privately, and applies every remaining migration unchanged. Original
native/inventory/billing/client/actor columns are fingerprinted across the upgrade;
all public/Auth/Storage/extensions rows are fingerprinted after installation and
after each projector observation. It never backfills provenance or creates a
controlled site, policy, opening, position or event. Its installer shares the exact
pinned assembly used by the ordinary empty-Auth runner, whose precondition remains
unchanged. This seven-case matrix does not test generic available-only stock
opening construction, a production backup restore or historical clinic datasets.

The [dated native-upgrade receipt](../../../../docs/launch-evidence/2026-10-18-native-history-upgrade.md)
records the seven outcomes, preservation boundaries and ordinary compatibility
checks without treating entry projection as register commissioning.

Candidate capacity is explicit: at most 200 product dispenses/boundary entries,
100 allocations per dispense, 1,000 events per dispense per native history family (including
later managed history), and a 1 MiB boundary. Exceeding these limits refuses; it
never truncates evidence. This bounded development capacity needs review before
production engine assembly and commissioning.

Opening validation checks the retained boundary and exact later-source partition.
The existing deferred guards validate each new/root managed event, and the restore
probe separately audits every historical managed event. The opening helper does
not repeat that complete event audit for every deferred product check.

Only three independently reconstructed result fields compare as finite typed
instants: slot `opened_at`, slot `closed_at`, and the verified linked-refill event's
`created_at`. Their keys must exist, their strings require explicit offsets, and
null is allowed only where reconstructed state requires it. Every other result
field, including nested refill snapshots, remains exact. The original stored JSON
is never repaired or normalized; the retained operation-receipt hash still binds
its exact opening-time content, including timestamp spelling.

The opening-history fixture uses real canonical writers under UTC,
America/Denver and Asia/Kathmandu and validates from other caller timezones and
after populated restore. It separately tests genuine same-unit foreign-product
identities and historical-result mutations. Per-zone repeated baseline counts and
new distinct case families are reported separately; execution evidence is recorded
in the dated history-compatibility receipt. These cases do not establish genuine
pre-C1a native upgrade support, a general legacy repair route or commissioning.

The [dated history-compatibility receipt](../../../../docs/launch-evidence/2026-10-18-controlled-opening-history.md)
records the three-zone full run: 27 baseline refusal/14 positive families plus 33 new
refusal/seven positive families, separately counted from repeated executions.
All 399 bound source hashes matched; no canonical/hosted engine installation or
clinical/register activation occurred.
