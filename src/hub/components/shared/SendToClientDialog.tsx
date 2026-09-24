import { deliveryErrorNote, isDeliveryAccepted } from "@/hub/lib/delivery-result";
import { useEffect, useRef, useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useClient } from "@/hub/hooks/use-client";
import { useClientConsent } from "@/hub/hooks/use-sms-consent";

interface SendToClientDialogProps {
  clientId: string;
  defaultSubject?: string;
  defaultBody?: string;
  /** Uncontrolled usage: render this element as the dialog trigger. */
  trigger?: React.ReactNode;
  /** Controlled usage: manage open state from the parent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

/**
 * Find the client's most recent ACTIVE conversation or create one, so the
 * message lands in the inbox thread. Mirrors NewMessageSheet's find-or-create.
 */
async function findOrCreateActiveConversation(clientId: string): Promise<string> {
  const { data: existing, error: findError } = await supabase
    .from("conversations")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "ACTIVE")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing.id;

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({ client_id: clientId, status: "ACTIVE", is_read: true })
    .select("id")
    .single();
  if (createError) throw createError;
  if (!created) throw new Error("Failed to create conversation");
  return created.id;
}

export function SendToClientDialog({
  clientId, defaultSubject = "", defaultBody = "", trigger, open, onOpenChange,
}: SendToClientDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const queryClient = useQueryClient();
  const { data: client, isFetched: clientFetched } = useClient(clientId);
  // Strict opt-in, matching the server's send-sms gate: SMS is offered only once
  // consent has actually been fetched AND there is an explicit opted_in=true row
  // for the client's primary phone (per-phone match, like the edge function).
  const { data: consent, isFetched: consentFetched } = useClientConsent(clientId);

  const [channel, setChannel] = useState<"SMS" | "EMAIL" | null>(null);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const phone = client?.primary_phone ?? null;
  const email = client?.primary_email ?? null;
  const smsAllowed =
    !!phone &&
    consentFetched &&
    consent?.opted_in === true &&
    normalizePhone(consent.phone_number ?? "") === normalizePhone(phone);
  const emailAllowed = !!email;
  const contactsFetched = clientFetched && consentFetched;

  const previouslyOpen = useRef(false);
  // Defaults populate only on opening, never when a parent rerenders mid-draft.
  useEffect(() => {
    const opening = isOpen && !previouslyOpen.current;
    previouslyOpen.current = isOpen;
    if (!opening || sendingRef.current) return;
    setSubject(defaultSubject);
    setBody(defaultBody);
    setChannel(null);
  }, [isOpen, defaultSubject, defaultBody]);

  // Pick a default channel once we know what's actually allowed.
  useEffect(() => {
    if (!isOpen || channel !== null || !contactsFetched) return;
    if (smsAllowed) setChannel("SMS");
    else if (emailAllowed) setChannel("EMAIL");
  }, [isOpen, channel, contactsFetched, smsAllowed, emailAllowed]);

  const smsDisabledReason = !phone
    ? "No phone number on file"
    : !smsAllowed
      ? "No SMS consent on record for this number"
      : null;
  const emailDisabledReason = !email ? "No email address on file" : null;
  const nothingAllowed = contactsFetched && !smsAllowed && !emailAllowed;

  const handleSend = async () => {
    if (!channel || !body.trim() || sendingRef.current) return;
    if ((channel === "SMS" && !smsAllowed) || (channel === "EMAIL" && !emailAllowed)) {
      toast.error("No permitted recipient is available for this channel");
      return;
    }
    if (channel === "EMAIL" && !subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const conversationId = await findOrCreateActiveConversation(clientId);
      if (channel === "SMS") {
        if (!phone) throw new Error("Client has no phone number");
        const { data, error } = await supabase.functions.invoke("send-sms", {
          body: { to: phone, body, conversation_id: conversationId },
        });
        if (error) throw error;
        if (!isDeliveryAccepted(data)) {
          toast.error(data?.note || data?.error || "Provider acceptance was not confirmed. Your draft has been kept.");
          return;
        }
        toast.success(data?.queued ? "SMS queued for delivery" : "SMS accepted by provider; delivery is not yet confirmed");
      } else {
        if (!email) throw new Error("Client has no email address");
        const { data, error } = await supabase.functions.invoke("send-email", {
          body: { to: email, subject, body, conversation_id: conversationId },
        });
        if (error) throw error;
        if (!isDeliveryAccepted(data)) {
          toast.error(data?.note || data?.error || "Provider acceptance was not confirmed. Your draft has been kept.");
          return;
        }
        toast.success(data?.queued ? "Email queued for delivery" : "Email accepted by provider; delivery is not yet confirmed");
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      setOpen(false);
    } catch (err) {
      toast.error(await deliveryErrorNote(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => { if (!sendingRef.current) setOpen(nextOpen); }}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to client</DialogTitle>
          <DialogDescription>
            {client ? `Message ${client.full_name} — it will appear in their inbox thread.` : "Message this client via SMS or email."}
          </DialogDescription>
        </DialogHeader>

        {!contactsFetched ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Channel</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={channel === "SMS" ? "default" : "outline"}
                  disabled={!smsAllowed || sending}
                  onClick={() => setChannel("SMS")}
                  className="flex-1 gap-1.5"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Text{phone ? ` ${phone}` : ""}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={channel === "EMAIL" ? "default" : "outline"}
                  disabled={!emailAllowed || sending}
                  onClick={() => setChannel("EMAIL")}
                  className="flex-1 gap-1.5"
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </Button>
              </div>
              {smsDisabledReason && <p className="text-xs text-muted-foreground">SMS unavailable: {smsDisabledReason.toLowerCase()}.</p>}
              {emailDisabledReason && <p className="text-xs text-muted-foreground">Email unavailable: {emailDisabledReason.toLowerCase()}.</p>}
              {nothingAllowed && (
                <p className="text-xs text-destructive">
                  This client can't be messaged yet — add a phone number with SMS consent or an email address on their profile.
                </p>
              )}
            </div>

            {channel === "EMAIL" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Subject</Label>
                <Input disabled={sending} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Message</Label>
              <Textarea disabled={sending} value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Type message…" />
            </div>

            <Button
              className="w-full"
              onClick={handleSend}
              disabled={!channel || !body.trim() || sending || (channel === "EMAIL" && !subject.trim())}
            >
              {sending ? "Sending…" : channel === "EMAIL" ? "Send email" : "Send text"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
