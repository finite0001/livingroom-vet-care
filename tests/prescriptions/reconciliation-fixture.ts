import type { NativePrescriptionPrintV3 } from "../../supabase/functions/_shared/native-dispense-returns.ts";
import type { NativePrescriptionPrintV4 } from "../../supabase/functions/_shared/native-return-reconciliation.ts";
import { replayNativeReturnQuantities } from "../../supabase/functions/_shared/native-return-quantity-replay.ts";
import { returnFixture } from "./return-fixture.ts";

export function upgradeReturnPrint(value: NativePrescriptionPrintV3): NativePrescriptionPrintV4 {
  const v = structuredClone(value), d = v.dispense_returns;
  return {
    ...v, version: 4,
    return_summary: { ...v.return_summary, version: 2, discrepancy_event_count: 0, open_case_count: 0 },
    dispense_returns: d === null ? null : {
      ...d, version: 2,
      replay: replayNativeReturnQuantities(d.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.dispensed_quantity })), d.events.map(e => ({ id: e.id, sequence: e.sequence, action: e.action, intake_id: e.intake_id, correction_target_id: null, allocations: e.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.quantity })) }))),
      discrepancies: { version: 1, head: { version: 0, event_id: null, record_hash: null }, open_case_count: 0, held_lot_ids: [], cases: [] },
    },
  };
}
export function reconciliationFixture(): NativePrescriptionPrintV4 { return upgradeReturnPrint(returnFixture()); }
