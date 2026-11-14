import { z } from "zod";
import { shiftDay } from "../scheduling/time.ts";
export const TOOL_VERSION = "lrv-clinical-tools-2026-11-v1";
export const references = {
  fluid:
    "https://www.aaha.org/resources/2024-aaha-fluid-therapy-guidelines-for-dogs-and-cats/section-3-fluids-for-replacement-and-maintenance/",
  chocolate:
    "https://www.merckvetmanual.com/toxicology/food-hazards/chocolate-toxicosis-in-animals",
  gestation:
    "https://www.merckvetmanual.com/reproductive-system/reproductive-system-introduction/the-reproductive-system-in-animals",
};
const weight = {
  weight: z.number().positive().max(1000),
  unit: z.enum(["kg", "lb"]),
};
export const fluidInput = z.object({
  ...weight,
  species: z.enum(["dog", "cat"]),
  dehydration_percent: z.number().min(0).max(15),
  replacement_hours: z.number().min(12).max(24),
  ongoing_ml_hour: z.number().min(0).max(10000),
});
export const shockInput = z.object({
  ...weight,
  species: z.enum(["dog", "cat"]),
});
export const chocolateInput = z
  .object({
    ...weight,
    grams: z.number().positive().max(100000),
    product: z.enum(["cocoa", "baking", "dark", "milk", "white", "percent"]),
    cocoa_percent: z.number().min(0).max(100).optional(),
  })
  .refine(
    (v) => v.product !== "percent" || v.cocoa_percent !== undefined,
    "Enter the labeled cocoa percentage",
  );
export const gestationInput = z
  .object({
    species: z.enum(["dog", "cat"]),
    basis: z.enum(["ovulation", "breeding"]),
    date: z.iso.date(),
  })
  .refine(
    (v) => v.species !== "cat" || v.basis === "breeding",
    "Use the breeding date for the feline estimate",
  );
export function weightKg(value: number, unit: "kg" | "lb") {
  return unit === "kg" ? value : value * 0.45359237;
}
export interface Calculation {
  version: string;
  reference: string;
  values: Record<string, number | string>;
  notes: string[];
}
export function calculate(tool: string, value: unknown): Calculation {
  if (tool === "fluid") {
    const v = fluidInput.parse(value),
      kg = weightKg(v.weight, v.unit),
      maintenance = (kg * (v.species === "dog" ? 60 : 40)) / 24,
      deficit = ((kg * v.dehydration_percent) / 100) * 1000;
    return {
      version: TOOL_VERSION,
      reference: references.fluid,
      values: {
        weight_kg: kg,
        maintenance_ml_hour: maintenance,
        deficit_ml: deficit,
        replacement_ml_hour: deficit / v.replacement_hours,
        ongoing_ml_hour: v.ongoing_ml_hour,
        total_ml_hour:
          maintenance + deficit / v.replacement_hours + v.ongoing_ml_hour,
      },
      notes: [
        "Adult maintenance estimate plus deficit replacement and entered ongoing losses.",
        "Veterinarian must individualize fluid type/rate, account for all fluid inputs and monitor response and overload risk.",
      ],
    };
  }
  if (tool === "shock") {
    const v = shockInput.parse(value),
      kg = weightKg(v.weight, v.unit);
    return {
      version: TOOL_VERSION,
      reference: references.fluid,
      values: {
        weight_kg: kg,
        bolus_low_ml: kg * (v.species === "dog" ? 15 : 5),
        bolus_high_ml: kg * (v.species === "dog" ? 20 : 10),
        administration_minutes_low: 15,
        administration_minutes_high: 30,
      },
      notes: [
        "Buffered isotonic crystalloid bolus range for hypovolemia; this is not a cumulative shock-dose prescription.",
        "Reassess perfusion after each bolus; individualize for the patient's condition.",
      ],
    };
  }
  if (tool === "chocolate") {
    const v = chocolateInput.parse(value),
      kg = weightKg(v.weight, v.unit);
    const concentrations: Record<string, [number, number]> = {
      cocoa: [28.5, 28.5],
      baking: [15.5, 15.5],
      dark: [5.3, 5.6],
      milk: [2.3, 2.3],
      white: [0.04, 0.04],
      percent: [
        (15.5 * (v.cocoa_percent ?? 0)) / 100,
        (15.5 * (v.cocoa_percent ?? 0)) / 100,
      ],
    };
    const [low, high] = concentrations[v.product];
    return {
      version: TOOL_VERSION,
      reference: references.chocolate,
      values: {
        weight_kg: kg,
        estimated_methylxanthines_mg_kg_low: (low * v.grams) / kg,
        estimated_methylxanthines_mg_kg_high: (high * v.grams) / kg,
      },
      notes: [
        "Product concentrations are estimates; brands and recipes vary. Verify amount/product and other ingredients.",
        "In dogs, signs are reported around 20 mg/kg; cardiac effects at 40–50 mg/kg and seizures at 60 mg/kg or more. A lower estimate does not establish safety.",
        "Review exposure promptly with a veterinarian; this tool does not prescribe treatment.",
      ],
    };
  }
  if (tool === "gestation") {
    const v = gestationInput.parse(value),
      range =
        v.species === "cat"
          ? [65, 65]
          : v.basis === "ovulation"
            ? [62, 64]
            : [58, 72];
    return {
      version: TOOL_VERSION,
      reference: references.gestation,
      values: {
        earliest_estimated_date: shiftDay(v.date, range[0]),
        latest_estimated_date: shiftDay(v.date, range[1]),
        basis: v.basis,
      },
      notes: [
        v.species === "cat"
          ? "Approximate feline gestation estimate; not a guaranteed delivery date."
          : "The breeding-date window is wider than the ovulation-date window.",
        "Confirm pregnancy and delivery planning clinically.",
      ],
    };
  }
  throw new Error("Choose a supported calculator.");
}
