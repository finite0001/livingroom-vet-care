import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TicketStatus = "OPEN" | "DVM_REVIEW" | "READY_FOR_SCHEDULING" | "CLOSED";
export type TicketFormType = "WELLNESS" | "ILLNESS" | "EUTHANASIA" | "HEALTH_CERTIFICATE";
export type PetSex = "MALE" | "FEMALE" | "UNKNOWN";

export interface Ticket {
  id: string;
  created_at: string;
  updated_at: string;
  conversation_id: string | null;
  form_type: TicketFormType;
  status: TicketStatus;
  client_name: string;
  client_contact: string;
  pet_name: string;
  species_breed: string | null;
  dob_age: string | null;
  sex: PetSex;
  rdvm: string | null;
  rdvm_records_requested: boolean;
  vaccine_status_reviewed: boolean;
  new_client: boolean;
  form_contract_sent: boolean;
  estimate_sent: boolean;
  dvm_review_needed: boolean;
  symptom_summary: string | null;
  consent_form_sent: boolean;
  confirm_with_jane: boolean;
  destination_country: string | null;
  travel_date: string | null;
  health_cert_form_sent: boolean;
  assigned_to_id: string | null;
  notes: string | null;
}

export const TICKET_STATUSES: TicketStatus[] = ["OPEN", "DVM_REVIEW", "READY_FOR_SCHEDULING", "CLOSED"];
export const TICKET_FORM_TYPES: TicketFormType[] = ["WELLNESS", "ILLNESS", "EUTHANASIA", "HEALTH_CERTIFICATE"];

export const statusLabel = (s: string) =>
  ({ OPEN: "Open", DVM_REVIEW: "DVM review", READY_FOR_SCHEDULING: "Ready", CLOSED: "Closed" } as Record<string, string>)[s] ?? s;
export const formTypeLabel = (t: string) =>
  ({ WELLNESS: "Wellness", ILLNESS: "Illness", EUTHANASIA: "Euthanasia", HEALTH_CERTIFICATE: "Health cert" } as Record<string, string>)[t] ?? t;

export function useTickets(status: TicketStatus | "ALL" = "ALL") {
  return useQuery<Ticket[]>({
    queryKey: ["tickets", status],
    staleTime: 20 * 1000,
    queryFn: async () => {
      let q = supabase.from("tickets").select("*").order("created_at", { ascending: false });
      if (status !== "ALL") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });
}

export function useTicket(id: string | undefined) {
  return useQuery<Ticket | null>({
    queryKey: ["ticket", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("tickets").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data as Ticket) ?? null;
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Ticket> & { form_type: TicketFormType; client_name: string; client_contact: string; pet_name: string }) => {
      const { data, error } = await supabase.from("tickets").insert(input).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Ticket>) => {
      const { error } = await supabase
        .from("tickets")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["ticket", vars.id] });
    },
  });
}
