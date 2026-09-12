import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function usePatientProblems(petId: string) {
  return useQuery({ queryKey: ['patient-problems', petId], queryFn: async () => {
    const { data, error } = await supabase.from('patient_problems').select('*').eq('pet_id', petId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  } });
}

export function useClinicalEncounters(petId: string) {
  return useQuery({ queryKey: ['clinical-encounters', petId], queryFn: async () => {
    const { data, error } = await supabase.from('clinical_encounters').select('*').eq('pet_id', petId).order('visit_at', { ascending: false });
    if (error) throw error;
    return data;
  } });
}
