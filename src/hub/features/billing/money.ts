export function dollarsToCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter dollars with no more than two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Error("Enter a positive amount within the supported range.");
  return cents;
}
export function money(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new Error("Amount exceeds the supported display range.");
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
