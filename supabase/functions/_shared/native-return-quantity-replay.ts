/** Pure quantity replay. Does not establish authorization, stock compensation, hashes, or clinical facts. */
export interface OriginalReturnAllocation { allocation_id: string; lot_id: string; quantity: string }
export interface ReturnQuantityEvent {
  id: string; sequence: number;
  action: "intake" | "dispose" | "restock" | "retract_intake" | "retract_disposal" | "retract_restock";
  intake_id: string | null; correction_target_id: string | null;
  allocations: OriginalReturnAllocation[];
}
export interface ReplayedReturnAllocation {
  allocation_id: string; lot_id: string; dispensed_quantity: string; returned_quantity: string;
  remaining_returnable_quantity: string; held_quantity: string; disposed_quantity: string; restocked_quantity: string;
}
export interface ReplayedReturnIntake {
  id: string;
  allocations: Array<{ allocation_id: string; lot_id: string; quantity: string; held_quantity: string; disposed_quantity: string; restocked_quantity: string }>;
}
export interface ReturnQuantityReplay {
  allocations: ReplayedReturnAllocation[];
  intakes: ReplayedReturnIntake[];
  correction_remaining: Array<{ event_id: string; allocations: Array<{ allocation_id: string; quantity: string }> }>;
  /** Historical counters may exceed numeric(14,3) through repeated corrections; emitted as exact fixed3 strings. */
  historical: Array<{ allocation_id: string; lot_id: string; gross_intake_quantity: string; gross_disposed_quantity: string; gross_restocked_quantity: string; retracted_intake_quantity: string; retracted_disposed_quantity: string; retracted_restocked_quantity: string }>;
}
interface Balance { received: bigint; held: bigint; disposed: bigint; restocked: bigint }
interface History { intake: bigint; disposed: bigint; restocked: bigint; retractIntake: bigint; retractDisposed: bigint; retractRestocked: bigint }
interface Ordinary { event: ReturnQuantityEvent; remaining: Map<string, bigint> }
const invalid = (): never => { throw new Error("Invalid native return quantity history."); };
function require(value: unknown): asserts value { if (!value) invalid(); }
const uuid = (value: unknown): boolean => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function shape(value: unknown, names: string): void {
  require(value !== null && typeof value === "object" && !Array.isArray(value));
  const expected = names.split(" ");
  require(Object.keys(value).length === expected.length && expected.every(name => Object.prototype.hasOwnProperty.call(value, name)));
}
function units(value: unknown): bigint {
  require(typeof value === "string" && /^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/.test(value));
  return BigInt(value.replace(".", ""));
}
const fixed = (value: bigint): string => `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`;
const zero = (): Balance => ({ received: 0n, held: 0n, disposed: 0n, restocked: 0n });
function validateAllocations(allocations: OriginalReturnAllocation[]): void {
  require(Array.isArray(allocations) && allocations.length >= 1 && allocations.length <= 100);
  let previous = "";
  for (const allocation of allocations) {
    shape(allocation, "allocation_id lot_id quantity");
    require(uuid(allocation.allocation_id) && uuid(allocation.lot_id) && allocation.allocation_id > previous && units(allocation.quantity) > 0n);
    previous = allocation.allocation_id;
  }
}
/** Complete, sequential history only; disclosure and transport bounds belong to callers. Does not mutate inputs. */
export function replayNativeReturnQuantities(originals: OriginalReturnAllocation[], events: ReturnQuantityEvent[]): ReturnQuantityReplay {
  validateAllocations(originals);
  require(Array.isArray(events) && events.length <= 2147483647);
  const sources = new Map(originals.map(source => [source.allocation_id, source]));
  const totals = new Map(originals.map(source => [source.allocation_id, zero()]));
  const historical = new Map<string, History>(originals.map(source => [source.allocation_id, { intake: 0n, disposed: 0n, restocked: 0n, retractIntake: 0n, retractDisposed: 0n, retractRestocked: 0n }]));
  const intakes = new Map<string, Map<string, Balance>>();
  const ordinary = new Map<string, Ordinary>();
  const ids = new Set<string>();
  for (const event of events) {
    shape(event, "id sequence action intake_id correction_target_id allocations");
    require(uuid(event.id) && !ids.has(event.id) && event.sequence === ids.size + 1);
    require(["intake", "dispose", "restock", "retract_intake", "retract_disposal", "retract_restock"].includes(event.action));
    validateAllocations(event.allocations);
    const retract = event.action.startsWith("retract_");
    let target: Ordinary | undefined;
    let root: string;
    if (retract) {
      require(uuid(event.correction_target_id) && uuid(event.intake_id));
      target = ordinary.get(event.correction_target_id!);
      const expected = event.action === "retract_intake" ? "intake" : event.action === "retract_disposal" ? "dispose" : "restock";
      require(target && target.event.action === expected);
      root = target.event.action === "intake" ? target.event.id : target.event.intake_id!;
      require(event.intake_id === root);
    } else {
      require(event.correction_target_id === null);
      if (event.action === "intake") {
        require(event.intake_id === null);
        root = event.id;
        intakes.set(root, new Map());
      } else { require(uuid(event.intake_id)); root = event.intake_id!; }
    }
    const intake = intakes.get(root);
    require(intake);
    for (const allocation of event.allocations) {
      const source = sources.get(allocation.allocation_id);
      require(source && source.lot_id === allocation.lot_id);
      const n = units(allocation.quantity), total = totals.get(allocation.allocation_id)!, history = historical.get(allocation.allocation_id)!;
      if (event.action === "intake") intake.set(allocation.allocation_id, zero());
      const current = intake.get(allocation.allocation_id);
      require(current);
      if (target) {
        const remaining = target.remaining.get(allocation.allocation_id);
        require(remaining !== undefined && remaining >= n);
        target.remaining.set(allocation.allocation_id, remaining - n);
      }
      if (event.action === "intake") {
        require(total.received + n <= units(source.quantity));
        for (const balance of [total, current]) { balance.received += n; balance.held += n; }
        history.intake += n;
      } else if (event.action === "dispose" || event.action === "restock") {
        require(current.held >= n);
        for (const balance of [total, current]) { balance.held -= n; if (event.action === "dispose") balance.disposed += n; else balance.restocked += n; }
        if (event.action === "dispose") history.disposed += n; else history.restocked += n;
      } else if (event.action === "retract_intake") {
        require(current.held >= n);
        for (const balance of [total, current]) { balance.received -= n; balance.held -= n; }
        history.retractIntake += n;
      } else {
        const key = event.action === "retract_disposal" ? "disposed" : "restocked";
        require(current[key] >= n);
        for (const balance of [total, current]) { balance[key] -= n; balance.held += n; }
        if (key === "disposed") history.retractDisposed += n; else history.retractRestocked += n;
      }
    }
    if (!retract) ordinary.set(event.id, { event, remaining: new Map(event.allocations.map(allocation => [allocation.allocation_id, units(allocation.quantity)])) });
    ids.add(event.id);
  }
  return {
    allocations: originals.map(source => {
      const balance = totals.get(source.allocation_id)!;
      return { allocation_id: source.allocation_id, lot_id: source.lot_id, dispensed_quantity: source.quantity, returned_quantity: fixed(balance.received), remaining_returnable_quantity: fixed(units(source.quantity) - balance.received), held_quantity: fixed(balance.held), disposed_quantity: fixed(balance.disposed), restocked_quantity: fixed(balance.restocked) };
    }),
    intakes: [...intakes].map(([id, allocations]) => ({ id, allocations: [...allocations].map(([allocation_id, balance]) => ({ allocation_id, lot_id: sources.get(allocation_id)!.lot_id, quantity: fixed(balance.received), held_quantity: fixed(balance.held), disposed_quantity: fixed(balance.disposed), restocked_quantity: fixed(balance.restocked) })) })),
    correction_remaining: [...ordinary].map(([event_id, item]) => ({ event_id, allocations: [...item.remaining].map(([allocation_id, quantity]) => ({ allocation_id, quantity: fixed(quantity) })) })),
    historical: originals.map(source => {
      const history = historical.get(source.allocation_id)!;
      return { allocation_id: source.allocation_id, lot_id: source.lot_id, gross_intake_quantity: fixed(history.intake), gross_disposed_quantity: fixed(history.disposed), gross_restocked_quantity: fixed(history.restocked), retracted_intake_quantity: fixed(history.retractIntake), retracted_disposed_quantity: fixed(history.retractDisposed), retracted_restocked_quantity: fixed(history.retractRestocked) };
    }),
  };
}
