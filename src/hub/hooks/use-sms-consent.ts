import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SmsConsent {
  id: string;
  client_id: string;
  phone_number: string;
  opted_in: boolean;
  opted_in_at: string | null;
  opted_out_at: string | null;
  consent_method: string | null;
  consent_details: string | null;
  created_at: string;
  updated_at: string;
}

export function useClientConsent(clientId: string | undefined) {
  return useQuery({
    queryKey: ["sms-consent", clientId],
    enabled: !!clientId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<SmsConsent | null> => {
      if (!clientId) return null;
      const { data, error } = await supabase
        .from("sms_consent")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as SmsConsent | null;
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, phoneNumber, optedIn, method, details }: {
      clientId: string;
      phoneNumber: string;
      optedIn: boolean;
      method: "verbal" | "written" | "digital" | "implied";
      details?: string;
    }) => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("sms_consent")
        .upsert({
          client_id: clientId,
          phone_number: phoneNumber,
          opted_in: optedIn,
          opted_in_at: optedIn ? now : null,
          opted_out_at: optedIn ? null : now,
          consent_method: method,
          consent_details: details,
        }, { onConflict: "client_id,phone_number" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sms-consent", variables.clientId] });
    },
  });
}
