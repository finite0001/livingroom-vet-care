import { Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { useCallLogs, type CallLog } from "@/hub/hooks/use-telephony";

function fmtDuration(s: number | null) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function otherParty(c: CallLog) {
  return c.call_type === "inbound" ? c.from_number : c.to_number;
}

const STATUS_TONE: Record<string, string> = {
  completed: "text-green-600",
  "no-answer": "text-amber-600",
  busy: "text-amber-600",
  failed: "text-destructive",
  canceled: "text-muted-foreground",
};

export default function CallPage() {
  usePageTitle("Phone");
  const { data: calls, isLoading } = useCallLogs();

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Phone</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Your call history. Live calling (click-to-call, in-browser calls) activates once Twilio Voice is connected.
        </p>

        {isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
        ) : !calls || calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Phone className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No calls yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Calls will appear here once telephony is connected.</p>
          </div>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {calls.map((c) => {
                const inbound = c.call_type === "inbound";
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", inbound ? "bg-green-500/10" : "bg-primary/10")}>
                      {inbound ? <PhoneIncoming className="h-4 w-4 text-green-600" /> : <PhoneOutgoing className="h-4 w-4 text-primary" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium tabular-nums">{otherParty(c) || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground capitalize">{c.call_type} · {fmtDuration(c.duration_seconds)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[c.status])}>{c.status.replace(/-/g, " ")}</Badge>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
