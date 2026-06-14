import { useState } from "react";
import { Megaphone, Plus, Users, Send, MessageSquare, Mail } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { useCampaigns, useCampaignAudience, useSendCampaign, type Campaign } from "@/hub/hooks/use-campaigns";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SCHEDULED: "bg-blue-500/10 text-blue-600",
  SENDING: "bg-amber-500/10 text-amber-600",
  COMPLETED: "bg-green-500/10 text-green-600",
  CANCELLED: "bg-destructive/10 text-destructive",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS_STYLES[status] ?? "bg-muted text-muted-foreground")}>{status}</span>;
}

export default function CampaignsPage() {
  usePageTitle("Campaigns");
  const { profile } = useAuth();
  const { data: campaigns, isLoading } = useCampaigns();
  const send = useSendCampaign();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("SMS");
  const [message, setMessage] = useState("");
  const [onlyPreferred, setOnlyPreferred] = useState(false);

  const { data: audience, isLoading: audienceLoading } = useCampaignAudience(channel, onlyPreferred);
  const recipientCount = audience?.length ?? 0;

  const reset = () => { setName(""); setChannel("SMS"); setMessage(""); setOnlyPreferred(false); };

  const handleSend = () => {
    if (!name.trim() || !message.trim()) { toast.error("Name and message are required"); return; }
    if (!audience || audience.length === 0) { toast.error("No eligible recipients for this audience"); return; }
    send.mutate(
      { name: name.trim(), message_content: message.trim(), channel, onlyPreferred, clientIds: audience.map((a) => a.id), createdBy: profile?.id ?? null },
      {
        onSuccess: () => { toast.success(`Campaign queued to ${audience.length} recipient${audience.length === 1 ? "" : "s"}`); setOpen(false); reset(); },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create campaign"),
      },
    );
  };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Campaigns</h1>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => { reset(); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> New</Button>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
        {isLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
        ) : !campaigns || campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Megaphone className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create a bulk SMS or email outreach to your clients.</p>
          </div>
        ) : (
          campaigns.map((c: Campaign) => (
            <Card key={c.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  {c.channel === "EMAIL" ? <Mail className="h-4 w-4 text-primary" /> : <MessageSquare className="h-4 w-4 text-primary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{c.message_content}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="flex items-center gap-1 text-sm font-medium tabular-nums"><Users className="h-3.5 w-3.5 text-muted-foreground" />{c.total_recipients}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
          <SheetHeader><SheetTitle>New campaign</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Campaign name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring wellness reminder" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi {{client_name}}, it's time for…" rows={5} />
              <p className="text-xs text-muted-foreground">Use {"{{client_name}}"}, {"{{pet_name}}"} as placeholders (applied at send time).</p>
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Only clients who prefer {channel === "EMAIL" ? "email" : "SMS"}</p>
                  <p className="text-xs text-muted-foreground">Otherwise include everyone reachable on this channel.</p>
                </div>
                <Switch checked={onlyPreferred} onCheckedChange={setOnlyPreferred} aria-label="Only preferred-channel clients" />
              </div>
              <div className="flex items-center gap-2 border-t pt-3 text-sm">
                <Users className="h-4 w-4 text-primary" />
                <span className="font-medium tabular-nums">{audienceLoading ? "…" : recipientCount}</span>
                <span className="text-muted-foreground">eligible recipient{recipientCount === 1 ? "" : "s"}</span>
              </div>
              {channel === "SMS" && (
                <p className="text-xs text-muted-foreground">Only clients with a phone number who have <span className="font-medium">opted in to SMS</span> are included (TCPA compliance).</p>
              )}
            </div>

            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Recipients are recorded and queued now. Actual {channel === "EMAIL" ? "email" : "SMS"} delivery activates once {channel === "EMAIL" ? "Resend" : "Twilio"} is connected.
            </p>

            <Button className="w-full gap-2" onClick={handleSend} disabled={send.isPending || audienceLoading || recipientCount === 0}>
              <Send className="h-4 w-4" />
              {send.isPending ? "Creating…" : `Send to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
