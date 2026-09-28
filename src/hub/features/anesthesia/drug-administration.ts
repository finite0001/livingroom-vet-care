import { denverInstant } from "../clinical/editor-state.ts";
import { quantityValue } from "../inventory/stock-policy.ts";

// Staff-entered values only: no drug list, dose, route or quantity default is
// supplied. Clinical wording and required fields are pending review by
// Dr. Susan Edler (see docs/anesthesia-records.md).
export interface AnesthesiaDrugInput {
  lot_id: string;
  invoice_id: string;
  quantity: string;
  dose: string;
  route: string;
  site: string;
  veterinarian: string;
  veterinarian_license: string;
  /** Denver wall-clock `YYYY-MM-DDTHH:mm`. */
  administered: string;
}
export interface AnesthesiaDrugRequest {
  lot_id: string;
  invoice_id: string;
  quantity: number;
  dose: string;
  route: string;
  site: string;
  veterinarian: string;
  veterinarian_license: string;
  administered_at: string;
  alert_review: { source_hash: string; acknowledged: true };
}
export interface ProcedureWindow {
  status: string;
  started_at: string;
  ended_at: string | null;
}
export const SIGNED_RECORD_DRUG_POLICY =
  "Signed anesthesia records are locked. Record later drugs in Treatments (which still debits stock and charges the draft invoice) and append an anesthesia addendum describing them.";

export function anesthesiaDrugsLocked(record: ProcedureWindow): boolean {
  return record.status !== "draft";
}

function required(value: string, label: string, max: number): string {
  if (!value.trim()) throw new Error(`Enter the ${label}.`);
  if (value.length > max)
    throw new Error(`The ${label} must be at most ${max} characters.`);
  return value;
}
function optional(value: string, label: string, max: number): string {
  if (value.length > max)
    throw new Error(`The ${label} must be at most ${max} characters.`);
  return value;
}

/** Mirrors the server checks so staff see problems before a request is sent. */
export function anesthesiaDrugRequest(
  input: AnesthesiaDrugInput,
  record: ProcedureWindow,
  alertSourceHash: string | null | undefined,
  now: Date = new Date(),
): AnesthesiaDrugRequest {
  if (anesthesiaDrugsLocked(record)) throw new Error(SIGNED_RECORD_DRUG_POLICY);
  if (!input.lot_id)
    throw new Error("Choose the stock lot the drug came from.");
  if (!input.invoice_id)
    throw new Error("Choose the household's draft invoice for this charge.");
  if (!alertSourceHash)
    throw new Error(
      "Review the patient's important alerts before recording a drug. Reload if alerts could not load.",
    );
  const administered_at = denverInstant(input.administered);
  const at = Date.parse(administered_at);
  const end = record.ended_at
    ? Date.parse(record.ended_at)
    : now.getTime() + 5 * 60_000;
  if (at < Date.parse(record.started_at) || at > end)
    throw new Error(
      "Drug administration time must fall within the recorded procedure.",
    );
  return {
    lot_id: input.lot_id,
    invoice_id: input.invoice_id,
    quantity: quantityValue(input.quantity),
    dose: required(input.dose, "clinical dose", 200),
    route: required(input.route, "route", 100),
    site: optional(input.site, "administration site", 200),
    veterinarian: required(input.veterinarian, "veterinarian", 200),
    veterinarian_license: optional(
      input.veterinarian_license,
      "veterinarian license",
      100,
    ),
    administered_at,
    alert_review: { source_hash: alertSourceHash, acknowledged: true },
  };
}

export interface DrugLotCandidate {
  kind: string;
  active: boolean;
  balance: number;
  expires_on: string;
}
/** Only unexpired, in-stock, active medication lots can be charged here. */
export function anesthesiaDrugLots<T extends DrugLotCandidate>(
  lots: T[],
  today: string,
): T[] {
  return lots.filter(
    (lot) =>
      lot.kind === "medication" &&
      lot.active &&
      lot.balance > 0 &&
      lot.expires_on >= today,
  );
}
