import { z } from "zod";
import { validUnicode } from "../record-review/exact-json.ts";
export const administrationUuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const administrationDigest = z.string().regex(/^[0-9a-f]{64}$/);
export const administrationVersion = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
export const administrationRecordVersion = z.string().regex(/^[1-9][0-9]{0,9}$/).refine(value => /^[1-9][0-9]{0,9}$/.test(value) && BigInt(value) <= 2147483647n);
export const administrationInstant = z.string().regex(/^(20[2-9][0-9]|2100)-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/)
  .refine(value => value >= "2026-01-01T00:00:00.000000Z" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 23) === value.slice(0, 23));
export function administrationText(characters: number, bytes: number, multiline = false) {
  // Same Unicode edge whitespace and control-character grammar as the original
  // controlled_stock_text. Reject altered spelling; never silently trim notes.
  return z.string().min(1).max(characters * 2).refine(value => validUnicode(value) && value === value.trim() &&
    [...value].length <= characters && new TextEncoder().encode(value).length <= bytes && [...value].every(point => {
      const code = point.codePointAt(0)!;
      return code >= 32 && code !== 127 || multiline && (code === 9 || code === 10);
    }));
}
export const administrationName = administrationText(200, 800);
export const administrationReference = administrationText(2000, 8000, true);
export const administrationStaffRoles = ["ADMIN", "DVM", "STAFF", "TECH"] as const;
export const administrationStaffRoleList = z.array(z.enum(administrationStaffRoles)).min(1).max(4).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value));
export function freezeAdministration<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeAdministration); Object.freeze(value); }
  return value;
}
