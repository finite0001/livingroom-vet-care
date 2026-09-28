import type { CatalogVaccineProfile } from "./api";

export function vaccineProfileQueryKey(productIds: readonly string[]) {
  return ["inventory", "vaccine-profiles", [...productIds].sort()] as const;
}

/** One-line catalog summary; values are label facts, never schedules. */
export function vaccineProfileSummary(
  profile: CatalogVaccineProfile | undefined,
): string {
  if (!profile) return "Vaccine information not recorded";
  const parts = [
    profile.group_key && `group ${profile.group_key}`,
    profile.species.length > 0 && profile.species.join("/"),
    profile.labeled_duration && `labeled ${profile.labeled_duration}`,
    profile.default_booster_interval_days &&
      `default interval ${profile.default_booster_interval_days} days`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Vaccine information recorded";
}
