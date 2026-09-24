import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { denverInstant, shiftDay } from "./time";

export type AppointmentWithDetails = Tables<"appointments"> & {
  pets: { name: string | null; species: string | null } | null;
  clients: { full_name: string | null } | null;
  profiles: { full_name: string | null } | null;
};

export interface ScheduleDayResult {
  appointments: AppointmentWithDetails[];
  total: number | null;
}

/**
 * One practice day's appointments (count=1) or a span of days (week view),
 * newest ordering inside the day. Shared by the schedule page and the hub
 * home "Right now" hero so both read the same cache entry.
 */
export function useScheduleDay(day: string, count = 1) {
  return useQuery({
    queryKey: ["schedule", day, count],
    queryFn: async (): Promise<ScheduleDayResult> => {
      const { data, error, count: total } = await supabase
        .from("appointments")
        .select(
          "*,pets(name,species),clients(full_name),profiles!appointments_assigned_dvm_id_fkey(full_name)",
          { count: "exact" },
        )
        .gte("scheduled_at", denverInstant(`${day}T00:00`))
        .lt("scheduled_at", denverInstant(`${shiftDay(day, count)}T00:00`))
        .order("scheduled_at")
        .order("id");
      if (error) throw error;
      return { appointments: (data ?? []) as AppointmentWithDetails[], total };
    },
  });
}
