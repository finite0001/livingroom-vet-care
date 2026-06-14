import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RefillStatus = "REQUESTED" | "APPROVED" | "DENIED" | "READY" | "PICKED_UP";

export const REFILL_STATUSES: RefillStatus[] = ["REQUESTED", "APPROVED", "READY", "PICKED_UP", "DENIED"];
export const refillStatusLabel = (s: string) =>
  ({ REQUESTED: "Requested", APPROVED: "Approved", READY: "Ready", PICKED_UP: "Picked up", DENIED: "Denied" } as Record<string, string>)[s] ?? s;

export interface Refill {
  id: string;
  client_id: string;
  pet_id: string | null;
  medication_name: string | null;
  status: RefillStatus;
  assigned_to_id: string | null;
  notes: string | null;
  requested_at: string;
  approved_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  created_at: string;
  client_name: string | null;
  pet_name: string | null;
}

export function useRefills(status: RefillStatus | "ALL" = "ALL") {
  return useQuery<Refill[]>({
    queryKey: ["refills", status],
    staleTime: 20 * 1000,
    queryFn: async () => {
      let q = supabase
        .from("refill_requests")
        .select("id, client_id, pet_id, medication_name, status, assigned_to_id, notes, requested_at, approved_at, ready_at, picked_up_at, created_at, clients(full_name), pets(name)")
        .order("requested_at", { ascending: false });
      if (status !== "ALL") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        client_name: r.clients?.full_name ?? null,
        pet_name: r.pets?.name ?? null,
      })) as Refill[];
    },
  });
}

export function useCreateRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { client_id: string; pet_id?: string | null; medication_name: string; notes?: string | null }) => {
      const { data, error } = await supabase.from("refill_requests").insert(input).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["refills"] }),
  });
}

export function useUpdateRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, assigned_to_id, notes }: { id: string; status?: RefillStatus; assigned_to_id?: string | null; notes?: string | null }) => {
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updated_at: now };
      if (status !== undefined) {
        updates.status = status;
        if (status === "APPROVED") updates.approved_at = now;
        if (status === "READY") updates.ready_at = now;
        if (status === "PICKED_UP") updates.picked_up_at = now;
      }
      if (assigned_to_id !== undefined) updates.assigned_to_id = assigned_to_id;
      if (notes !== undefined) updates.notes = notes;
      const { error } = await supabase.from("refill_requests").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["refills"] }),
  });
}
