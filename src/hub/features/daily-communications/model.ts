import { z } from "zod";
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
export const statuses = [
  "scheduled",
  "queued",
  "processing",
  "accepted",
  "delivered",
  "failed",
  "uncertain",
  "suppressed",
  "cancelled",
] as const;
export const statusSchema = z.enum(statuses);
export type CommunicationStatus = z.infer<typeof statusSchema>;
export const statusLabels: Record<CommunicationStatus, string> = {
  scheduled: "Scheduled",
  queued: "Queued",
  processing: "Processing",
  accepted: "Provider accepted · delivery unconfirmed",
  delivered: "Delivered",
  failed: "Failed",
  uncertain: "Delivery uncertain",
  suppressed: "Suppressed",
  cancelled: "Cancelled",
};
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a complete date")
  .refine((s) => {
    const date = new Date(`${s}T12:00:00Z`);
    return (
      Number(s.slice(0, 4)) > 0 &&
      Number.isFinite(date.valueOf()) &&
      date.toISOString().slice(0, 10) === s
    );
  }, "Enter a valid date");
export function denverDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const filtersSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    channel: z.enum(["", "EMAIL", "SMS"]),
    status: z.union([z.literal(""), statusSchema]),
    search: z.string().trim().max(200),
  })
  .superRefine((f, ctx) => {
    const days = (Date.parse(f.to) - Date.parse(f.from)) / 86400000;
    if (days < 0 || days > 365)
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message:
          "Choose a range of up to 366 days, ending on or after the start date",
      });
  });
export type CommunicationFilters = z.infer<typeof filtersSchema>;
export const sources = ["outbox", "legacy", "care", "appointment"] as const;
export const cursorSchema = z
  .object({ activity_at: instant, source: z.enum(sources), id: uuid })
  .strict();
export type CommunicationCursor = z.infer<typeof cursorSchema>;
export const rowSchema = z
  .object({
    source: z.enum(sources),
    id: uuid,
    activity_at: instant,
    created_at: instant,
    updated_at: instant,
    channel: z.enum(["EMAIL", "SMS"]),
    status: statusSchema,
    summary: z.string(),
    client_id: uuid.nullable(),
    client_name: z.string().nullable(),
    pet_id: uuid.nullable(),
    patient_name: z.string().nullable(),
    conversation_id: uuid.nullable(),
    recipient: z.string().nullable(),
    attempt_count: z.number().int().nonnegative(),
    accepted_at: instant.nullable(),
    delivered_at: instant.nullable(),
    reason: z.string().nullable(),
    source_href: z
      .string()
      .regex(
        /^\/hub\/(conversation\/[0-9a-f-]{36}|schedule|tools\/care-reminders)$/,
      ),
  })
  .strict();
export type CommunicationRow = z.infer<typeof rowSchema>;
export const pageSchema = z
  .object({
    read_at: instant,
    rows: z.array(rowSchema).max(100),
    next: cursorSchema.nullable(),
  })
  .strict();
export const detailSchema = z
  .object({
    record: rowSchema,
    attempts: z.array(
      z
        .object({
          attempt_number: z.number().int().positive(),
          started_at: instant,
          finished_at: instant.nullable(),
          outcome: z.enum(["accepted", "failed", "uncertain"]).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export function initialFilters(): CommunicationFilters {
  const today = denverDay();
  return { from: today, to: today, channel: "", status: "", search: "" };
}
