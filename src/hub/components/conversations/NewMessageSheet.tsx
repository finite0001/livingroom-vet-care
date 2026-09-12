import { useMessageQueue } from "@/hub/hooks/use-message-queue";
import { useAuth } from "@/hub/contexts/AuthContext";
import { useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageRecoveryPanel } from "./MessageRecoveryPanel";
import type { MessageIntent } from "@/hub/features/communications/queue-intent";
interface NewMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function NewMessageSheet(props: NewMessageSheetProps) {
  const { session } = useAuth();
  return <NewMessageContent key={session?.user.id} {...props} />;
}
function NewMessageContent({ open, onOpenChange }: NewMessageSheetProps) {
  const { session } = useAuth();
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<"SMS" | "EMAIL">("SMS");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [restored, setRestored] = useState<MessageIntent>();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const queue = useMessageQueue("new-message", open);
  const client = useQueryClient();
  const lookup = useQuery({
    queryKey: ["message-households", session?.user.id, search],
    enabled: open && search.trim().length >= 2 && !selected,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("search_clients", { p_search: search.trim(), p_limit: 8 })
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const busy = sending || queue.pending;
  const blocked =
    !!queue.recovery && (queue.recovery.status !== "prepared" || !restored);
  const reset = () => {
    setRecipient("");
    setBody("");
    setSubject("");
    setSearch("");
    setSelected(null);
    setRestored(undefined);
    setChannel("SMS");
  };
  const restore = async (saved: MessageIntent) => {
    const { data: thread, error } = await supabase
      .from("conversations")
      .select("client_id")
      .eq("id", saved.conversation_id)
      .single();
    if (error) throw error;
    const { data: household, error: householdError } = await supabase
      .from("clients")
      .select("id,full_name")
      .eq("id", thread.client_id)
      .single();
    if (householdError) throw householdError;
    setSelected(household.id);
    setSearch(household.full_name);
    setRecipient(saved.to);
    setChannel(saved.channel);
    setSubject(saved.subject);
    setBody(saved.body);
    setRestored(saved);
  };
  const send = async () => {
    if (
      sendingRef.current ||
      blocked ||
      !selected ||
      !recipient ||
      !body.trim()
    )
      return;
    sendingRef.current = true;
    setSending(true);
    try {
      let payload: MessageIntent;
      if (restored && queue.recovery) payload = restored;
      else {
        const { data, error } = await supabase.rpc(
          "ensure_active_conversation",
          { p_client_id: selected },
        );
        if (error) throw error;
        payload = {
          conversation_id: data.id,
          channel,
          to: recipient,
          subject: channel === "EMAIL" ? subject : "",
          body,
          attachment_ids: [],
        };
      }
      const result = await queue.send(payload);
      toast.success(`Message recorded: ${result.state}`);
      await client.invalidateQueries({ queryKey: ["conversations"] });
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Queue confirmation unavailable. Recover the saved request.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New message</SheetTitle>
          <SheetDescription>
            Choose an existing household. SMS requires recorded consent.
          </SheetDescription>
        </SheetHeader>
        <div className="mx-auto mt-4 max-w-xl space-y-4">
          <MessageRecoveryPanel
            queue={queue}
            hasDraft={!!body || !!subject}
            onRestore={restore}
            onAcknowledged={(saved) => {
              if (
                saved &&
                saved.body === body &&
                saved.subject === subject &&
                saved.channel === channel &&
                saved.to === recipient
              )
                reset();
            }}
          />
          <Label htmlFor="new-message-household">Household</Label>
          <Input
            id="new-message-household"
            disabled={busy}
            value={search}
            placeholder="Search existing client..."
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
              setRecipient("");
              setRestored(undefined);
            }}
          />
          {!selected &&
            lookup.data?.map((h) => (
              <Button
                key={h.id}
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal text-left"
                disabled={busy}
                onClick={() => {
                  setSelected(h.id);
                  setSearch(h.full_name);
                  setRecipient(h.primary_phone ?? "");
                  setChannel("SMS");
                  setSubject("");
                  setRestored(undefined);
                }}
              >
                {h.full_name} · {h.primary_phone ?? "No phone recorded"}
              </Button>
            ))}
          {lookup.isError && (
            <p role="alert" className="text-sm text-destructive">
              Household search unavailable. Try again.
            </p>
          )}
          <div>
            <Label htmlFor="new-message-recipient">Recipient ({channel})</Label>
            <Input id="new-message-recipient" value={recipient} readOnly />
          </div>
          {channel === "EMAIL" && (
            <div>
              <Label htmlFor="new-message-subject">Subject</Label>
              <Input
                id="new-message-subject"
                value={subject}
                disabled={busy}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setRestored(undefined);
                }}
              />
            </div>
          )}
          <Label htmlFor="new-message-body">Message</Label>
          <Textarea
            id="new-message-body"
            placeholder="Type message..."
            disabled={busy}
            value={body}
            rows={4}
            onChange={(e) => {
              setBody(e.target.value);
              setRestored(undefined);
            }}
          />
          <Button
            className="w-full"
            disabled={
              busy ||
              blocked ||
              !selected ||
              !recipient ||
              !body.trim() ||
              (channel === "EMAIL" && !subject.trim())
            }
            onClick={() => void send()}
          >
            {sending ? "Queueing…" : `Send ${channel}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
