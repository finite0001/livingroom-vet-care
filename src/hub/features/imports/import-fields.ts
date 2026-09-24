export interface ImportFields {
  [key: string]: string;
}
function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
export function sourceDate(value: unknown): string {
  const raw = string(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === raw
      ? raw
      : "";
  }
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) return "";
  const date = new Date(Number(raw) * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
export function initialImportFields(
  resource: string,
  source: Record<string, unknown>,
): ImportFields {
  if (resource === "contact")
    return {
      first_name: string(source.first_name),
      last_name: string(source.last_name),
      primary_phone: "",
      primary_email: "",
      mailing_address: "",
      housecall_address: "",
    };
  const dob = sourceDate(source.date_of_birth);
  return {
    name: string(source.name),
    species: "",
    breed: "",
    dob,
    birth_date_precision: dob
      ? source.is_estimated_date_of_birth === true ||
        source.is_estimated_date_of_birth === "1" ||
        source.is_estimated_date_of_birth === 1
        ? "estimated"
        : "exact"
      : "unknown",
    color: "",
    sex: "unknown",
    neuter_status: "unknown",
    microchip_id: string(source.microchip_number),
    deceased_at: sourceDate(source.date_of_death),
  };
}
export const fieldLabels: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  primary_phone: "Phone",
  primary_email: "Email",
  mailing_address: "Mailing address",
  housecall_address: "Housecall address",
  name: "Patient name",
  species: "Species",
  breed: "Breed",
  dob: "Birthday",
  birth_date_precision: "Birthday precision",
  color: "Color",
  sex: "Sex",
  neuter_status: "Neuter status",
  microchip_id: "Microchip",
  deceased_at: "Date of death",
};
export const fieldOptions: Record<string, string[]> = {
  birth_date_precision: ["unknown", "exact", "estimated"],
  sex: ["unknown", "male", "female"],
  neuter_status: ["unknown", "intact", "neutered"],
};
