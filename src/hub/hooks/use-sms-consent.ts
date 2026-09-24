import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
export interface SmsConsent {
  id: string | null;
  client_id: string;
  phone_number: string | null;
  opted_in: boolean;
  can_message: boolean;
  opted_in_at?: string | null;
  opted_out_at?: string | null;
  consent_method?: string | null;
  consent_details?: string | null;
  updated_at: string | null;
}
export function useClientConsent(clientId: string | undefined) {
  const {session}=useAuth();
  return useQuery({
    queryKey: ["sms-consent", session?.user.id, clientId],
    enabled: !!clientId && !!session?.user.id,
    staleTime: 15000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<SmsConsent | null> => {
      if (!clientId) return null;
      const { data, error } = await supabase.rpc("current_sms_consent",{p_client_id:clientId});
      if (error) throw error;
      return data as unknown as SmsConsent;
    },
  });
}
export function useUpdateConsent() {
  const queryClient = useQueryClient();
  const {session}=useAuth();
  return useMutation({
    mutationFn: async ({ clientId, phoneNumber, optedIn, method, details, expectedUpdatedAt }: {
      clientId: string; phoneNumber: string; optedIn: boolean;
      method: "VERBAL" | "WRITTEN" | "WEB_FORM"; details: string; expectedUpdatedAt: string | null;
    }) => {
      if (!session?.user.id) throw new Error("Sign in before recording consent.");
      const { data, error } = await supabase.rpc("record_sms_consent", {
        p_actor_id:session.user.id,p_client_id:clientId,p_phone:phoneNumber,p_opted_in:optedIn,
        p_method:method,p_details:details,p_expected_updated_at:expectedUpdatedAt ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["sms-consent"] }); },
  });
}
