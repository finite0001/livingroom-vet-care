import type { WitnessPreparation, WitnessReply } from "./schema.ts";
export const witnessBasisLabels = {
  physical_record: "Physical observation", correction_assertion: "Correction assertion",
  annotation: "Record annotation", discrepancy_assertion: "Discrepancy assertion",
} satisfies Record<WitnessPreparation["context"]["basis"]["kind"], string>;
export const witnessBlockedLabels = {
  parent_expired: "The original preparation has expired",
  parent_cancelled: "The recorder closed the original preparation",
  parent_saved: "The recorder has already recorded the original action",
  source_changed: "The original source or stock rule has changed",
  current_witness_ineligible: "The witness account is not currently eligible to attest this action",
} satisfies Record<NonNullable<WitnessReply["data"]["blocked_reason"]>, string>;
