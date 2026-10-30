import type { z } from "zod";
import type { reviewEventKindSchema } from "./queue-model.ts";
export const reviewEventLabels: Readonly<Record<z.infer<typeof reviewEventKindSchema>, string>> = Object.freeze({
  receive_inventory: "Stock received", adjust_inventory: "Stock adjustments", record_patient_treatment: "Patient treatments",
  record_anesthesia_drug_administration: "Anesthesia administrations", record_native_dispense: "Medication dispensed", record_native_pickup: "Medication pickups",
  "record_native_dispense_return:intake": "Returns received", "record_native_dispense_return:dispose": "Returns disposed", "record_native_dispense_return:restock": "Returns restocked",
  "record_native_dispense_return_v2:intake": "Returns received · current workflow", "record_native_dispense_return_v2:dispose": "Returns disposed · current workflow", "record_native_dispense_return_v2:restock": "Returns restocked · current workflow",
  "record_native_dispense_return_v2:retract_intake": "Return intake reversals", "record_native_dispense_return_v2:retract_disposal": "Return disposal reversals", "record_native_dispense_return_v2:retract_restock": "Return restock reversals",
  "record_native_return_discrepancy:report": "Return discrepancies", "record_native_return_discrepancy:note": "Return discrepancy notes",
  "record_native_return_discrepancy:resolve_corrected": "Corrected return discrepancies", "record_native_return_discrepancy:resolve_confirmed_original": "Confirmed original returns",
  "append_native_dispense_correction:clinical_annotation": "Clinical correction notes", "append_native_dispense_correction:operational_annotation": "Operational correction notes", "append_native_dispense_correction:pickup_amendment": "Pickup amendments",
});
