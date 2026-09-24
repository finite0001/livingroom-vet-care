export interface ToothMeasurement {
  label: string;
  value_mm: number;
}
export interface ToothObservation {
  presence: string;
  findings: string;
  planned: string;
  performed: string;
  measurements: ToothMeasurement[];
}
export interface ToothQuadrant {
  label: string;
  teeth: string[];
}
export interface DentalChartData {
  [tooth: string]: ToothObservation;
}
export function dentalSpecies(species: string): "dog" | "cat" | "manual" {
  const value = species.trim().toLowerCase();
  return ["dog", "canine"].includes(value)
    ? "dog"
    : ["cat", "feline"].includes(value)
      ? "cat"
      : "manual";
}
export function toothQuadrants(
  species: string,
  dentition: string,
): ToothQuadrant[] {
  if (
    !["dog", "cat"].includes(species) ||
    !["adult", "deciduous"].includes(dentition)
  )
    return [];
  const upper =
    species === "dog"
      ? dentition === "adult"
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        : [1, 2, 3, 4, 6, 7, 8]
      : dentition === "adult"
        ? [1, 2, 3, 4, 6, 7, 8, 9]
        : [1, 2, 3, 4, 6, 7, 8];
  const lower =
    species === "dog"
      ? dentition === "adult"
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        : [1, 2, 3, 4, 6, 7, 8]
      : dentition === "adult"
        ? [1, 2, 3, 4, 7, 8, 9]
        : [1, 2, 3, 4, 7, 8];
  const bases =
    dentition === "adult" ? [100, 200, 400, 300] : [500, 600, 800, 700];
  return [
    "Patient right · maxillary",
    "Patient left · maxillary",
    "Patient right · mandibular",
    "Patient left · mandibular",
  ].map((label, index) => ({
    label,
    teeth: (index < 2 ? upper : lower)
      .map((number) => String(bases[index] + number))
      .sort((a, b) =>
        index % 2 === 0 ? Number(b) - Number(a) : Number(a) - Number(b),
      ),
  }));
}
export function emptyTooth(): ToothObservation {
  return {
    presence: "not_recorded",
    findings: "",
    planned: "",
    performed: "",
    measurements: [],
  };
}
export function validateDentalData(data: DentalChartData): string | null {
  for (const row of Object.values(data)) {
    for (const measurement of row.measurements) {
      if (
        !measurement.label.trim() ||
        !Number.isFinite(measurement.value_mm) ||
        measurement.value_mm <= 0
      )
        return "Each measurement needs a site/description and a finite value greater than zero.";
    }
  }
  return null;
}
