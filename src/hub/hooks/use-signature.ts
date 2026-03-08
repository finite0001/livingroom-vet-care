import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";

export function useSignature() {
  const { profile } = useAuth();
  const userId = profile?.id;

  return useQuery({
    queryKey: ["profile-signature", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("email_signature")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return data?.email_signature || null;
    },
    enabled: !!userId,
  });
}

export function useUpdateSignature() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (signature: string) => {
      if (!profile) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({ email_signature: signature || null })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-signature", profile?.id] });
    },
  });
}
