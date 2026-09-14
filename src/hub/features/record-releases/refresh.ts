import type { QueryClient } from "@tanstack/react-query";
/** Call only after a confirmed or recovered source change, never from a query loader. */
export function refreshPatientReleases(cache: QueryClient, petId: string) {
  return Promise.all([
    cache.invalidateQueries({ queryKey: ["release-candidates-v9", petId] }),
    cache.invalidateQueries({ queryKey: ["patient-record-releases", petId] }),
  ]);
}
