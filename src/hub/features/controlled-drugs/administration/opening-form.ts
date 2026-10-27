import { countObservationTime, countQuantityInput } from "../count/count-entry.ts";
import { stockOpeningDefinitionSchema, openingSlotIdentity, type StockOpeningDefinition } from "./opening-definition.ts";
import type { StockOpeningPreview, AdministrationLocation } from "./queries.ts";
import { buildStockPolicy, type StockPolicyDraft } from "./stock-policy-form.ts";
export interface OpeningPlacementDraft { readonly slotKey: string; readonly label: string; readonly location: string; readonly custodian: string; readonly quantity: string; readonly observedLocal: string; readonly observedOffset: string }
export interface OpeningFormDraft { readonly placements: readonly OpeningPlacementDraft[]; readonly completedLocal: string; readonly completedOffset: string; readonly note: string; readonly attest: boolean; readonly policy: StockPolicyDraft }
export function buildStockOpening(preview: StockOpeningPreview, draft: OpeningFormDraft, locations: readonly AdministrationLocation[], staffIds: readonly string[], siteIds: readonly string[]): StockOpeningDefinition {
  const slots = preview.data.slots;
  if (preview.state !== "available" || !slots || !preview.data.source_basis_digest || !draft.attest || draft.placements.length !== slots.length ||
    draft.placements.some((row, index) => row.slotKey !== openingSlotIdentity(slots[index].slot))) throw new Error("Read a current opening preview and record every captured position in its original order.");
  const policy = buildStockPolicy(draft.policy, siteIds);
  return stockOpeningDefinitionSchema.parse({ draft_version_id: preview.data.draft_version_id, expected_basis_digest: preview.data.source_basis_digest,
    policy, completed_at: countObservationTime(draft.completedLocal, draft.completedOffset), note: draft.note,
    placements: slots.map((source, index) => {
      const row = draft.placements[index], location = locations.find(item => item.id === row.location && policy.site_ids.includes(item.site_id!));
      if (!location || location.kind === "mobile_kit" && !staffIds.includes(row.custodian)) throw new Error("Choose a registered policy location and an eligible mobile custodian for every position.");
      if (!source.observation_required && (row.quantity !== "" || row.observedLocal !== "" || row.observedOffset !== "")) throw new Error("A position outside the clinic must retain its source-proven absence of a new observation.");
      const quantity = source.observation_required ? countQuantityInput(row.quantity) : null;
      if (quantity !== null && quantity !== source.recorded_quantity) throw new Error("An opening observation differs from the existing stock record. Correct the legacy stock through its supported workflow, then read a fresh complete opening preview.");
      return { slot: source.slot, label: row.label, location_id: location.id, custodian_id: location.kind === "clinic" ? null : row.custodian,
        status: source.custody_state, quantity,
        observed_at: source.observation_required ? countObservationTime(row.observedLocal, row.observedOffset) : null };
    }) });
}
