import { ExactJsonNumber, type ExactJson } from "./exact-json.ts";

function invalid(): never { throw new Error("Review JSONB comparison exceeds its exact source domain"); }
function numericIdentity(value: ExactJsonNumber): string {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value.token);
  if (!match || value.token.length > 1024) invalid();
  const fraction = match[3] ?? "", exponent = BigInt(match[4] ?? "0");
  const scale = BigInt(fraction.length) - exponent;
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (exponent < -1073741823n || exponent > 1073741823n || scale > 16383n ||
    (digits && BigInt(digits.length) - scale > 131072n)) invalid();
  if (!digits) return "0";
  const coefficient = digits.replace(/0+$/, "");
  const power = exponent - BigInt(fraction.length) + BigInt(digits.length - coefficient.length);
  // Compare coefficient/exponent without expanding exponent-sized strings or
  // coercing source values through Number. Original tokens remain untouched.
  return match[1] + coefficient + ":" + power.toString();
}

/** JSONB semantic equality for already losslessly decoded bounded evidence.
 * Numeric scale does not affect equality; string quantities remain strings.
 * This is neither serialization/hashing nor a database-membership validator.
 */
export function sameReviewJsonb(left: ExactJson, right: ExactJson): boolean {
  let nodes = 0;
  function equal(a: ExactJson, b: ExactJson, depth: number): boolean {
    if (++nodes > 100000 || depth > 64) invalid();
    if (a instanceof ExactJsonNumber || b instanceof ExactJsonNumber)
      return a instanceof ExactJsonNumber && b instanceof ExactJsonNumber && numericIdentity(a) === numericIdentity(b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index], depth + 1));
    const aa = a as { readonly [key: string]: ExactJson }, bb = b as { readonly [key: string]: ExactJson };
    const keys = Object.keys(aa);
    return keys.length === Object.keys(bb).length && keys.every(key => Object.prototype.hasOwnProperty.call(bb, key) && equal(aa[key], bb[key], depth + 1));
  }
  return equal(left, right, 0);
}
