import { ExactJsonNumber } from "./exact-json.ts";

function invalid(): never { throw new Error("Review value is outside its exact source domain"); }

/** A stored numeric(14,3), expressed as integer thousandths. No clinical value
 * passes through Number. Scientific notation and redundant fractional zeros
 * are accepted only when their exact value fits the stored source domain.
 */
export function reviewQuantityThousandths(value: ExactJsonNumber): bigint {
  if (!(value instanceof ExactJsonNumber)) invalid();
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value.token);
  if (!match || value.token.length > 1024) invalid();
  const fraction = match[3] ?? "", exponent = BigInt(match[4] ?? "0");
  if (exponent < -1073741823n || exponent > 1073741823n || BigInt(fraction.length) - exponent > 16383n) invalid();
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (!digits) return 0n;
  const significant = digits.replace(/0+$/, "");
  const power = exponent - BigInt(fraction.length) + BigInt(digits.length - significant.length) + 3n;
  // Reject before allocating a large power, including nonzero sub-thousandths.
  if (power < 0n || BigInt(significant.length) + power > 14n) invalid();
  return (match[1] ? -1n : 1n) * BigInt(significant) * 10n ** power;
}

/** C0 context strings use the deliberately narrower controlled_stock_decimal
 * grammar. Keep it distinct from numeric JSON and native result text fields.
 */
export function reviewContextQuantity(value: string, allowZero = false): bigint {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,10})(?:\.[0-9]{1,3})?$/.test(value)) invalid();
  const quantity = reviewQuantityThousandths(new ExactJsonNumber(value));
  if (!allowZero && quantity === 0n) invalid();
  return quantity;
}

/** Source instants compare at PostgreSQL's microsecond precision. Date is used
 * only for bounded Gregorian calendar arithmetic, never for the final instant
 * comparison (which would discard the last three fractional digits).
 * This client domain is finite: four-digit AD years and explicit UTC offsets.
 */
export function reviewInstantMicroseconds(value: string): bigint {
  if (typeof value !== "string") invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) invalid();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const zoneHour = Number(match[10] ?? "0"), zoneMinute = Number(match[11] ?? "0");
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || zoneHour > 15 || zoneMinute > 59) invalid();
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) invalid();
  const offset = BigInt(zoneHour * 60 + zoneMinute) * (match[9] === "-" ? -1n : 1n);
  return BigInt(date.getTime()) * 1000n + BigInt((match[7] ?? "").padEnd(6, "0")) - offset * 60000000n;
}
