import type { QueryClient } from "@tanstack/react-query";
/** Call only after a confirmed or recovered source change, never from a query loader. */
export function refreshPatientReleases(cache: QueryClient, petId?: string) {
  // Shared chart/stock mutations can carry only a record ID. Invalidate all
  // mounted patient release queries when their patient cannot be inferred.
  const scope = petId ? [petId] : [];
  return Promise.all([
    cache.invalidateQueries({ queryKey: ["release-candidates-v9", ...scope] }),
    cache.invalidateQueries({ queryKey: ["release-candidates-v10", ...scope] }),
    cache.invalidateQueries({ queryKey: ["release-candidates-v11", ...scope] }),
    cache.invalidateQueries({ queryKey: ["release-candidates-v13", ...scope] }),
    cache.invalidateQueries({ queryKey: ["patient-record-releases", ...scope] }),
  ]);
}
