export interface PatientFormValues {
  name: string;
  species: string;
  breed: string;
  dob: string;
  birthDatePrecision: string;
  color: string;
  sex: string;
  neuterStatus: string;
  microchip: string;
  deceasedAt: string;
  archived: boolean;
}

export function practiceToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (part: string) => parts.find((entry) => entry.type === part)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function patientAge(dob: string | null, precision: string, today = practiceToday()): string {
  if (!dob || precision === "unknown" || !calendarDate(dob) || dob > today) return "Age unknown";
  const [year, month, day] = dob.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const years = currentYear - year - (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
  const months = (currentYear - year) * 12 + currentMonth - month - (currentDay < day ? 1 : 0);
  const age = years > 0 ? `${years} ${years === 1 ? "year" : "years"}` : months > 0 ? `${months} ${months === 1 ? "month" : "months"}` : "Under 1 month";
  return `${precision === "estimated" ? "Approximately " : ""}${age}`;
}

export function validatePatient(values: PatientFormValues, today = practiceToday()): string | null {
  if (!values.name.trim() || values.name.trim().length > 120) return "Enter a patient name of 1–120 characters.";
  if (!values.species.trim() || values.species.trim().length > 80) return "Enter a species of 1–80 characters.";
  if (values.breed.trim().length > 120 || values.color.trim().length > 120 || values.microchip.trim().length > 100) return "Breed and color must be at most 120 characters; microchip at most 100.";
  if (!["exact", "estimated", "unknown"].includes(values.birthDatePrecision)) return "Select a birthdate precision.";
  if (values.birthDatePrecision !== "unknown" && (!calendarDate(values.dob) || values.dob > today)) return "Enter a valid birthdate that is not in the future, or choose unknown.";
  if (values.deceasedAt && (!calendarDate(values.deceasedAt) || values.deceasedAt > today || (values.birthDatePrecision !== "unknown" && values.deceasedAt < values.dob))) return "Date of death must be valid, not in the future, and not before birth.";
  return null;
}

export function weightInKg(weight: number, unit: string): number {
  return unit === "lb" ? weight * 0.45359237 : weight;
}
