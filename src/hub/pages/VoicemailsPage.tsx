import { AudioWaveform, Sparkles, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { useVoicemails, useMarkVoicemailRead, type Voicemail } from "@/hub/hooks/use-telephony";

function fmtDuration(s: number | null) {
  if (!s || s <= 0) return "";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function VoicemailCard({ vm, onMarkRead, marking }: { vm: Voicemail; onMarkRead: (id: string) => void; marking: boolean }) {
  const dur = fmtDuration(vm.recording_duration);
  return (
    <Card className={cn(!vm.is_read && "border-primary/40 bg-primary/5")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {!vm.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tabular-nums">{vm.from_number || "Unknown"}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(vm.created_at), { addSuffix: true })}{dur && ` · ${dur}`}
              </p>
            </div>
          </div>
          {!vm.is_read && (
            <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={marking} onClick={() => onMarkRead(vm.id)}>
              <Check className="h-3.5 w-3.5" /> Mark read
            </Button>
          )}
        </div>

        {vm.ai_summary && (
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles className="h-3 w-3" /> AI summary</p>
            <p className="text-sm">{vm.ai_summary}</p>
          </div>
        )}

        {vm.transcription ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{vm.transcription}</p>
        ) : vm.transcription_status === "pending" ? (
          <p className="text-xs italic text-muted-foreground">Transcribing…</p>
        ) : null}

        {vm.recording_url && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio controls preload="none" src={vm.recording_url} className="h-9 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

export default function VoicemailsPage() {
  usePageTitle("Voicemails");
  const { data: voicemails, isLoading } = useVoicemails();
  const markRead = useMarkVoicemailRead();

  const handleMarkRead = (id: string) => markRead.mutate(id, {
    onError: () => toast.error("Failed to mark as read"),
  });

  const unread = (voicemails ?? []).filter((v) => !v.is_read).length;

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Voicemails</h1>
        {unread > 0 && <Badge variant="secondary">{unread} new</Badge>}
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Voicemails with transcription and AI summaries appear here once Twilio Voice + recording are connected.
        </p>

        {isLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}</div>
        ) : !voicemails || voicemails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AudioWaveform className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No voicemails</p>
            <p className="mt-1 text-xs text-muted-foreground">New voicemails will land here.</p>
          </div>
        ) : (
          voicemails.map((vm) => <VoicemailCard key={vm.id} vm={vm} onMarkRead={handleMarkRead} marking={markRead.isPending} />)
        )}
      </div>
    </div>
  );
}
