import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cloudtalkDb, type CloudTalkCall } from "./cloudtalk-db";

export interface CloudTalkThreadLink {
  resource_id: string;
  conversation_id: string | null;
  message_id: string | null;
}

/** Live call details for thread entries. Rows the viewer cannot read (RLS) are simply absent. */
export function useThreadCalls(callIds: string[]) {
  return useQuery({
    queryKey: ["cloudtalk-thread-calls", callIds],
    enabled: callIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await cloudtalkDb.from("cloudtalk_calls")
        .select("call_uuid,call_id,direction,external_number,internal_number,started_at,ended_at,duration_seconds,talking_seconds,is_voicemail,recording_ready,transcript_ready,ai_summary,ai_language,trusted_number,last_event_at")
        .in("call_uuid", callIds);
      if (error) throw error;
      return new Map<string, CloudTalkCall>((data ?? []).map((call) => [call.call_uuid, call]));
    },
  });
}

/** Where each CloudTalk original landed: a household thread, or the unmatched review queue. */
export function useCloudTalkThreadLinks(resourceIds: string[]) {
  return useQuery({
    queryKey: ["cloudtalk-thread-links", resourceIds],
    enabled: resourceIds.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("communication_inbound")
        .select("resource_id,conversation_id,message_id")
        .eq("provider", "cloudtalk")
        .in("resource_id", resourceIds);
      if (error) throw error;
      return new Map<string, CloudTalkThreadLink>((data ?? []).map((row) => [row.resource_id, row]));
    },
  });
}
