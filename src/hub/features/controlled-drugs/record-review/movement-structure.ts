import { z } from "zod";
import { ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "./exact-json.ts";
import { reviewContextQuantity, reviewInstantMicroseconds, reviewQuantityThousandths, reviewSnapshotTotalThousandths } from "./exact-values.ts";
import { reviewUuidSchema as uuid } from "./request.ts";
import { verifyProspectiveSourceRowStructure } from "./prospective-packet-structure.ts";

interface EvidenceObject { readonly [key: string]: ExactJson }
const integer = (min: number, max: number) => z.instanceof(ExactJsonNumber).refine(value => {
  try { protocolInteger(value, min, max); return true; } catch { return false; }
});
const one = z.instanceof(ExactJsonNumber).refine(value => {
  try { return reviewQuantityThousandths(value) === 1000n; } catch { return false; }
});
const bigVersion = z.instanceof(ExactJsonNumber).refine(value => /^(0|[1-9][0-9]*)$/.test(value.token) && BigInt(value.token) <= 9223372036854775807n);
const quantity = z.string().refine(value => { try { reviewContextQuantity(value); return true; } catch { return false; } });
const aggregate = z.string().refine(value => { try { reviewSnapshotTotalThousandths(value); return true; } catch { return false; } });
const instant = z.string().refine(value => { try { reviewInstantMicroseconds(value); return true; } catch { return false; } });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { reviewInstantMicroseconds(value + "T00:00:00Z"); return true; } catch { return false; }
});
// The whitespace set in controlled_stock_text matches JS trim. Do not normalize
// the evidence; validate its original spelling and count Unicode code points.
const clean = (max: number, multiline = false) => z.string().refine(value => validUnicode(value) && value === value.trim() &&
  Array.from(value).length >= 1 && Array.from(value).length <= max && Array.from(value).every(char =>
    (multiline && (char === "\n" || char === "\t")) || (char.codePointAt(0)! >= 32 && char.codePointAt(0) !== 127)));
const text = (min: number, max: number) => z.string().refine(value => validUnicode(value) && !value.includes("\0") && Array.from(value).length >= min && Array.from(value).length <= max);
const catalogText = (max: number) => z.string().refine(value => {
  const length = Array.from(value.replace(/^ +| +$/g, "")).length;
  return validUnicode(value) && !value.includes("\0") && length >= 1 && length <= max;
});
const row = (relation: string) => z.custom<EvidenceObject>(value => {
  try { verifyProspectiveSourceRowStructure(relation, value); return true; } catch { return false; }
});
const status = z.enum(["onsite", "handed_off", "disposed"]);
const after = z.object({ status, location_id: uuid.nullable(), custodian_id: uuid.nullable() }).strict()
  .refine(value => value.status === "onsite" ? value.location_id !== null : value.location_id === null && value.custodian_id === null);
const create = z.object({ kind: z.literal("stock"), label: clean(200), stock_lot_id: uuid, site_id: uuid,
  location_id: uuid, custodian_id: uuid.nullable() }).strict();
const line = z.object({ lot_id: uuid, channel: z.literal("available"), dispense_id: z.null(), intake_id: z.null(), quantity_delta: quantity }).strict();
const container = z.object({ id: uuid, expected_version: integer(0, 2147483647).nullable(), create: create.nullable(), after,
  lines: z.array(line).max(1) }).strict();
export const movementContextSchema = z.object({ version: one, product_id: uuid, policy_version_id: uuid, state_head_id: uuid, opening_id: uuid,
  basis: z.object({ kind: z.literal("physical_record"), observed_at: instant, note: clean(4000, true) }).strict(),
  containers: z.array(container).min(1).max(32).refine(values => values.every((value, index) => !index || values[index - 1].id < value.id)),
}).strict();
const head = z.object({ container_id: uuid, version: bigVersion, location_id: uuid.nullable(), custodian_id: uuid.nullable(),
  status, last_event_id: uuid.nullable() }).strict().refine(value => (String(value.version) === "0") === (value.last_event_id === null) &&
    (value.status === "onsite" ? value.location_id !== null : value.location_id === null && value.custodian_id === null));
const position = z.object({ cell_id: uuid, quantity: z.instanceof(ExactJsonNumber).refine(value => {
  try { return reviewQuantityThousandths(value) >= 0n; } catch { return false; }
}) }).strict();
const cellSnapshot = z.object({ cell: row("public.controlled_stock_cells"), position }).strict();
const frame = z.object({ id: uuid, container: row("public.controlled_stock_containers").nullable(), head: head.nullable(),
  cells: z.array(cellSnapshot).max(512) }).strict();
const catalog = z.object({ id: uuid, name: catalogText(200), kind: z.enum(["medication", "vaccine", "service"]), manufacturer: text(0, 200),
  unit: catalogText(50), unit_price_cents: z.instanceof(ExactJsonNumber).refine(value => /^(0|[1-9][0-9]*)$/.test(value.token) && BigInt(value.token) <= 100000000n),
  active: z.boolean(), version: integer(1, 2147483647), created_by: uuid, created_at: instant }).strict();
const permission = z.object({ enabled: z.literal(true), roles: z.array(z.enum(["ADMIN", "DVM", "STAFF"])).min(1).max(3),
  basis: z.literal("physical_record"), witness: z.enum(["none", "c2_required"]), secondary_review: z.boolean(),
  location_kinds: z.array(z.enum(["clinic", "mobile_kit"])).min(1).max(2) }).strict();
export const movementFrozenSchema = z.object({ catalog, containers: z.array(frame).min(1).max(32),
  lots: z.array(z.object({ id: uuid, lot: row("public.inventory_lots").nullable(), available: aggregate, native_hold: z.boolean() }).strict()).length(1),
  native: z.null(), expected_effects: z.array(line).length(1), permission }).strict();
export const movementReceiveArgumentsSchema = z.object({ lot_id: uuid, product_id: uuid, lot_number: clean(200), expires_on: date,
  location: clean(200), quantity, reason: clean(2000, true) }).strict();
export const movementAdjustArgumentsSchema = z.object({ lot_id: uuid, quantity, reason: clean(2000, true) }).strict();
