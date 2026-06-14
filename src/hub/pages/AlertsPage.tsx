import { useState } from "react";
import { AlertTriangle, Send, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAlerts, useSendAlert, useReachableClientCount } from "@/hub/hooks/use-alerts";

const ALERT_TYPES = ["Closure", "Emergency", "Weather advisory", "General notice"];

export default function AlertsPage() {
  usePageTitle("Alerts");
  const { data: alerts, isLoading } = useAlerts();
  const { data: reachable } = useReachableClientCount();
  const send = useSendAlert();
  const [alertType, setAlertType] = useState(ALERT_TYPES[0]);
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const count = reachable ?? 0;

  const handleSend = () => {
    send.mutate(
      { alert_type: alertType, message: message.trim() },
      {
        onSuccess: () => { toast.success(`Alert recorded for ${count} client${count === 1 ? "" : "s"}`); setMessage(""); setConfirmOpen(false); },
        onError: () => { toast.error("Failed to send alert"); setConfirmOpen(false); },
      },
    );
  };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Urgent Alerts</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {/* Compose */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Send an urgent alert</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Type</Label>
              <Select value={alertType} onValueChange={setAlertType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ALERT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="e.g. The clinic is closed today due to weather. We'll reschedule affected appointments." />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="h-4 w-4" /> Reaches <span className="font-medium tabular-nums text-foreground">{count}</span> clients with a phone on file</div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Records the alert now; actual SMS broadcast activates once Twilio is connected.</p>
            <Button className="w-full gap-2" disabled={!message.trim() || send.isPending} onClick={() => setConfirmOpen(true)}>
              <Send className="h-4 w-4" /> Send alert
            </Button>
          </CardContent>
        </Card>

        {/* History */}
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</p>
          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
          ) : !alerts || alerts.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No alerts sent yet.</p>
          ) : (
            alerts.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600">{a.alert_type}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{a.recipient_count} recipients · {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{a.message}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this alert?</AlertDialogTitle>
            <AlertDialogDescription>This records an urgent "{alertType}" alert for {count} client{count === 1 ? "" : "s"}. It will be broadcast via SMS once delivery is connected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={send.isPending} onClick={handleSend}>{send.isPending ? "Sending…" : "Send"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
