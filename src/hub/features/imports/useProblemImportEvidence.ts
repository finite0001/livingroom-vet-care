import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { readProblemProvenance } from "./history-api";
export function useProblemImportEvidence(petId: string, problemIds: string[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["problem-import-provenance", user?.id, petId, problemIds],
    enabled: !!user && problemIds.length > 0,
    retry: false,
    queryFn: async () => {
      const result: Awaited<ReturnType<typeof readProblemProvenance>> = [];
      for (let i = 0; i < problemIds.length; i += 50)
        result.push(
          ...(await readProblemProvenance(petId, problemIds.slice(i, i + 50))),
        );
      return result;
    },
  });
}
