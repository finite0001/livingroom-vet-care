import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Link } from "react-router-dom";
import { ExternalLink, Phone } from "lucide-react";
import { cloudtalkDb, cloudtalkRpc } from "./cloudtalk-db";
import { retryResult } from "./thread-entry";
import { CallMediaControls } from "./CallMediaControls";
import { useCloudTalkThreadLinks, type CloudTalkThreadLink } from "./use-cloudtalk-thread";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

function ThreadLink({ link }: { link: CloudTalkThreadLink | undefined }) {
  if (!link) return null;
  if (link.conversation_id && link.message_id) return <Link className="text-xs text-primary underline" to={`/hub/conversation/${link.conversation_id}`}>Open household thread</Link>;
  return <Link className="text-xs text-primary underline" to="/hub/inbox/review">Needs household review</Link>;
}

/** CloudTalk items that could not be added to the inbox. Originals are kept; only an administrator can re-run. */
function ProjectionFailures() {
  const { hasRole } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const failures = useQuery({
    queryKey: ["cloudtalk-projection-failures"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await cloudtalkDb.from("cloudtalk_projection_failures").select("resource_id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
  if (!failures.data) return null;
  const retry = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const { data, error } = await cloudtalkRpc.rpc("retry_cloudtalk_projections", { p_limit: 100 });
      if (error) throw error;
      const result = retryResult(data);
      setStatus(result ? `Added ${result.projected} to the inbox; ${result.still_failing} still need attention.` : "Retry finished. Reload to see the current state.");
      await failures.refetch();
    } catch {
      setStatus("Retry failed. Try again or contact support.");
    } finally { setBusy(false); }
  };
  return <div role="status" className="rounded-md border border-warning p-3 text-sm">
    <p>{failures.data} CloudTalk {failures.data === 1 ? "item was" : "items were"} kept here but could not be added to the inbox.</p>
    {hasRole("ADMIN") && <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void retry()}>Retry adding to inbox</Button>}
    {status && <p className="mt-2">{status}</p>}
  </div>;
}

interface CloudTalkActivityPageProps {
  voicemailOnly?: boolean;
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

  const resourceIds = [
    ...(calls.data ?? []).map((call) => `call:${call.call_uuid}`),
    ...(messages.data ?? []).map((message) => `message:${message.message_id}`),
  ].sort();
  const links = useCloudTalkThreadLinks(resourceIds);
  return (
    <div className="space-y-5 p-4 md:p-6 md:pr-[436px]">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{voicemailOnly ? "Voicemail" : "CloudTalk phone"}</h1>
        <p className="text-sm text-muted-foreground">Calls and texts recorded by CloudTalk appear here after its signed webhook is connected. Each one is also added to the matching household thread in the inbox, or to unmatched review when the number does not identify one household.</p>
        <div className="flex flex-wrap gap-2">
          {voicemailOnly ? <Button asChild variant="outline"><Link to="/hub/call">Open phone</Link></Button> : <Button asChild variant="outline"><Link to="/hub/voicemails">Voicemail</Link></Button>}
          <Button asChild variant="outline"><a href="https://phone.cloudtalk.io" target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open CloudTalk in a new tab</a></Button>
        </div>
        {!voicemailOnly && <p className="text-xs text-muted-foreground min-[440px]:hidden">The embedded phone needs a screen at least 420 px wide. Use the CloudTalk tab on this device.</p>}
      </header>
      {!voicemailOnly && <ProjectionFailures />}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent {voicemailOnly ? "voicemail calls" : "calls"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {calls.isError && <p role="alert">Call activity could not be loaded. Try refreshing.</p>}
          {calls.isPending && <p>Loading calls…</p>}
          {calls.data?.length === 0 && <p className="text-sm text-muted-foreground">No calls recorded yet.</p>}
          {calls.data?.map((call) => <div key={call.call_uuid} className="flex items-start gap-3 border-t border-border pt-3 text-sm first:border-0 first:pt-0">
            <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p className="font-medium">{call.external_number ?? "Withheld number"}</p><p className="text-muted-foreground">{call.direction ?? "Call"} · {new Date(call.ended_at ?? call.last_event_at).toLocaleString()}{call.talking_seconds === 0 && !call.is_voicemail ? " · Not answered" : call.duration_seconds === null ? "" : ` · ${call.duration_seconds}s`}{call.is_voicemail ? " · Voicemail" : ""}{call.recording_ready ? " · Recording available" : ""}</p>{call.ai_summary && <div className="mt-2"><p className="whitespace-pre-wrap">AI summary: {call.ai_summary}</p><p className="text-xs text-muted-foreground">AI-generated. Verify against the call before using in a clinical decision.</p></div>}<ThreadLink link={links.data?.get(`call:${call.call_uuid}`)} /><CallMediaControls call={call} /></div>
          </div>)}
        </CardContent>
      </Card>
      {!voicemailOnly && <Card>
        <CardHeader><CardTitle className="text-base">Recent CloudTalk messages</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {messages.isError && <p role="alert">Message activity could not be loaded. Try refreshing.</p>}
          {messages.isPending && <p>Loading messages…</p>}
          {messages.data?.length === 0 && <p className="text-sm text-muted-foreground">No messages recorded yet.</p>}
          {messages.data?.map((message) => <div key={message.message_id} className="border-t border-border pt-3 text-sm first:border-0 first:pt-0"><p className="font-medium">{message.direction === "inbound" ? "From" : "To"} {message.external_number} · {message.channel.toUpperCase()}</p><p className="whitespace-pre-wrap break-words">{message.body || "Attachment or empty message"}</p><p className="text-xs text-muted-foreground">{new Date(message.occurred_at).toLocaleString()}</p><ThreadLink link={links.data?.get(`message:${message.message_id}`)} /></div>)}
        </CardContent>
      </Card>}
    </div>
  );
}
