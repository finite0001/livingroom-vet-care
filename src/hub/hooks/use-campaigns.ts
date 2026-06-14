import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Campaign {
  id: string;
  name: string;
  message_content: string;
  channel: string;
  audience_filter: Record<string, unknown>;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export interface AudienceClient { id: string; full_name: string; }

export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, message_content, channel, audience_filter, status, total_recipients, sent_count, failed_count, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });
}

const normalizePhone = (p: string) => p.replace(/\D/g, "");

// Resolve the recipient set for a channel + filter. SMS is consent-gated exactly
// like send-sms: a client is eligible only if their primary_phone matches an
// sms_consent row with opted_in=true (per-PHONE, not per-client — a stale opt-in
// on a different number must not qualify the current number). EMAIL requires an
// email on file. The consent query is scoped to the loaded clients so it can't
// silently truncate at the 1000-row cap.
export function useCampaignAudience(channel: string, onlyPreferred: boolean) {
  return useQuery<AudienceClient[]>({
    queryKey: ["campaign-audience", channel, onlyPreferred],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data: clients, error } = await supabase
        .from("clients")
        .select("id, full_name, primary_phone, primary_email, preferred_channel")
        .limit(1000);
      if (error) throw error;
      const list = clients ?? [];

      if (channel === "SMS") {
        const withPhone = list.filter((c) => !!c.primary_phone);
        if (withPhone.length === 0) return [];
        const { data: consent, error: cErr } = await supabase
          .from("sms_consent")
          .select("client_id, phone_number, opted_in")
          .eq("opted_in", true)
          .in("client_id", withPhone.map((c) => c.id));
        if (cErr) throw cErr;
        // client_id -> set of normalized opted-in numbers
        const optedNumbers = new Map<string, Set<string>>();
        for (const r of consent ?? []) {
          if (!r.phone_number) continue;
          const set = optedNumbers.get(r.client_id) ?? new Set<string>();
          set.add(normalizePhone(r.phone_number));
          optedNumbers.set(r.client_id, set);
        }
        let eligible = withPhone.filter((c) => optedNumbers.get(c.id)?.has(normalizePhone(c.primary_phone!)));
        if (onlyPreferred) eligible = eligible.filter((c) => c.preferred_channel === "SMS");
        return eligible.map((c) => ({ id: c.id, full_name: c.full_name }));
      }

      let eligible = list.filter((c) => !!c.primary_email);
      if (onlyPreferred) eligible = eligible.filter((c) => c.preferred_channel === "EMAIL");
      return eligible.map((c) => ({ id: c.id, full_name: c.full_name }));
    },
  });
}

export function useSendCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      message_content: string;
      channel: string;
      onlyPreferred: boolean;
      clientIds: string[];
      createdBy: string | null;
    }) => {
      const { data: campaign, error } = await supabase
        .from("campaigns")
        .insert({
          name: input.name,
          message_content: input.message_content,
          channel: input.channel,
          audience_filter: { channel: input.channel, only_preferred: input.onlyPreferred },
          status: "SENDING",
          total_recipients: input.clientIds.length,
          created_by: input.createdBy,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (input.clientIds.length) {
        const rows = input.clientIds.map((client_id) => ({ campaign_id: campaign.id, client_id }));
        const { error: rErr } = await supabase.from("campaign_recipients").insert(rows);
        if (rErr) {
          // Not transactional from the client: if recipients fail, don't leave a
          // SENDING campaign with no recipients — mark it CANCELLED (UPDATE is
          // allowed for active staff; DELETE is admin-only).
          await supabase.from("campaigns").update({ status: "CANCELLED" }).eq("id", campaign.id);
          throw rErr;
        }
      }
      return campaign;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}
