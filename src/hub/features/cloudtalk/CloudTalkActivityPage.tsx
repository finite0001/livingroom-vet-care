import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import { ExternalLink, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hub/contexts/auth-context";

interface CloudTalkCall {
  call_uuid: string;
  call_id: string | null;
  direction: string | null;
  external_number: string | null;
  internal_number: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  is_voicemail: boolean;
  recording_ready: boolean;
  transcript_ready: boolean;
  ai_summary: string | null;
  ai_language: string | null;
  last_event_at: string;
}

interface CloudTalkMessage {
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
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

const cloudtalkDb = supabase as unknown as SupabaseClient<CloudTalkDatabase>;

interface CloudTalkActivityPageProps {
  voicemailOnly?: boolean;
}

interface TranscriptPage {
  data?: {
    language?: string;
    segments?: Array<{ start: number; caller: string; text: string }>;
  };
  pagination?: { offset: number; total: number };
}

function CallMediaControls({ call }: { call: CloudTalkCall }) {
  const { hasRole } = useAuth();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const load = async (kind: "recording" | "transcript", offset = 0) => {
    setBusy(true);
    setErrorText(null);
    try {
      const { data, error } = await supabase.functions.invoke("cloudtalk-call-media", {
        body: { call_uuid: call.call_uuid, kind, offset },
      });
      if (error) throw error;
      if (kind === "recording") {
        if (!(data instanceof Blob)) throw new Error("Recording response was unavailable");
        setAudioUrl(URL.createObjectURL(data));
      } else {
        setTranscript(data as TranscriptPage);
      }
    } catch {
      setErrorText(`Could not load the ${kind}. Check CloudTalk access or try again.`);
    } finally { setBusy(false); }
  };

  return <div className="mt-2 space-y-2">
    <div className="flex flex-wrap gap-2">
      {hasRole("ADMIN") && call.recording_ready && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load("recording")}>Play recording</Button>}
      {hasRole("ADMIN") && call.transcript_ready && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load("transcript")}>Read transcript</Button>}
    </div>
    {/* CloudTalk may produce a recording without a transcript; the separate transcript action is offered when available. */}
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    {audioUrl && <audio controls src={audioUrl} className="w-full max-w-sm" aria-label="Call recording" />}
    {transcript && <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-sm" aria-label="Call transcript">
      <p className="font-medium">Transcript {transcript.data?.language ? `(${transcript.data.language})` : ""}</p>
      {transcript.data?.segments?.map((segment, index) => <p key={`${segment.start}-${index}`}><span className="text-muted-foreground">{Math.floor(segment.start / 60)}:{String(Math.floor(segment.start % 60)).padStart(2, "0")} · {segment.caller}: </span>{segment.text}</p>)}
      {transcript.pagination && transcript.pagination.offset + (transcript.data?.segments?.length ?? 0) < transcript.pagination.total &&
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void load("transcript", transcript.pagination!.offset + 100)}>Next 100 segments</Button>}
    </div>}
    {errorText && <p role="alert" className="text-sm text-destructive">{errorText}</p>}
  </div>;
}

export default function CloudTalkActivityPage({ voicemailOnly = false }: CloudTalkActivityPageProps) {
  usePageTitle(voicemailOnly ? "Voicemail" : "CloudTalk phone");
  const calls = useQuery({
    queryKey: ["cloudtalk-calls", voicemailOnly],
    refetchInterval: 15_000,
    queryFn: async () => {
      let query = cloudtalkDb.from("cloudtalk_calls").select("*").not("ended_at", "is", null).order("last_event_at", { ascending: false }).limit(100);
      if (voicemailOnly) query = query.eq("is_voicemail", true);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
  const messages = useQuery({
    queryKey: ["cloudtalk-messages"],
    enabled: !voicemailOnly,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await cloudtalkDb.from("cloudtalk_messages").select("*").order("occurred_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-5 p-4 md:p-6 md:pr-[436px]">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{voicemailOnly ? "Voicemail" : "CloudTalk phone"}</h1>
        <p className="text-sm text-muted-foreground">Calls and texts recorded by CloudTalk appear here after its signed webhook is connected.</p>
        <div className="flex flex-wrap gap-2">
          {voicemailOnly ? <Button asChild variant="outline"><Link to="/hub/call">Open phone</Link></Button> : <Button asChild variant="outline"><Link to="/hub/voicemails">Voicemail</Link></Button>}
          <Button asChild variant="outline"><a href="https://phone.cloudtalk.io" target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open CloudTalk in a new tab</a></Button>
        </div>
        {!voicemailOnly && <p className="text-xs text-muted-foreground min-[440px]:hidden">The embedded phone needs a screen at least 420 px wide. Use the CloudTalk tab on this device.</p>}
      </header>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent {voicemailOnly ? "voicemail calls" : "calls"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {calls.isError && <p role="alert">Call activity could not be loaded. Try refreshing.</p>}
          {calls.isPending && <p>Loading calls…</p>}
          {calls.data?.length === 0 && <p className="text-sm text-muted-foreground">No calls recorded yet.</p>}
          {calls.data?.map((call) => <div key={call.call_uuid} className="flex items-start gap-3 border-t border-border pt-3 text-sm first:border-0 first:pt-0">
            <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p className="font-medium">{call.external_number ?? "Withheld number"}</p><p className="text-muted-foreground">{call.direction ?? "Call"} · {new Date(call.ended_at ?? call.last_event_at).toLocaleString()}{call.duration_seconds === null ? "" : ` · ${call.duration_seconds}s`}{call.is_voicemail ? " · Voicemail" : ""}{call.recording_ready ? " · Recording available" : ""}</p>{call.ai_summary && <div className="mt-2"><p className="whitespace-pre-wrap">AI summary: {call.ai_summary}</p><p className="text-xs text-muted-foreground">AI-generated. Verify against the call before using in a clinical decision.</p></div>}<CallMediaControls call={call} /></div>
          </div>)}
        </CardContent>
      </Card>
      {!voicemailOnly && <Card>
        <CardHeader><CardTitle className="text-base">Recent CloudTalk messages</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {messages.isError && <p role="alert">Message activity could not be loaded. Try refreshing.</p>}
          {messages.isPending && <p>Loading messages…</p>}
          {messages.data?.length === 0 && <p className="text-sm text-muted-foreground">No messages recorded yet.</p>}
          {messages.data?.map((message) => <div key={message.message_id} className="border-t border-border pt-3 text-sm first:border-0 first:pt-0"><p className="font-medium">{message.direction === "inbound" ? "From" : "To"} {message.external_number} · {message.channel.toUpperCase()}</p><p className="whitespace-pre-wrap break-words">{message.body || "Attachment or empty message"}</p><p className="text-xs text-muted-foreground">{new Date(message.occurred_at).toLocaleString()}</p></div>)}
        </CardContent>
      </Card>}
    </div>
  );
}
