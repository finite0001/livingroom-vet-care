import { cn } from "@/lib/utils";

/**
 * The one status-color grammar for the whole hub (Direction B rule:
 * same status = same color everywhere). Tones are backed by the CSS variables
 * in src/index.css (.tone-* classes) so chips, icon chips and borders can all
 * reuse the identical mapping.
 */
export type StatusTone =
  | "neutral"
  | "info"
  | "terracotta"
  | "success"
  | "warning"
  | "destructive";

interface StatusMeta {
  label: string;
  tone: StatusTone;
}

/**
 * Real appointment_status values plus the lowercase/conceptual aliases used
 * in design docs, so the map stays correct if a caller passes either form.
 * The DB enum is SCHEDULED | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW.
 */
const STATUS_META: Record<string, StatusMeta> = {
  // Booked, awaiting the client — info blue.
  SCHEDULED: { label: "Booked", tone: "info" },
  // Confirmed / checked in — the visit that is happening; terracotta.
  CONFIRMED: { label: "Confirmed", tone: "terracotta" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "destructive" },
  NO_SHOW: { label: "No show", tone: "warning" },
  // Conceptual aliases (not in the DB enum) kept for grammar completeness.
  unconfirmed: { label: "Unconfirmed", tone: "neutral" },
  booked: { label: "Booked", tone: "info" },
  checked_in: { label: "Checked in", tone: "terracotta" },
  on_site: { label: "On site", tone: "terracotta" },
  done: { label: "Completed", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "destructive" },
  canceled: { label: "Cancelled", tone: "destructive" },
  en_route: { label: "En route", tone: "warning" },
};

const FALLBACK: StatusMeta = { label: "Unknown", tone: "neutral" };

/** Map an appointment status to its tone; reuse for borders, icons, text. */
export function statusTone(status: string | null | undefined): StatusTone {
  return (status && STATUS_META[status]?.tone) || FALLBACK.tone;
}

/** Human label for an appointment status. */
export function statusLabel(status: string | null | undefined): string {
  return (status && STATUS_META[status]?.label) || FALLBACK.label;
}

export const statusToneClass: Record<StatusTone, string> = {
  neutral: "tone-neutral",
  info: "tone-info",
  terracotta: "tone-terracotta",
  success: "tone-success",
  warning: "tone-warning",
  destructive: "tone-destructive",
};

interface StatusChipProps {
  status: string | null | undefined;
  className?: string;
}

/** Pill chip with a colored dot; the canonical status rendering. */
export function StatusChip({ status, className }: StatusChipProps) {
  const meta = (status && STATUS_META[status]) || FALLBACK;
  return (
    <span
      data-status={status ?? "unknown"}
      className={cn("status-chip", statusToneClass[meta.tone], className)}
    >
      {meta.label}
    </span>
  );
}
