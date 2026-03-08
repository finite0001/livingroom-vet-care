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
        .from("app_settings")
        .select("value")
        .eq("key", `email_signature_${userId}`)
        .maybeSingle();
      if (error) throw error;
      return (data?.value as string) || null;
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
        .from("app_settings")
        .upsert({ key: `email_signature_${profile.id}`, value: signature || "" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-signature", profile?.id] });
    },
  });
}
