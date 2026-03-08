import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClientWithPets {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  preferred_channel: string | null;
  ezyvet_id: string | null;
  created_at: string;
  pets: {
    id: string;
    name: string;
    species: string;
    breed: string | null;
    weight_lbs: number | null;
    client_id: string;
    created_at: string;
    dob: string | null;
    allergies: string | null;
    medications: string | null;
    vaccination_notes: string | null;
    microchip_id: string | null;
    last_visit_at: string | null;
  }[];
}

export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ClientWithPets[]> => {
      const [clientsRes, petsRes] = await Promise.all([
        supabase.from("clients").select("*").order("last_name"),
        supabase.from("pets").select("*"),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      if (petsRes.error) throw petsRes.error;

      const petsByClient = new Map<string, typeof petsRes.data>();
      for (const pet of petsRes.data) {
        const arr = petsByClient.get(pet.client_id) || [];
        arr.push(pet);
        petsByClient.set(pet.client_id, arr);
      }

      return clientsRes.data.map((c) => ({
        ...c,
        pets: petsByClient.get(c.id) || [],
      }));
    },
  });
}
