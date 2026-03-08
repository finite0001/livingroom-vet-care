import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, MessageSquare, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useClients } from "@/hub/hooks/use-clients";
import { cn } from "@/lib/utils";
import { getAvatarColor, getInitial } from "@/hub/lib/avatar-colors";
import { toast } from "sonner";

interface NewMessageSheetProps { open: boolean; onOpenChange: (open: boolean) => void; }

export function NewMessageSheet({ open, onOpenChange }: NewMessageSheetProps) {
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: clients } = useClients();

  const filteredClients = search.length >= 2 ? clients?.filter((c) => {
    const s = search.toLowerCase();
    return c.full_name.toLowerCase().includes(s) || c.primary_phone?.includes(s);
  }).slice(0, 5) : [];

  const selectClient = (client: any) => { setSelectedClientId(client.id); setRecipient(client.primary_phone || ""); setSearch(client.full_name); };

  const handleSend = async () => {
    if (!body.trim() || !recipient.trim()) return;
    setSending(true);
    try {
      let clientId = selectedClientId;
      if (!clientId) {
        const { data: newClient, error: clientError } = await supabase
          .from("clients")
          .insert({ first_name: recipient, last_name: "", full_name: recipient, primary_phone: recipient, preferred_channel: "SMS" })
          .select("id").single();
        if (clientError) throw clientError;
        clientId = newClient?.id;
      }
      if (!clientId) throw new Error("Failed to resolve client");

      let { data: conv } = await supabase.from("conversations").select("id").eq("client_id", clientId).eq("status", "ACTIVE").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      if (!conv) {
        const { data: newConv, error: convError } = await supabase.from("conversations").insert({ client_id: clientId, status: "ACTIVE", is_read: true }).select("id").single();
        if (convError) throw convError;
        conv = newConv;
      }
      if (!conv) throw new Error("Failed to create conversation");

      const { error } = await supabase.functions.invoke("send-sms", { body: { to: recipient, body, conversation_id: conv.id } });
      if (error) throw error;
      toast.success("SMS sent");
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onOpenChange(false);
      setRecipient(""); setBody(""); setSearch(""); setSelectedClientId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally { setSending(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setRecipient(""); setBody(""); setSearch(""); setSelectedClientId(null); } }}>
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
        <SheetHeader><SheetTitle>New Message</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search existing client..." value={search} onChange={(e) => { setSearch(e.target.value); setSelectedClientId(null); }} className="pl-9 h-10" />
            {filteredClients && filteredClients.length > 0 && !selectedClientId && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {filteredClients.map((client) => (
                  <button key={client.id} onClick={() => selectClient(client)} className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-accent text-sm">
                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", getAvatarColor(client.full_name))}>{getInitial(client.first_name)}</div>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{client.full_name}</p><p className="truncate text-xs text-muted-foreground">{client.primary_phone}</p></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Input placeholder="Phone number (e.g. +14155551234)" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="h-10" type="tel" />
          <Textarea placeholder="Type your text message..." value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <Button onClick={handleSend} disabled={!body.trim() || !recipient.trim() || sending} className="w-full">
            <MessageSquare className="h-4 w-4 mr-2" /> {sending ? "Sending..." : "Send SMS"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
