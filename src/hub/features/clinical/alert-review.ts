import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import {
  decodePatientAlertReview,
} from "./alert-review-policy";
const alerts = supabase;
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
