import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClientWithPets } from "./use-clients";

export function useClient(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client", clientId],
    enabled: !!clientId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ClientWithPets | null> => {
      const { data: client, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientId!)
        .maybeSingle();
      if (error) throw error;
      if (!client) return null;

      const { data: pets, error: petsError } = await supabase
        .from("pets")
        .select("*")
        .eq("client_id", clientId!);
      if (petsError) throw petsError;

      return { ...client, pets: pets || [] };
    },
  });
}
