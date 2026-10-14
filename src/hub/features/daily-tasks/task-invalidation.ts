import type { QueryClient } from "@tanstack/react-query";
export function refreshOperationalFacts(cache: QueryClient, actor: string) {
  void cache.invalidateQueries({ queryKey: ["operational", actor] });
}
