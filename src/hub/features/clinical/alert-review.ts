import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import {
  decodePatientAlertReview,
  type PatientAlertReview,
} from "./alert-review-policy";
interface AlertDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      read_patient_treatment_alerts: {
        Args: { p_pet_id: string };
        Returns: PatientAlertReview;
      };
    };
  };
}
const alerts = supabase as unknown as SupabaseClient<AlertDatabase>;
export const patientProblemsKey = (petId: string) =>
  ["patient-problems", petId] as const;
export function usePatientAlertReview(petId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...patientProblemsKey(petId), "alert-review", user?.id],
    enabled: Boolean(petId && user),
    retry: false,
    queryFn: async () => {
      const { data, error } = await alerts.rpc(
        "read_patient_treatment_alerts",
        { p_pet_id: petId },
      );
      if (error) throw error;
      return decodePatientAlertReview(data, petId);
    },
  });
}
