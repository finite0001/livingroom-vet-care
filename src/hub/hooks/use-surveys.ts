import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SurveyType = "NPS" | "STAR_RATING" | "THUMBS";
export const SURVEY_TYPES: SurveyType[] = ["NPS", "STAR_RATING", "THUMBS"];
export const surveyTypeLabel = (t: string) =>
  ({ NPS: "NPS (0–10)", STAR_RATING: "Star rating", THUMBS: "Thumbs up/down" } as Record<string, string>)[t] ?? t;

export interface Survey {
  id: string;
  name: string;
  survey_type: SurveyType;
  question: string;
  is_active: boolean;
  trigger_on_ticket_close: boolean;
  delay_hours: number;
  created_at: string;
}

export interface SurveyStat { responses: number; avgScore: number | null; }

export function useSurveys() {
  return useQuery<Survey[]>({
    queryKey: ["surveys"],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("surveys").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Survey[];
    },
  });
}

// Aggregate scored responses per survey in one query.
export function useSurveyStats() {
  return useQuery<Record<string, SurveyStat>>({
    queryKey: ["survey-stats"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("survey_responses").select("survey_id, score").not("score", "is", null);
      if (error) throw error;
      const acc: Record<string, { sum: number; n: number }> = {};
      for (const r of (data ?? []) as { survey_id: string; score: number }[]) {
        const e = acc[r.survey_id] ?? { sum: 0, n: 0 };
        e.sum += r.score; e.n += 1; acc[r.survey_id] = e;
      }
      const out: Record<string, SurveyStat> = {};
      for (const [id, e] of Object.entries(acc)) out[id] = { responses: e.n, avgScore: e.n ? Math.round((e.sum / e.n) * 10) / 10 : null };
      return out;
    },
  });
}

export function useCreateSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; survey_type: SurveyType; question: string; trigger_on_ticket_close: boolean; delay_hours: number }) => {
      const { error } = await supabase.from("surveys").insert(input);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["surveys"] }),
  });
}

export function useUpdateSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Survey>) => {
      const { error } = await supabase.from("surveys").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["surveys"] }),
  });
}

export function useDeleteSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("surveys").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Only admins can delete surveys");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["surveys"] }),
  });
}
