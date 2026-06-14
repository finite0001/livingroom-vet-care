import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";

export interface TimeEntry {
  id: string;
  staff_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  note: string | null;
  created_at: string;
}

export interface OnDutyStaff {
  id: string;
  full_name: string;
}

export function durationSeconds(entry: Pick<TimeEntry, "clock_in_at" | "clock_out_at">, now: number = Date.now()): number {
  const start = new Date(entry.clock_in_at).getTime();
  const end = entry.clock_out_at ? new Date(entry.clock_out_at).getTime() : now;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function useCurrentShift() {
  const { profile } = useAuth();
  return useQuery<TimeEntry | null>({
    queryKey: ["time-clock", "current", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("staff_id", profile!.id)
        .is("clock_out_at", null)
        .order("clock_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as TimeEntry) ?? null;
    },
  });
}

export function useClockIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clock_in");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-clock"] });
    },
  });
}

export function useClockOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clock_out");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-clock"] });
    },
  });
}

export function useMyShifts(days = 30) {
  const { profile } = useAuth();
  return useQuery<TimeEntry[]>({
    queryKey: ["time-clock", "mine", profile?.id, days],
    enabled: !!profile?.id,
    queryFn: async () => {
      const start = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("staff_id", profile!.id)
        .gte("clock_in_at", start)
        .order("clock_in_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });
}

// My shifts within an optional date range (for the detailed timesheet view).
// Shares the ["time-clock"] key namespace so clocking in/out refreshes it.
export function useMyShiftsRange(fromIso: string | null, toIso: string | null) {
  const { profile } = useAuth();
  return useQuery<TimeEntry[]>({
    queryKey: ["time-clock", "range", profile?.id, fromIso, toIso],
    enabled: !!profile?.id,
    queryFn: async () => {
      let q = supabase.from("time_entries").select("*").eq("staff_id", profile!.id);
      if (fromIso) q = q.gte("clock_in_at", fromIso);
      if (toIso) q = q.lte("clock_in_at", toIso);
      const { data, error } = await q
        .order("clock_in_at", { ascending: false })
        .limit(fromIso || toIso ? 500 : 100);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });
}

// Admin: who is currently on duty (profiles.is_on_duty maintained by clock in/out).
export function useOnDutyStaff(enabled: boolean) {
  return useQuery<OnDutyStaff[]>({
    queryKey: ["time-clock", "on-duty"],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_on_duty", true)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as OnDutyStaff[];
    },
  });
}
