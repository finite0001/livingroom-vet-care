import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];
type AppointmentRow = Database["public"]["Tables"]["appointments"]["Row"];

export const APPOINTMENT_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];

export interface AppointmentClient {
  id: string;
  full_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  housecall_address: string | null;
}

export interface AppointmentPet {
  id: string;
  name: string;
  species: string;
  breed: string | null;
}

export interface AppointmentDvm {
  id: string;
  full_name: string;
}

export interface AppointmentWithDetails extends AppointmentRow {
  client: AppointmentClient | null;
  pet: AppointmentPet | null;
  assigned_dvm: AppointmentDvm | null;
}

export interface AppointmentFormInput {
  appointment_type: string;
  assigned_dvm_id: string | null;
  client_id: string;
  duration_minutes: number;
  notes: string | null;
  pet_id: string | null;
  scheduled_at: string;
  status: AppointmentStatus;
}

export interface UpdateAppointmentInput extends AppointmentFormInput {
  expected_version: number;
  id: string;
}

export interface CancelAppointmentInput {
  expected_version: number;
  id: string;
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function localDayBounds(day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return { start, end };
}

export function useAppointmentsForDay(day: Date) {
  const dateKey = format(day, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["appointments", "day", dateKey],
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AppointmentWithDetails[]> => {
      const { start, end } = localDayBounds(day);
      const { data, error } = await supabase
        .from("appointments")
        .select(`
          id,
          appointment_type,
          assigned_dvm_id,
          client_id,
          created_at,
          created_by,
          duration_minutes,
          ezyvet_appointment_id,
          notes,
          pet_id,
          scheduled_at,
          status,
          updated_at,
          updated_by,
          version,
          client:clients (
            id,
            full_name,
            primary_phone,
            primary_email,
            housecall_address
          ),
          pet:pets (
            id,
            name,
            species,
            breed
          ),
          assigned_dvm:profiles!appointments_assigned_dvm_id_fkey (
            id,
            full_name
          )
        `)
        .gte("scheduled_at", start.toISOString())
        .lt("scheduled_at", end.toISOString())
        .order("scheduled_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as AppointmentWithDetails[];
    },
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AppointmentFormInput) => {
      const { data, error } = await supabase.rpc("save_appointment", {
        p_id: null,
        p_expected_version: null,
        p_client_id: input.client_id,
        p_pet_id: input.pet_id,
        p_scheduled_at: input.scheduled_at,
        p_duration_minutes: input.duration_minutes,
        p_appointment_type: input.appointment_type,
        p_status: input.status,
        p_assigned_dvm_id: input.assigned_dvm_id,
        p_notes: input.notes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appointments"] }),
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, expected_version, ...input }: UpdateAppointmentInput) => {
      const { error } = await supabase.rpc("save_appointment", {
        p_id: id,
        p_expected_version: expected_version,
        p_client_id: input.client_id,
        p_pet_id: input.pet_id,
        p_scheduled_at: input.scheduled_at,
        p_duration_minutes: input.duration_minutes,
        p_appointment_type: input.appointment_type,
        p_status: input.status,
        p_assigned_dvm_id: input.assigned_dvm_id,
        p_notes: input.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appointments"] }),
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, expected_version }: CancelAppointmentInput) => {
      const { error } = await supabase.rpc("cancel_appointment", {
        p_id: id,
        p_expected_version: expected_version,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appointments"] }),
  });
}
