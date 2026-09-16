/** Synthetic cross-language fixtures. Emits no credentials or practice records. */
import { replayNativeReturnQuantities, type OriginalReturnAllocation, type ReturnQuantityEvent } from "../../supabase/functions/_shared/native-return-quantity-replay.ts";

interface Vector { name: string; originals: OriginalReturnAllocation[]; events: ReturnQuantityEvent[] }
const uuid = (n: number) => `ab120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const allocation = (quantity: string, n = 1): OriginalReturnAllocation => ({ allocation_id: uuid(n), lot_id: uuid(n + 100), quantity });
const originals = [allocation("10.000"), allocation("5.000", 2)];
const vectors: Vector[] = [];
const fixed = (n: number) => `${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, "0")}`;
function add(name: string, events: ReturnQuantityEvent[], sources = originals): void {
  vectors.push({ name, originals: structuredClone(sources), events: structuredClone(events) });
}
function event(sequence: number, action: ReturnQuantityEvent["action"], quantity: string, intake: number | null, target: number | null = null, n = 1): ReturnQuantityEvent {
  return { id: uuid(1000 + sequence), sequence, action, intake_id: intake === null ? null : uuid(1000 + intake), correction_target_id: target === null ? null : uuid(1000 + target), allocations: [allocation(quantity, n)] };
}
add("empty", []);
const history = [
  event(1, "intake", "4.000", null), event(2, "intake", "5.000", null),
  event(3, "dispose", "3.000", 1), event(4, "restock", "4.000", 2),
  event(5, "retract_disposal", "2.000", 1, 3), event(6, "retract_restock", "3.000", 2, 4),
  event(7, "restock", "2.000", 1), event(8, "dispose", "3.000", 2),
  event(9, "retract_restock", "2.000", 1, 7), event(10, "retract_disposal", "3.000", 2, 8),
  event(11, "retract_intake", "2.000", 1, 1), event(12, "retract_intake", "3.000", 2, 2),
  event(13, "intake", "6.000", null), event(14, "dispose", "6.000", 13), event(15, "retract_disposal", "6.000", 13, 14),
];
for (let n = 1; n <= history.length; n++) add(`mixed-prefix-${n}`, history.slice(0, n));
const many: ReturnQuantityEvent[] = [];
for (let n = 1; n <= 30; n++) {
  const start = many.length + 1, quantity = fixed(n * 23), lot = n % 2 + 1;
  many.push(event(start, "intake", quantity, null, null, lot));
  many.push(event(start + 1, "restock", quantity, start, null, lot));
  many.push(event(start + 2, "retract_restock", quantity, start, start + 1, lot));
  many.push(event(start + 3, "retract_intake", quantity, start, start, lot));
  add(`cycle-${n}`, many);
}
const full = event(1, "intake", "10.000", null); full.allocations.push(allocation("5.000", 2));
add("multiple-lot-full", [full, event(2, "dispose", "3.000", 1, null, 2), event(3, "retract_disposal", "0.001", 1, 2, 2)]);
add("maximum", [event(1, "intake", "99999999999.999", null), event(2, "retract_intake", "99999999999.999", 1, 1), event(3, "intake", "99999999999.999", null)], [allocation("99999999999.999")]);
for (const quantity of ["0.000", "-0.001", "1e0", "1", "1.00", "01.000", "+1.000", "1.0000", "100000000000.000", "10.001"]) add(`invalid-quantity-${quantity}`, [event(1, "intake", quantity, null)]);
add("over-disposition", [event(1, "intake", "1.000", null), event(2, "dispose", "1.001", 1)]);
add("cross-intake-disposition", [event(1, "intake", "1.000", null), event(2, "intake", "8.000", null), event(3, "dispose", "2.000", 1)]);
add("cross-intake-correction", [event(1, "intake", "1.000", null), event(2, "intake", "8.000", null), event(3, "retract_intake", "1.000", 2, 1)]);
add("retract-disposed-intake", [event(1, "intake", "1.000", null), event(2, "dispose", "1.000", 1), event(3, "retract_intake", "1.000", 1, 1)]);
add("over-source-correction", [event(1, "intake", "4.000", null), event(2, "restock", "1.000", 1), event(3, "restock", "3.000", 1), event(4, "retract_restock", "2.000", 1, 2)]);
add("retract-correction", [event(1, "intake", "4.000", null), event(2, "retract_intake", "1.000", 1, 1), event(3, "retract_intake", "1.000", 1, 2)]);
add("future-source", [event(1, "retract_intake", "1.000", 2, 2), event(2, "intake", "1.000", null)]);
const mutations: Record<string, (e: ReturnQuantityEvent) => void> = {
  uppercase: e => { e.id = e.id.toUpperCase(); },
  sequence: e => { e.sequence = 2; },
  "string-sequence": e => { Object.assign(e, { sequence: "1" }); },
  "wrong-lot": e => { e.allocations[0].lot_id = uuid(999); },
  "unknown-allocation": e => { e.allocations[0].allocation_id = uuid(999); },
  "extra-field": e => { Object.assign(e, { stock_authorized: true }); },
  "duplicate-allocation": e => { e.allocations.push(e.allocations[0]); },
  "unsorted-allocation": e => { e.allocations.unshift(allocation("1.000", 2)); },
  "ordinary-target": e => { e.correction_target_id = uuid(1001); },
  "intake-root": e => { e.intake_id = uuid(1001); },
};
for (const [name, mutate] of Object.entries(mutations)) { const e = event(1, "intake", "1.000", null); mutate(e); add(name, [e]); }
add("empty-originals", [], []);
add("unsorted-originals", [], [...originals].reverse());
add("duplicate-originals", [], [originals[0], originals[0]]);
console.log(JSON.stringify(vectors.map(vector => {
  try { return { ...vector, expected: { accepted: true, result: replayNativeReturnQuantities(vector.originals, vector.events) } }; }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "Invalid native return quantity history.") throw error;
    return { ...vector, expected: { accepted: false, result: null } };
  }
})));
