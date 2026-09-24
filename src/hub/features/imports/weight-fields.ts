export interface WeightFields {
  weight: string;
  unit: string;
  measuredAt: string;
}
export function initialWeightFields(
  source: Record<string, unknown>,
): WeightFields {
  const weight =
    typeof source.weight === "number" || typeof source.weight === "string"
      ? String(source.weight)
      : "";
  const validWeight =
    /^\d+(\.\d+)?$/.test(weight) &&
    Number(weight) > 0 &&
    Number(weight) <= 10000;
  const unit =
    source.weight_unit === "kg" || source.weight_unit === "lb"
      ? source.weight_unit
      : "";
  const epoch =
    typeof source.timestamp === "number" || typeof source.timestamp === "string"
      ? Number(source.timestamp)
      : NaN;
  let measuredAt = "";
  if (Number.isFinite(epoch) && epoch > 0 && epoch * 1000 <= Date.now()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Denver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(epoch * 1000));
    measuredAt = ["year", "month", "day"]
      .map((type) => parts.find((p) => p.type === type)?.value)
      .join("-");
  }
  return { weight: validWeight ? weight : "", unit, measuredAt };
}
