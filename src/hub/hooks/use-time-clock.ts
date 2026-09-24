import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";

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

// A time entry joined with the staff member's display name (admin views).
export interface StaffTimeEntry extends TimeEntry {
  staff_name: string;
}

// Supabase caps a single select at 1000 rows; page with .range() so long
// date ranges are never silently truncated (totals/CSV must be complete).
const PAGE_SIZE = 1000;

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
      // Page through every matching row; a short page means we're done.
      const all: TimeEntry[] = [];
      for (let page = 0; ; page++) {
        let q = supabase.from("time_entries").select("*").eq("staff_id", profile!.id);
        if (fromIso) q = q.gte("clock_in_at", fromIso);
        if (toIso) q = q.lte("clock_in_at", toIso);
        const { data, error } = await q
          .order("clock_in_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data ?? []) as TimeEntry[];
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return all;
    },
  });
}

// Admin: entries across ALL staff within an optional date range, joined with
// the staff member's name. time_entries has no FK to profiles, so fetch names
// separately and map them in (same approach as use-admin-metrics).
export function useAllShiftsRange(fromIso: string | null, toIso: string | null, enabled: boolean) {
  return useQuery<StaffTimeEntry[]>({
    queryKey: ["time-clock", "all-range", fromIso, toIso],
    enabled,
    queryFn: async () => {
      const all: TimeEntry[] = [];
      for (let page = 0; ; page++) {
        let q = supabase.from("time_entries").select("*");
        if (fromIso) q = q.gte("clock_in_at", fromIso);
        if (toIso) q = q.lte("clock_in_at", toIso);
        const { data, error } = await q
          .order("clock_in_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data ?? []) as TimeEntry[];
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      // No is_active filter: deactivated staff can still have historical entries.
      const { data: profs, error: pErr } = await supabase.from("profiles").select("id, full_name");
      if (pErr) throw pErr;
      const nameById = new Map(((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
      return all.map((e) => ({ ...e, staff_name: nameById.get(e.staff_id) || "Staff" }));
    },
  });
}

// Admin: correct an entry's times/note. UPDATE is admin-only in RLS; a
// non-admin matches 0 rows with no error, so select the updated rows and
// treat an empty result as a failure rather than reporting a false success.
// Closed entries must stay closed (reopening would desync profiles.is_on_duty,
// which only the clock RPCs maintain); when this edit closes a previously open
// shift, sync is_on_duty=false here for the same reason.
export function useAdminUpdateTimeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, staff_id, clock_in_at, clock_out_at, note, wasOpen }: {
      id: string; staff_id: string; clock_in_at: string; clock_out_at: string | null; note: string | null; wasOpen: boolean;
    }) => {
      if (!wasOpen && !clock_out_at) throw new Error("Closed entries need a clock out time");
      const { data, error } = await supabase
        .from("time_entries")
        .update({ clock_in_at, clock_out_at, note })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("You don't have permission to edit this entry");
      if (wasOpen && clock_out_at) {
        // The partial unique index guarantees at most one open shift per staff,
        // so closing this one means they are off duty.
        const { error: dutyError } = await supabase.from("profiles").update({ is_on_duty: false }).eq("id", staff_id);
        if (dutyError) throw dutyError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-clock"] });
    },
  });
}

// Admin: delete an entry. Same RLS no-op detection as the update above.
// Deleting an open shift also clears is_on_duty (see useAdminUpdateTimeEntry).
export function useAdminDeleteTimeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, staff_id, wasOpen }: { id: string; staff_id: string; wasOpen: boolean }) => {
      const { data, error } = await supabase.from("time_entries").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("You don't have permission to delete this entry");
      if (wasOpen) {
        const { error: dutyError } = await supabase.from("profiles").update({ is_on_duty: false }).eq("id", staff_id);
        if (dutyError) throw dutyError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-clock"] });
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
