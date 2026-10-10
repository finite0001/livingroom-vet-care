import { z } from "zod";
const date = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value),
    "Enter a valid date.",
  );
export const filtersSchema = z
  .object({
    productId: z.union([z.literal(""), z.string().uuid()]),
    eventType: z.enum(["", "administered", "dispensed", "performed"]),
    from: date,
    to: date,
    lot: z.string().trim().max(200),
    species: z.string().trim().max(100),
    clinician: z.string().trim().max(200),
    includeCorrected: z.boolean(),
    includeHistorical: z.boolean(),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "Start date must be on or before the end date.",
  );
export interface WhogotFilters {
  productId: string;
  eventType: "" | "administered" | "dispensed" | "performed";
  from: string;
  to: string;
  lot: string;
  species: string;
  clinician: string;
  includeCorrected: boolean;
  includeHistorical: boolean;
}
export const emptyFilters: WhogotFilters = {
  productId: "",
  eventType: "",
  from: "",
  to: "",
  lot: "",
  species: "",
  clinician: "",
  includeCorrected: false,
  includeHistorical: false,
};
export const cursorSchema = z.object({
  occurred_at: z.string().datetime({ offset: true }),
  event_type: z.enum(["administered", "dispensed", "performed"]),
  id: z.string().uuid(),
});
export const rowSchema = z.object({
  id: z.string().uuid(),
  pet_id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string(),
  event_type: z.enum(["administered", "dispensed", "performed"]),
  item_kind: z.enum(["medication", "vaccine", "service"]),
  occurred_at: z.string().datetime({ offset: true }),
  historical: z.boolean(),
  clinician: z.string(),
  lots: z.string(),
  correction_status: z.enum(["current", "corrected", "annotated"]),
  correction_reason: z.string().nullable(),
  replacement_id: z.string().uuid().nullable(),
  encounter_id: z.string().uuid().nullable(),
  authorization_id: z.string().uuid().nullable(),
  source_note: z.string(),
  patient_name: z.string(),
  species: z.string(),
  deceased_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  client_id: z.string().uuid(),
  client_name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export const pageSchema = z.object({
  as_of: z.string().datetime({ offset: true }),
  rows: z.array(rowSchema),
  next: cursorSchema.nullable(),
});
export type WhogotRow = z.infer<typeof rowSchema>;
export type WhogotPage = z.infer<typeof pageSchema>;
export type WhogotCursor = z.infer<typeof cursorSchema>;
export const productsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    kind: z.enum(["medication", "vaccine", "service"]),
    active: z.boolean(),
    aliases: z.array(z.string()),
  }),
);
export function sourceHref(row: WhogotRow): string {
  return `/hub/whogot/source/${row.event_type}/${row.id}?patient=${row.pet_id}`;
}
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe =
    /^[=+\-@]/.test(text.replace(/^[\s\p{Cc}]+/u, "")) || /^[\t\r\n]/.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function whogotCsv(rows: WhogotRow[], asOf: string): string {
  const headers = [
    "Patient",
    "Species",
    "Patient status",
    "Client",
    "Phone",
    "Email",
    "Received at (ISO)",
    "Event",
    "Item",
    "Lot(s)",
    "Clinician / dispensing staff",
    "History status",
    "Source status",
    "Correction reason",
    "Replacement ID",
    "Source note",
    "Source record",
    "Search as of (ISO)",
  ];
  return (
    "\ufeff" +
    [
      headers,
      ...rows.map((r) => [
        r.patient_name,
        r.species,
        r.deceased_at ? "Deceased" : r.archived_at ? "Archived" : "Active",
        r.client_name,
        r.phone,
        r.email,
        r.occurred_at,
        r.event_type,
        r.product_name,
        r.lots,
        r.clinician,
        r.correction_status,
        r.historical ? "Historical entry" : "Practice event",
        r.correction_reason,
        r.replacement_id,
        r.source_note,
        sourceHref(r),
        asOf,
      ]),
    ]
      .map((values) => values.map(csvCell).join(","))
      .join("\r\n")
  );
}
