import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";

/** Only numeric fields explicitly declared by the existing strict native receipt
 * schema are adapted. Decimal quantity strings and unknown source JSON remain
 * untouched. The original complete schema and semantic observer still run. */
export function admitLegacyResult<T>(schema: z.ZodType<T>, raw: ExactJson): T {
  function project(shape: z.ZodTypeAny, value: unknown, depth: number): unknown {
    if (depth > 64) throw new Error("Native receipt exceeds its schema depth.");
    if (shape instanceof z.ZodEffects) return project(shape.innerType(), value, depth + 1);
    if (shape instanceof z.ZodOptional || shape instanceof z.ZodNullable || shape instanceof z.ZodDefault)
      return value === null || value === undefined ? value : project(shape._def.innerType, value, depth + 1);
    if (shape instanceof z.ZodUnion || shape instanceof z.ZodDiscriminatedUnion) {
      for (const option of shape.options as z.ZodTypeAny[]) {
        try { const candidate = project(option, value, depth + 1); if (option.safeParse(candidate).success) return candidate; } catch { /* Try the next declared variant. */ }
      }
      throw new Error("Native receipt does not match a declared variant.");
    }
    if (shape instanceof z.ZodNumber) {
      if (!(value instanceof ExactJsonNumber)) return value;
      // Every native number field is an explicit protocol integer. Refuse any
      // future unbounded/fractional schema instead of broadening conversion.
      const checks = shape._def.checks;
      if (!checks.some(check => check.kind === "int") || !checks.some(check => check.kind === "min") ||
        !checks.some(check => check.kind === "max" && check.value <= 2147483647)) throw new Error("Native number schema is not bounded.");
      return shape.parse(protocolInteger(value, 0, 2147483647));
    }
    if (shape instanceof z.ZodLiteral && typeof shape.value === "number")
      return value instanceof ExactJsonNumber ? protocolInteger(value, shape.value, shape.value) : value;
    if (shape instanceof z.ZodObject && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const [key, child] of Object.entries(value)) result[key] = shape.shape[key] ? project(shape.shape[key], child, depth + 1) : child;
      return result;
    }
    if (shape instanceof z.ZodArray && Array.isArray(value)) return value.map(child => project(shape.element, child, depth + 1));
    return value;
  }
  return schema.parse(project(schema, raw, 0));
}
