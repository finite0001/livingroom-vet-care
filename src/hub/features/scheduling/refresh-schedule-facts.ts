import type { QueryClient } from "@tanstack/react-query";
/** Refresh schedule signals without replacing any mounted clinical draft. */
export function refreshScheduleFacts(
  cache: QueryClient,
  actorId: string,
  petId: string | null,
  clientId: string,
) {
  for (const queryKey of [
    ["schedule"],
    ["hub-today"],
    ["next-visits"],
    ["household-360", actorId, clientId],
    ["timeline-360", actorId, "household", clientId],
    ...(petId
      ? [
          ["patient-360", actorId, petId],
          ["timeline-360", actorId, "patient", petId],
        ]
      : []),
  ]) {
    void cache.invalidateQueries({ queryKey });
  }
}
