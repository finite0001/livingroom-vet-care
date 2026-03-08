import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: "ADMIN" | "DVM" | "TECH" | "STAFF";
  is_active: boolean;
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name, role, is_active")
        .eq("is_active", true)
        .order("last_name");
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useDvms() {
  const { data: profiles, ...rest } = useProfiles();
  const dvms = profiles?.filter((p) => p.role === "DVM") ?? [];
  return { data: dvms, ...rest };
}

export function getDvmInitials(profile: Profile | undefined): string {
  if (!profile) return "?";
  return `${profile.first_name[0]}${profile.last_name[0]}`;
}
