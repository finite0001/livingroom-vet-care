import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type OutboundDeliveryStatus = Database["public"]["Enums"]["outbound_delivery_status"];
export type OutboundDeliveryRow = Database["public"]["Tables"]["outbound_deliveries"]["Row"];

export const OUTBOUND_DELIVERY_STATUSES: OutboundDeliveryStatus[] = [
  "QUEUED",
  "LEASED",
  "ACCEPTED",
  "DELIVERED",
  "FAILED",
  "CANCELED",
  "UNKNOWN",
];

export interface OutboundDeliveryClient {
  id: string;
  full_name: string;
  primary_email: string | null;
  primary_phone: string | null;
}

export interface OutboundDeliveryConversation {
  id: string;
  status: string;
}

export interface OutboundDeliveryMessage {
  id: string;
  content: string | null;
  created_at: string;
  type: string;
}

export interface OutboundDeliveryWithDetails extends OutboundDeliveryRow {
  client: OutboundDeliveryClient | null;
  conversation: OutboundDeliveryConversation | null;
  message: OutboundDeliveryMessage | null;
}

interface OutboundDeliverySelectRow extends OutboundDeliveryRow {
  client: OutboundDeliveryClient | OutboundDeliveryClient[] | null;
  conversation: OutboundDeliveryConversation | OutboundDeliveryConversation[] | null;
  message: OutboundDeliveryMessage | OutboundDeliveryMessage[] | null;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapOutboundDelivery(row: OutboundDeliverySelectRow): OutboundDeliveryWithDetails {
  return {
    ...row,
    client: firstRelation(row.client),
    conversation: firstRelation(row.conversation),
    message: firstRelation(row.message),
  };
}

export function outboundDeliveryStatusLabel(status: OutboundDeliveryStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function deliveryPayloadText(payload: Json): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, Json>;
  const value = record.body ?? record.text ?? record.subject ?? record.kind;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function useOutboundDeliveries(status: OutboundDeliveryStatus | "ALL" = "ALL") {
  return useQuery<OutboundDeliveryWithDetails[]>({
    queryKey: ["outbound-deliveries", status],
    staleTime: 20 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      let query = supabase
        .from("outbound_deliveries")
        .select(`
          id,
          accepted_at,
          appointment_reminder_id,
          attempt_count,
          canceled_at,
          channel,
          client_id,
          conversation_id,
          created_at,
          delivered_at,
          failed_at,
          idempotency_key,
          last_error_text,
          lease_owner,
          leased_at,
          leased_until,
          max_attempts,
          message_id,
          next_attempt_at,
          payload,
          provider,
          provider_message_id,
          recipient,
          requested_by,
          scheduled_at,
          status,
          status_note,
          unknown_at,
          updated_at,
          client:clients (
            id,
            full_name,
            primary_email,
            primary_phone
          ),
          conversation:conversations (
            id,
            status
          ),
          message:messages (
            id,
            content,
            created_at,
            type
          )
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (status !== "ALL") {
        query = query.eq("status", status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => mapOutboundDelivery(row));
    },
  });
}

export function isOutboundDeliveryRetryable(status: OutboundDeliveryStatus): boolean {
  return status === "FAILED" || status === "UNKNOWN";
}

export function isOutboundDeliveryCancelable(status: OutboundDeliveryStatus): boolean {
  return status === "QUEUED";
}

export interface OutboundDeliveryActionInput {
  id: string;
  updated_at: string;
}

export function useRetryOutboundDelivery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updated_at }: OutboundDeliveryActionInput) => {
      const { data, error } = await supabase.rpc("retry_outbound_delivery", {
        p_delivery_id: id,
        p_expected_updated_at: updated_at,
        p_requested_at: new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["outbound-deliveries"] });
    },
  });
}

export function useCancelOutboundDelivery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updated_at }: OutboundDeliveryActionInput) => {
      const { data, error } = await supabase.rpc("cancel_outbound_delivery", {
        p_delivery_id: id,
        p_expected_updated_at: updated_at,
        p_requested_at: new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["outbound-deliveries"] });
    },
  });
}
