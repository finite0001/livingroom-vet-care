export interface RetryOperation<T> {
  id: string;
  payload: T;
}
export function quantityValue(value: string, allowNegative = false): number {
  if (!/^-?\d+(\.\d{1,3})?$/.test(value.trim()))
    throw new Error("Enter a quantity with at most three decimal places.");
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number === 0 ||
    (!allowNegative && number < 0)
  )
    throw new Error("Enter a valid nonzero quantity.");
  return number;
}
export function centsValue(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a price with at most two decimal places.");
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100000000)
    throw new Error("Price exceeds the supported range.");
  return cents;
}
export function isDefinitiveRejection(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  return [
    "23514",
    "23503",
    "23502",
    "23505",
    "42501",
    "40001",
    "22P02",
    "22003",
    "22007",
    "22008",
    "42883",
    "PGRST202",
  ].includes(code);
}
export function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "The request could not be confirmed.";
}
export function denverDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export interface TreatmentSummary {
  id: string;
  kind: string;
  next_due_on: string | null;
  administered_at: string;
}
export function currentVaccinations<T extends TreatmentSummary>(
  records: T[],
  correctedIds: Set<string>,
): T[] {
  return records.filter(
    (record) => record.kind === "vaccine" && !correctedIds.has(record.id),
  );
}

export function practiceTimestamp(value: string): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value)) + " MT"
  );
}
