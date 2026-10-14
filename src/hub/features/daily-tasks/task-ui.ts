import { denverLocal } from "../scheduling/time.ts";
export const operationalSelectClass =
  "min-h-11 min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function operationalTimeLabel(instant: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}
export function operationalLocal(instant: string | Date) {
  const date = new Date(instant);
  return (
    denverLocal(date) + ":" + String(date.getUTCSeconds()).padStart(2, "0")
  );
}
export function operationalInstant(
  local: string,
  resolution: "reject" | "earlier" | "later" = "reject",
) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local))
    throw new Error("Choose an actual date and time");
  const value = local.length === 16 ? local + ":00" : local;
  const wall = Date.parse(value + "Z");
  const candidates = [6, 7]
    .map((offset) => new Date(wall + offset * 3600000))
    .filter(
      (date) =>
        Number.isFinite(date.getTime()) && operationalLocal(date) === value,
    );
  if (!candidates.length)
    throw new Error("This local time does not exist. Choose the actual time.");
  if (candidates.length > 1 && resolution === "reject")
    throw new Error(
      "This hour occurs twice. Choose its earlier or later occurrence after reviewing the actual time.",
    );
  return candidates[
    resolution === "later" ? candidates.length - 1 : 0
  ].toISOString();
}
export function operationalActionError(cause: unknown) {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : "";
  if (code === "PT409")
    return "The source or saved version changed. Reload and review it before a new action.";
  if (code === "23P01")
    return "This physical use overlaps another record. A veterinarian or administrator must review the overlap.";
  if (code === "42501")
    return "A current staff session and the required role are needed. Unconfirmed work stays available to its original staff member.";
  if (code === "23505")
    return "This recovery action already belongs to other work. Check its saved result first.";
  if (["23514", "23502", "23503"].includes(code))
    return "Review the fields, exact saved checklist and current source facts before saving.";
  if (cause instanceof Error && cause.name === "ZodError")
    return "Complete the required fields and review the choices before saving.";
  return "The save could not be confirmed. Check saved work before starting another action.";
}
