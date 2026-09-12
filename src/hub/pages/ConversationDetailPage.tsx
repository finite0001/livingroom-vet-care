import { useMessageQueue } from "@/hub/hooks/use-message-queue";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageTimeline } from "@/hub/components/conversations/MessageTimeline";
import { ReplyComposer } from "@/hub/components/conversations/ReplyComposer";
import { SmartReplySuggestions } from "@/hub/components/conversations/SmartReplySuggestions";
import { BrandAvatar } from "@/hub/components/conversations/BrandAvatar";
import {
  useConversationMessages,
  useConversation,
  useMarkRead,
} from "@/hub/hooks/use-conversations";
import { useClientConsent } from "@/hub/hooks/use-sms-consent";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const queue = useMessageQueue(`conversation:${id}`);
  const messageQuery = useConversationMessages(id);
  const { data: messages, isLoading: msgsLoading } = messageQuery;
  const { data: conversation, isLoading: convLoading } = useConversation(id);
  // Strict opt-in: SMS is blocked unless the client has an explicit opted_in=true
  // record, matching the server's send-sms gate. Gate on consentFetched so we stay
  // optimistic (SMS enabled) while consent is still loading — otherwise the empty
  // composer would auto-switch off SMS before we know an opted-in client is fine.
  const { data: consent, isFetched: consentFetched } = useClientConsent(conversation?.client.id);
  const smsOptedOut = consentFetched && consent?.can_message !== true;
  const readMutation = useMarkRead();
  const { mutate: markRead } = readMutation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  // AI smart-reply suggestions populate the composer for staff review rather than
  // sending immediately — a one-tap auto-send of AI text to a client is too risky.
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const conversationNotFound = !convLoading && !conversation;
  usePageTitle(conversation ? `Chat — ${conversation.client.full_name}` : "Chat");

  const newestMessageId = messages?.[messages.length - 1]?.id;
  const lastReadAttempt = useRef<string>();
  const olderScroll = useRef<{ height: number; top: number } | null>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    lastReadAttempt.current = undefined;
    nearBottom.current = true;
    olderScroll.current = null;
  }, [id]);
  useEffect(() => {
    const recordRenderedBoundary = () => {
      if (document.visibilityState !== "visible" || !id || !newestMessageId || conversation?.is_read !== false) return;
      const element = scrollRef.current;
      if (!element || element.scrollHeight - element.scrollTop - element.clientHeight > 80) return;
      const boundary = `${id}:${newestMessageId}`;
      if (lastReadAttempt.current === boundary) return;
      lastReadAttempt.current = boundary;
      markRead({ conversationId: id, messageId: newestMessageId });
    };
    recordRenderedBoundary();
    document.addEventListener("visibilitychange", recordRenderedBoundary);
    const element = scrollRef.current;
    element?.addEventListener("scroll", recordRenderedBoundary);
    return () => {
      document.removeEventListener("visibilitychange", recordRenderedBoundary);
      element?.removeEventListener("scroll", recordRenderedBoundary);
    };
  }, [id, newestMessageId, conversation?.is_read, markRead]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (olderScroll.current) {
      element.scrollTop = olderScroll.current.top + element.scrollHeight - olderScroll.current.height;
      olderScroll.current = null;
    } else if (nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages?.length, newestMessageId, convLoading, msgsLoading]);
  const loadOlder = async () => {
    const element = scrollRef.current;
    if (element) olderScroll.current = { height: element.scrollHeight, top: element.scrollTop };
    const result = await messageQuery.fetchNextPage();
    if (result.isError) olderScroll.current = null;
    requestAnimationFrame(() => { olderScroll.current = null; });
  };

  const goBack = () => {
    if (window.history.length > 2) navigate(-1);
    else navigate("/hub/chats");
  };

  const handleSend = async (content: string, channel: "SMS" | "EMAIL" | "NOTE", subject?: string): Promise<boolean> => {
    if (!id || !conversation || sendingRef.current || !session?.user.id) return false;
    sendingRef.current = true;
    setIsSending(true);
    try {
      if (channel === "NOTE") {
        const { error } = await supabase.from("messages").insert({
          conversation_id: id,
          content,
          type: "NOTE",
          sender_type: "STAFF",
          sender_id: session.user.id,
          is_internal: true,
        });
        if (error) throw error;
        toast.success("Note added");
        return true;
      } else if (channel === "SMS") {
        if (!consentFetched || consent?.can_message !== true || !conversation.client.primary_phone || consent.phone_number?.replace(/\D/g, "") !== conversation.client.primary_phone.replace(/\D/g, "")) { toast.error("No SMS consent on record for this number"); return false; }
        const phone = conversation.client.primary_phone;
        if (!phone) { toast.error("Client has no phone number"); return false; }
        const result = await queue.send({ conversation_id: id, channel, to: phone, subject: "", body: content, attachment_ids: [] });
        toast.success(result.state === "pending" ? "SMS queued" : `Message recorded: ${result.state}`);
        return true;
      } else if (channel === "EMAIL") {
        const email = conversation.client.primary_email;
        if (!email) { toast.error("Client has no email address"); return false; }
        const result = await queue.send({ conversation_id: id, channel, to: email, subject: subject ?? "", body: content, attachment_ids: [] });
        toast.success(result.state === "pending" ? "Email queued" : `Message recorded: ${result.state}`);
        return true;
      }
      return false;
    } catch (err) {
      toast.error(channel === "NOTE" ? "Unable to save the internal note. Your draft has been kept." : (err instanceof Error ? err.message : "Unable to confirm queue status. Keep the draft and retry unchanged."));
      return false;
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  if (conversationNotFound) {
    return (
      <div className="flex min-h-0 flex-col h-full">
        <div className="flex items-center gap-3 border-b px-3 py-2.5 bg-card">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={goBack} aria-label="Go back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <p className="text-sm font-semibold">Conversation</p>
        </div>
        <div className="flex items-center justify-center flex-1 gap-3 flex-col">
          <p className="text-sm text-muted-foreground">Conversation not found</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/hub/chats")}>
            Back to chats
          </Button>
        </div>
      </div>
    );
  }

  const clientName = conversation
    ? `${conversation.client.first_name} ${conversation.client.last_name}`
    : "";

  return (
    <div className="flex min-h-0 flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-3 py-2.5 bg-card">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={goBack} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {conversation ? (
          <>
            <BrandAvatar
              email={conversation.client.primary_email}
              name={clientName}
              className="h-8 w-8 text-xs shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{clientName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {conversation.client.primary_phone || conversation.client.primary_email || "No contact"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => navigate(`/hub/client/${conversation.client.id}`)}
              aria-label="View client profile"
            >
              <User className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Skeleton className="h-8 w-48" />
        )}
      </div>

      {/* Messages */}
      <div role="region" aria-label="Conversation messages" ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background" onScroll={() => {
        const element = scrollRef.current;
        if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}>
        {messageQuery.hasNextPage && <div className="p-2 text-center"><Button variant="outline" size="sm" disabled={messageQuery.isFetchingNextPage} onClick={() => void loadOlder()}>{messageQuery.isFetchingNextPage ? "Loading older messages…" : "Load older messages"}</Button></div>}
        {messageQuery.isError && <p role="alert" className="p-3 text-sm text-destructive">Messages could not be loaded. <button className="underline" onClick={() => void messageQuery.refetch()}>Retry</button></p>}
        {readMutation.isError && id && newestMessageId && <p role="alert" className="p-3 text-sm text-muted-foreground">Your read status could not be saved. <button className="underline" onClick={() => markRead({ conversationId: id, messageId: newestMessageId })}>Retry read receipt</button></p>}
        {msgsLoading || convLoading ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className={`h-16 ${i % 2 ? "w-3/4 ml-auto" : "w-3/4"} rounded-lg`} />
            ))}
          </div>
        ) : messages && messages.length > 0 ? (
          <MessageTimeline messages={messages} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No messages yet. Send the first one below.
          </div>
        )}
      </div>

      {/* Smart replies */}
      {id && messages && messages.length > 0 && (
        <SmartReplySuggestions
          conversationId={id}
          onSelect={(text) => setDraft(text)}
        />
      )}

      {/* Composer */}
      {conversation && (
        <ReplyComposer
          key={id}
          onSend={handleSend}
          defaultChannel={conversation.client.preferred_channel === "EMAIL" ? "EMAIL" : "SMS"}
          smsOptedOut={smsOptedOut}
          draft={draft}
          onDraftConsumed={() => setDraft(undefined)}
          disabled={isSending}
        />
      )}
    </div>
  );
}
