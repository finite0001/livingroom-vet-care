import { MessageRecoveryPanel } from "@/hub/components/conversations/MessageRecoveryPanel";
import { useAuth } from "@/hub/contexts/auth-context";
import type { MessageIntent } from "@/hub/features/communications/queue-intent";
import { useMessageQueue } from "@/hub/hooks/use-message-queue";
import { useEffect, useRef, useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
async function findOrCreateActiveConversation(
  clientId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_active_conversation", {
    p_client_id: clientId,
  });
  if (error) throw error;
  return data.id;
}

export function SendToClientDialog(props: SendToClientDialogProps) {
  const { session } = useAuth();
  return (
    <SendToClientContent
      key={`${session?.user.id}:${props.clientId}`}
      {...props}
    />
  );
}
function SendToClientContent({
  clientId,
  defaultSubject = "",
  defaultBody = "",
  trigger,
  open,
  onOpenChange,
}: SendToClientDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const queryClient = useQueryClient();
  const queue = useMessageQueue(`client-dialog:${clientId}`, isOpen);
  const { data: client, isFetched: clientFetched } = useClient(clientId);
  // Strict opt-in, matching the server's send-sms gate: SMS is offered only once
  // consent has actually been fetched AND there is an explicit opted_in=true row
  // for the client's primary phone (per-phone match, like the edge function).
  const { data: consent, isFetched: consentFetched } =
    useClientConsent(clientId);

  const [channel, setChannel] = useState<"SMS" | "EMAIL" | null>(null);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [restored, setRestored] = useState<MessageIntent>();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const recoveryBlocksSend =
    !!queue.recovery && (queue.recovery.status !== "prepared" || !restored);
  const busy = sending || queue.pending;
  const phone = client?.primary_phone ?? null;
  const email = client?.primary_email ?? null;
  const smsAllowed =
    !!phone &&
    consentFetched &&
    consent?.can_message === true &&
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
    setRestored(undefined);
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
    if (!channel || !body.trim() || sendingRef.current || recoveryBlocksSend)
      return;
    if (
      !restored &&
      ((channel === "SMS" && !smsAllowed) ||
        (channel === "EMAIL" && !emailAllowed))
    ) {
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
      const conversationId =
        restored && queue.recovery
          ? restored.conversation_id
          : await findOrCreateActiveConversation(clientId);
      const to =
        restored && queue.recovery
          ? restored.to
          : channel === "SMS"
            ? phone
            : email;
      if (!to) throw new Error("Client has no recipient for this channel");
      const result = await queue.send({
        conversation_id: conversationId,
        channel,
        to,
        subject: channel === "EMAIL" ? subject : "",
        body,
        attachment_ids: [],
      });
      toast.success(
        result.state === "pending"
          ? "Message queued"
          : `Message recorded: ${result.state}`,
      );
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Queue confirmation unavailable; retry the unchanged draft.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!sendingRef.current && !queue.pending) setOpen(nextOpen);
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to client</DialogTitle>
          <DialogDescription>
            {client
              ? `Message ${client.full_name} — it will appear in their inbox thread.`
              : "Message this client via SMS or email."}
          </DialogDescription>
        </DialogHeader>

        <MessageRecoveryPanel
          queue={queue}
          hasDraft={!!body || !!subject}
          onRestore={async (saved) => {
            const { data, error } = await supabase
              .from("conversations")
              .select("client_id")
              .eq("id", saved.conversation_id)
              .single();
            if (error) throw error;
            if (data.client_id !== clientId)
              throw new Error("Saved draft belongs to another household.");
            setChannel(saved.channel);
            setSubject(saved.subject);
            setBody(saved.body);
            setRestored(saved);
          }}
          onAcknowledged={(saved) => {
            if (
              saved &&
              saved.body === body &&
              saved.subject === (channel === "EMAIL" ? subject : "") &&
              saved.channel === channel &&
              saved.to ===
                (restored?.to ?? (channel === "EMAIL" ? email : phone))
            ) {
              setBody("");
              setSubject("");
              setRestored(undefined);
            }
          }}
        />
        {restored && queue.recovery && (
          <p className="text-sm break-all">Saved recipient: {restored.to}</p>
        )}
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
                  disabled={!smsAllowed || busy}
                  onClick={() => {
                    setChannel("SMS");
                    setRestored(undefined);
                  }}
                  className="flex-1 gap-1.5"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Text
                  {phone ? ` ${phone}` : ""}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={channel === "EMAIL" ? "default" : "outline"}
                  disabled={!emailAllowed || busy}
                  onClick={() => {
                    setChannel("EMAIL");
                    setRestored(undefined);
                  }}
                  className="flex-1 gap-1.5"
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </Button>
              </div>
              {smsDisabledReason && (
                <p className="text-xs text-muted-foreground">
                  SMS unavailable: {smsDisabledReason.toLowerCase()}.
                </p>
              )}
              {emailDisabledReason && (
                <p className="text-xs text-muted-foreground">
                  Email unavailable: {emailDisabledReason.toLowerCase()}.
                </p>
              )}
              {nothingAllowed && (
                <p className="text-xs text-destructive">
                  This client can't be messaged yet — add a phone number with
                  SMS consent or an email address on their profile.
                </p>
              )}
            </div>

            {channel === "EMAIL" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Subject</Label>
                <Input
                  disabled={busy}
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setRestored(undefined);
                  }}
                  placeholder="Subject"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Message</Label>
              <Textarea
                disabled={busy}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setRestored(undefined);
                }}
                rows={6}
                placeholder="Type message…"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSend}
              disabled={
                !channel ||
                !body.trim() ||
                busy ||
                recoveryBlocksSend ||
                (channel === "EMAIL" && !subject.trim())
              }
            >
              {sending
                ? "Queueing…"
                : channel === "EMAIL"
                  ? "Send email"
                  : "Send text"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
