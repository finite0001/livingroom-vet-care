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
    client_id: string;
    weight_lbs?: number | null;
    created_at?: string;
    dob?: string | null;
    allergies?: string | null;
    medications?: string | null;
    vaccination_notes?: string | null;
    microchip_id?: string | null;
    last_visit_at?: string | null;
  }[];
}

export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ClientWithPets[]> => {
      const { data: clients, error: clientsError } = await supabase
        .from("clients")
        .select("id, first_name, last_name, full_name, primary_phone, primary_email, preferred_channel, ezyvet_id, created_at")
        .order("last_name")
        .limit(250);
      if (clientsError) throw clientsError;
      if (!clients.length) return [];

      // Fetch pets only for the clients we actually loaded. The previous flat
      // .limit(1000) was decoupled from the clients .limit(250): once a practice
      // had >1000 pet rows, an arbitrary subset of loaded clients showed no pets.
      const clientIds = clients.map((c) => c.id);
      const { data: pets, error: petsError } = await supabase
        .from("pets")
        .select("id, client_id, name, species, breed")
        .in("client_id", clientIds);
      if (petsError) throw petsError;

      const petsByClient = new Map<string, NonNullable<typeof pets>>();
      for (const pet of pets ?? []) {
        const arr = petsByClient.get(pet.client_id) || [];
        arr.push(pet);
        petsByClient.set(pet.client_id, arr);
      }

      return clients.map((c) => ({
        ...c,
        pets: petsByClient.get(c.id) || [],
      }));
    },
  });
}
