import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageTimeline } from "@/hub/components/conversations/MessageTimeline";
import { ReplyComposer } from "@/hub/components/conversations/ReplyComposer";
import { SmartReplySuggestions } from "@/hub/components/conversations/SmartReplySuggestions";
import { BrandAvatar } from "@/hub/components/conversations/BrandAvatar";
import {
  useConversationMessages,
  useConversations,
  useMarkRead,
} from "@/hub/hooks/use-conversations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/AuthContext";

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: messages, isLoading: msgsLoading } = useConversationMessages(id);
  const { data: conversations } = useConversations();
  const markRead = useMarkRead();
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversation = conversations?.find((c) => c.id === id);

  // Mark as read on open
  useEffect(() => {
    if (id && conversation && !conversation.is_read) {
      markRead.mutate(id);
    }
  }, [id, conversation?.is_read]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages?.length]);

  const handleSend = async (content: string, channel: "SMS" | "EMAIL" | "NOTE") => {
    if (!id || !conversation) return;
    try {
      if (channel === "NOTE") {
        const { error } = await supabase.from("messages").insert({
          conversation_id: id,
          content,
          type: "NOTE" as any,
          sender_type: "STAFF",
          sender_id: profile?.id ?? null,
          is_internal: true,
        });
        if (error) throw error;
        toast.success("Note added");
      } else if (channel === "SMS") {
        const phone = conversation.client.primary_phone;
        if (!phone) { toast.error("Client has no phone number"); return; }
        const { error } = await supabase.functions.invoke("send-sms", {
          body: { to: phone, body: content, conversation_id: id },
        });
        if (error) throw error;
        toast.success("SMS sent");
      }
      // Update last_message_at
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  const clientName = conversation
    ? `${conversation.client.first_name} ${conversation.client.last_name}`
    : "";

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-3 py-2.5 bg-card">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate("/hub/chats")}>
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
            >
              <User className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Skeleton className="h-8 w-48" />
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background">
        {msgsLoading ? (
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
          onSelect={(text) => handleSend(text, "SMS")}
        />
      )}

      {/* Composer */}
      <ReplyComposer
        onSend={handleSend}
        defaultChannel={conversation?.client.preferred_channel === "EMAIL" ? "EMAIL" : "SMS"}
      />
    </div>
  );
}
