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


// CloudTalk tables are read directly under their RLS policies (active staff;
// calls additionally require a trusted practice number).
export const cloudtalkDb = supabase;

export const cloudtalkRpc = supabase;

