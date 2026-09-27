import { Link } from "react-router-dom";
import { cloudtalkEnabled } from "@/config/cloudtalk";
import type { CloudTalkCall } from "./cloudtalk-db";
import { CallMediaControls } from "./CallMediaControls";
import { summarizeCall } from "./thread-entry";

interface CloudTalkCallEntryProps {
  call: CloudTalkCall | undefined;
  loading: boolean;
  failed: boolean;
}

/** Live CloudTalk call details under a thread entry. The stored entry text stays the record; this adds what arrived later. */
export function CloudTalkCallEntry({ call, loading, failed }: CloudTalkCallEntryProps) {
  if (!call) {
    if (loading) return <p className="mt-1 text-xs text-muted-foreground">Loading call details…</p>;
    return <p className="mt-1 text-xs text-muted-foreground">{failed ? "Call details unavailable. Reload to retry." : "Call details are not available to you."}</p>;
  }
  const summary = summarizeCall(call);
  const facts = [
    summary.direction === "inbound" ? "Incoming" : summary.direction === "outbound" ? "Outgoing" : null,
    summary.durationText ? `Duration ${summary.durationText}` : null,
    call.recording_ready ? "Recording available" : null,
    call.transcript_ready ? "Transcript available" : null,
  ].filter(Boolean);
  return (
    <div className="mt-1 space-y-1 text-sm">
      {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>}
      {call.ai_summary && (
        <div>
          <p className="whitespace-pre-wrap">AI summary: {call.ai_summary}</p>
          <p className="text-xs text-muted-foreground">AI-generated. Verify against the call before using in a clinical decision.</p>
        </div>
      )}
      {(call.recording_ready || call.transcript_ready) && (
        <p className="text-xs text-muted-foreground">Recordings and transcripts open for administrators only.{cloudtalkEnabled && <> <Link className="underline" to="/hub/call">Phone activity</Link></>}</p>
      )}
      <CallMediaControls call={call} />
    </div>
  );
}
