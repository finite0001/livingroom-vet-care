import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export interface CloudTalkCall {
  call_uuid: string;
  call_id: string | null;
  direction: string | null;
  external_number: string | null;
  internal_number: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  talking_seconds: number | null;
  is_voicemail: boolean;
  recording_ready: boolean;
  transcript_ready: boolean;
  ai_summary: string | null;
  ai_language: string | null;
  trusted_number: boolean;
  last_event_at: string;
}

export interface CloudTalkProjectionFailure {
  resource_id: string;
  sqlstate: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
}

export interface CloudTalkMessage {
  message_id: string;
  direction: string;
  channel: string;
  external_number: string;
  internal_number: string;
  body: string;
  occurred_at: string;
}

interface CloudTalkDatabase {
  public: {
    Tables: {
      cloudtalk_calls: { Row: CloudTalkCall; Insert: CloudTalkCall; Update: Partial<CloudTalkCall>; Relationships: [] };
      cloudtalk_messages: { Row: CloudTalkMessage; Insert: CloudTalkMessage; Update: Partial<CloudTalkMessage>; Relationships: [] };
      cloudtalk_projection_failures: { Row: CloudTalkProjectionFailure; Insert: CloudTalkProjectionFailure; Update: Partial<CloudTalkProjectionFailure>; Relationships: [] };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

// CloudTalk tables are read directly under their RLS policies (active staff;
// calls additionally require a trusted practice number).
export const cloudtalkDb = supabase as unknown as SupabaseClient<CloudTalkDatabase>;

interface RetryDatabase {
  public: {
    Tables: Database["public"]["Tables"];
    Views: Database["public"]["Views"];
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
    Functions: { retry_cloudtalk_projections: { Args: Record<string, Json>; Returns: Json } };
  };
}
export const cloudtalkRpc = supabase as unknown as SupabaseClient<RetryDatabase>;

