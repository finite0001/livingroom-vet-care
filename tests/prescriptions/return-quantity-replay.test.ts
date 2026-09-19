import test from "node:test";
import assert from "node:assert/strict";
import { replayNativeReturnQuantities as replay, type OriginalReturnAllocation, type ReturnQuantityEvent } from "../../supabase/functions/_shared/native-return-quantity-replay.ts";
const id = (n: number) => `a9130000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const allocation = (quantity: string, n = 1): OriginalReturnAllocation => ({ allocation_id: id(n), lot_id: id(n + 100), quantity });
const originals = [allocation("10.000"), allocation("5.000", 2)];
function event(sequence: number, action: ReturnQuantityEvent["action"], quantity = "2.000", intake: number | null = action === "intake" ? null : 1, target: number | null = null, n = 1): ReturnQuantityEvent {
  return { id: id(1000 + sequence), sequence, action, intake_id: intake === null ? null : id(1000 + intake), correction_target_id: target === null ? null : id(1000 + target), allocations: [allocation(quantity, n)] };
}
const quantities = (events: ReturnQuantityEvent[]) => replay(originals, events).allocations[0];
test("ordinary chronological accounting and immutable inputs", () => {
  const events = [event(1, "intake", "8.000"), event(2, "dispose", "3.000"), event(3, "restock", "2.000")];
  const before = structuredClone({ originals, events });
  assert.deepEqual(quantities(events), { allocation_id: id(1), lot_id: id(101), dispensed_quantity: "10.000", returned_quantity: "8.000", remaining_returnable_quantity: "2.000", held_quantity: "3.000", disposed_quantity: "3.000", restocked_quantity: "2.000" });
  assert.deepEqual({ originals, events }, before);
});
test("partial repeated corrections preserve gross history and permit a fresh disposition", () => {
  const events = [event(1, "intake", "8.000"), event(2, "dispose", "3.000"), event(3, "retract_disposal", "1.000", 1, 2), event(4, "retract_disposal", "2.000", 1, 2), event(5, "restock", "3.000"), event(6, "retract_restock", "1.500", 1, 5), event(7, "dispose", "1.500")];
  const result = replay(originals, events);
  assert.equal(result.allocations[0].held_quantity, "5.000");
  assert.equal(result.allocations[0].disposed_quantity, "1.500");
  assert.equal(result.allocations[0].restocked_quantity, "1.500");
  assert.equal(result.correction_remaining[1].allocations[0].quantity, "0.000");
  assert.equal(result.historical[0].gross_disposed_quantity, "4.500");
  assert.equal(result.historical[0].retracted_disposed_quantity, "3.000");
});
test("full intake retraction frees returnable quantity and retains zero intake", () => {
  const events = [event(1, "intake", "10.000"), event(2, "retract_intake", "10.000", 1, 1), event(3, "intake", "10.000")];
  const result = replay(originals, events);
  assert.equal(result.allocations[0].returned_quantity, "10.000");
  assert.equal(result.intakes[0].allocations[0].quantity, "0.000");
  assert.equal(result.intakes[0].allocations[0].held_quantity, "0.000");
  assert.equal(result.historical[0].gross_intake_quantity, "20.000");
  assert.equal(result.historical[0].retracted_intake_quantity, "10.000");
});
test("disposition must be retracted before disposed intake quantity can be retracted", () => {
  const start = [event(1, "intake"), event(2, "dispose")];
  assert.throws(() => replay(originals, [...start, event(3, "retract_intake", "2.000", 1, 1)]));
  const fixed = [...start, event(3, "retract_disposal", "2.000", 1, 2), event(4, "retract_intake", "2.000", 1, 1)];
  assert.equal(quantities(fixed).returned_quantity, "0.000");
});
test("later retraction cannot retroactively repair an earlier overdisposition", () => {
  assert.throws(() => replay(originals, [event(1, "intake"), event(2, "dispose", "3.000"), event(3, "retract_disposal", "1.000", 1, 2)]));
});
test("multiple lots and exact allocation identity remain separate", () => {
  const intake = event(1, "intake"); intake.allocations.push(allocation("4.000", 2));
  const events = [intake, event(2, "dispose", "3.000", 1, null, 2), event(3, "retract_disposal", "1.000", 1, 2, 2)];
  const result = replay(originals, events);
  assert.equal(result.allocations[0].held_quantity, "2.000");
  assert.equal(result.allocations[1].held_quantity, "2.000");
  assert.equal(result.allocations[1].disposed_quantity, "2.000");
  const sharedLot = [allocation("2.000"), { ...allocation("2.000", 2), lot_id: id(101) }];
  const wrong = event(2, "dispose", "1.000", 1, null, 2); wrong.allocations[0].lot_id = id(101);
  assert.throws(() => replay(sharedLot, [event(1, "intake"), wrong]));
});
const badHistories: Record<string, ReturnQuantityEvent[]> = {
  "over intake": [event(1, "intake", "10.001")],
  "over disposal": [event(1, "intake"), event(2, "dispose", "2.001")],
  "over restock": [event(1, "intake"), event(2, "restock", "2.001")],
  "over intake retraction": [event(1, "intake"), event(2, "retract_intake", "2.001", 1, 1)],
  "repeated over retraction": [event(1, "intake"), event(2, "dispose"), event(3, "retract_disposal", "1.000", 1, 2), event(4, "retract_disposal", "1.001", 1, 2)],
  "wrong action target": [event(1, "intake"), event(2, "dispose"), event(3, "retract_restock", "1.000", 1, 2)],
  "retract a retraction": [event(1, "intake"), event(2, "retract_intake", "1.000", 1, 1), event(3, "retract_intake", "1.000", 1, 2)],
  "future target": [event(1, "retract_intake", "1.000", 2, 2), event(2, "intake")],
  "cross intake": [event(1, "intake"), event(2, "intake"), event(3, "dispose", "1.000", 1), event(4, "retract_disposal", "1.000", 2, 3)],
  "missing intake": [event(1, "dispose")],
  "ordinary correction target": [event(1, "intake", "1.000", null, 1)],
  "intake root on intake": [event(1, "intake", "1.000", 1)],
  "null correction root": [event(1, "intake"), event(2, "retract_intake", "1.000", null, 1)],
};
for (const [name, events] of Object.entries(badHistories)) test(`rejects ${name}`, () => assert.throws(() => replay(originals, events)));
test("retraction cannot consume another event's disposition balance", () => {
  assert.throws(() => replay(originals, [event(1, "intake", "8.000"), event(2, "dispose", "1.000"), event(3, "dispose", "4.000"), event(4, "retract_disposal", "2.000", 1, 2)]));
});
test("fixed3 precision and maximum numeric14,3", () => {
  const source = [allocation("99999999999.999")];
  const result = replay(source, [event(1, "intake", "99999999999.999"), event(2, "dispose", "0.001"), event(3, "retract_disposal", "0.001", 1, 2)]);
  assert.equal(result.allocations[0].held_quantity, "99999999999.999");
  for (const quantity of ["100000000000.000", "1", "1.00", "01.000", "1e0", "-1.000", "0.000", "1.0000", " 1.000", "+1.000"]) assert.throws(() => replay(originals, [event(1, "intake", quantity)]), quantity);
});
test("strict canonical identities, sorting, sequence and shapes", () => {
  const changes: Array<(e: ReturnQuantityEvent[]) => void> = [
    e => { e[0].id = e[0].id.toUpperCase(); }, e => { e[0].sequence = 0; }, e => { e[0].sequence = 1.5; },
    e => { e.push({ ...e[0], sequence: 2 }); }, e => { e[0].allocations = []; },
    e => { e[0].allocations.push(e[0].allocations[0]); }, e => { e[0].allocations.unshift(allocation("1.000", 2)); },
    e => { e[0].allocations[0].lot_id = id(102); }, e => { e[0].allocations[0].allocation_id = id(3); },
    e => { Object.assign(e[0], { extra: true }); }, e => { Object.assign(e[0].allocations[0], { extra: true }); },
  ];
  for (const change of changes) { const e = [event(1, "intake")]; change(e); assert.throws(() => replay(originals, e)); }
  assert.throws(() => replay([], []));
  assert.throws(() => replay([...originals].reverse(), []));
  assert.throws(() => replay([originals[0], originals[0]], []));
  assert.throws(() => replay(Array.from({ length: 101 }, (_, n) => allocation("1.000", n + 1)), []));
});
test("empty history preserves all original quantities", () => {
  const result = replay(originals, []); assert.equal(result.allocations[0].remaining_returnable_quantity, "10.000");
  assert.deepEqual(result.intakes, []); assert.deepEqual(result.correction_remaining, []);
});
test("generated chronological cycles conserve quantities beyond disclosure's 100-event limit", () => {
  const events: ReturnQuantityEvent[] = [];
  const append = (action: ReturnQuantityEvent["action"], quantity: string, intake: number | null, target: number | null = null) => { const n = events.length + 1; events.push(event(n, action, quantity, intake, target)); return n; };
  for (let cycle = 1; cycle <= 40; cycle++) {
    const quantity = `0.${(cycle * 17).toString().padStart(3, "0")}`;
    const intake = append("intake", quantity, null), disposal = append("dispose", quantity, intake);
    append("retract_disposal", quantity, intake, disposal); append("retract_intake", quantity, intake, intake);
    const result = replay(originals, events);
    assert.equal(result.allocations[0].returned_quantity, "0.000");
    assert.equal(result.allocations[0].remaining_returnable_quantity, "10.000");
    const h = result.historical[0]; assert.equal(h.gross_intake_quantity, h.retracted_intake_quantity); assert.equal(h.gross_disposed_quantity, h.retracted_disposed_quantity);
  }
  assert.equal(events.length, 160);
});
test("every prefix conserves per-intake and per-allocation balances through repeated fresh actions", () => {
  const events = [
    event(1, "intake", "4.000"), event(2, "intake", "5.000"),
    event(3, "dispose", "3.000", 1), event(4, "restock", "4.000", 2),
    event(5, "retract_disposal", "2.000", 1, 3), event(6, "retract_restock", "3.000", 2, 4),
    event(7, "restock", "2.000", 1), event(8, "dispose", "3.000", 2),
    event(9, "retract_restock", "2.000", 1, 7), event(10, "retract_disposal", "3.000", 2, 8),
    event(11, "retract_intake", "2.000", 1, 1), event(12, "retract_intake", "3.000", 2, 2),
    event(13, "intake", "6.000"), event(14, "dispose", "6.000", 13), event(15, "retract_disposal", "6.000", 13, 14),
  ];
  const units = (quantity: string) => BigInt(quantity.replace(".", ""));
  for (let count = 0; count <= events.length; count++) {
    const result = replay(originals, events.slice(0, count));
    for (const balance of result.allocations) {
      assert.equal(units(balance.returned_quantity) + units(balance.remaining_returnable_quantity), units(balance.dispensed_quantity));
      assert.equal(units(balance.returned_quantity), units(balance.held_quantity) + units(balance.disposed_quantity) + units(balance.restocked_quantity));
      const intakes = result.intakes.flatMap(intake => intake.allocations.filter(a => a.allocation_id === balance.allocation_id));
      for (const a of intakes) assert.equal(units(a.quantity), units(a.held_quantity) + units(a.disposed_quantity) + units(a.restocked_quantity));
      assert.equal(intakes.reduce((sum, a) => sum + units(a.quantity), 0n), units(balance.returned_quantity));
    }
    for (const remaining of result.correction_remaining) {
      const source = events.find(event => event.id === remaining.event_id)!;
      for (const allocation of remaining.allocations) {
        assert.ok(units(allocation.quantity) >= 0n);
        assert.ok(units(allocation.quantity) <= units(source.allocations.find(a => a.allocation_id === allocation.allocation_id)!.quantity));
      }
    }
  }
});
test("cannot dispose another intake's held units or retract another intake's event", () => {
  const events = [event(1, "intake", "1.000"), event(2, "intake", "8.000")];
  assert.throws(() => replay(originals, [...events, event(3, "dispose", "2.000", 1)]));
  assert.throws(() => replay(originals, [...events, event(3, "retract_intake", "1.000", 2, 1)]));
});
