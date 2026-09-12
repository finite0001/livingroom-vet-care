import { useMessageQueue } from "@/hub/hooks/use-message-queue";
import { useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MessageSquare, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useClients, type ClientWithPets } from "@/hub/hooks/use-clients";
import { cn } from "@/lib/utils";
import { getAvatarColor, getInitial } from "@/hub/lib/avatar-colors";
import { toast } from "sonner";

interface NewMessageSheetProps { open: boolean; onOpenChange: (open: boolean) => void; }

export function NewMessageSheet({ open, onOpenChange }: NewMessageSheetProps) {
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queue = useMessageQueue("new-message");
  const { data: clients } = useClients();

  const filteredClients = search.length >= 2 ? clients?.filter((c) => {
    const s = search.toLowerCase();
    return c.full_name.toLowerCase().includes(s) || c.primary_phone?.includes(s);
  }).slice(0, 5) : [];

  const selectClient = (client: ClientWithPets) => { setSelectedClientId(client.id); setRecipient(client.primary_phone || ""); setSearch(client.full_name); };


  const reset = () => {
    setRecipient(""); setBody(""); setSearch(""); setSelectedClientId(null);
  };

  const handleSend = async () => {
    if (!body.trim() || !recipient.trim() || sendingRef.current) return;
    if (!selectedClientId) { toast.error("Choose a household with recorded SMS consent first."); return; }
    sendingRef.current = true;
    setSending(true);
    try {
      const clientId = selectedClientId;

      const { data: conv, error } = await supabase.rpc("ensure_active_conversation", { p_client_id: clientId });
      if (error) throw error;

      const result = await queue.send({ conversation_id: conv.id, channel: "SMS", to: recipient, subject: "", body, attachment_ids: [] });
      toast.success(result.state === "pending" ? "SMS queued" : `Message recorded: ${result.state}`);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Queue confirmation unavailable; retry the unchanged draft.");
    } finally { sendingRef.current = false; setSending(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (sendingRef.current) return; onOpenChange(v); if (!v) reset(); }}>
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
        <SheetHeader><SheetTitle>New Message</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input disabled={sending} placeholder="Search existing client..." value={search} onChange={(e) => { setSearch(e.target.value); setSelectedClientId(null); }} className="pl-9 h-10" />
            {filteredClients && filteredClients.length > 0 && !selectedClientId && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {filteredClients.map((client) => (
                  <button disabled={sending} key={client.id} onClick={() => selectClient(client)} className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-accent text-sm">
                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", getAvatarColor(client.full_name))}>{getInitial(client.first_name)}</div>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{client.full_name}</p><p className="truncate text-xs text-muted-foreground">{client.primary_phone}</p></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Input readOnly placeholder="Phone number (e.g. +14155551234)" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="h-10" type="tel" />

          <p className="text-xs text-muted-foreground">Choose an existing household. To message a new client, create their household and record SMS consent in Clients first.</p>

          <Textarea disabled={sending} placeholder="Type message..." value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <Button onClick={handleSend} disabled={!body.trim() || !recipient.trim() || sending || !selectedClientId} className="w-full">
            <MessageSquare className="h-4 w-4 mr-2" /> {sending ? "Queueing..." : "Send SMS"}
          </Button>

        </div>
      </SheetContent>
    </Sheet>
  );
}
