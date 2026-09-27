import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import type { CloudTalkCall } from "./cloudtalk-db";

interface TranscriptPage {
  data?: {
    language?: string;
    segments?: Array<{ start: number; caller: string; text: string }>;
  };
  pagination?: { offset: number; total: number };
}

/** Recording and transcript stay administrator-only; cloudtalk-call-media enforces the same rule server side. */
export function CallMediaControls({ call }: { call: Pick<CloudTalkCall, "call_uuid" | "recording_ready" | "transcript_ready"> }) {
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
