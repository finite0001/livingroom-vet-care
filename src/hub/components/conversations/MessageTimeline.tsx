import React, { useMemo } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { MessageSquare, Mail, PhoneIncoming, PhoneOutgoing, AudioWaveform, StickyNote, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  conversation_id: string;
  type: string;
  sender_type: string;
  content: string | null;
  audio_url: string | null;
  transcription: string | null;
  is_internal: boolean;
  ivr_path: string | null;
  created_at: string;
  triage_priority?: string | null;
  triage_confidence?: number | null;
  triage_reason?: string | null;
}

interface MessageTimelineProps {
  messages: Message[];
  conversationBoundaries?: ConversationBoundary[];
}

const channelConfig: Record<string, { icon: React.ElementType; iconColor: string }> = {
  SMS: { icon: MessageSquare, iconColor: "text-primary" },
  EMAIL: { icon: Mail, iconColor: "text-blue-500" },
  CALL_INBOUND: { icon: PhoneIncoming, iconColor: "text-green-500" },
  CALL_OUTBOUND: { icon: PhoneOutgoing, iconColor: "text-green-500" },
  VOICEMAIL: { icon: AudioWaveform, iconColor: "text-amber-500" },
  NOTE: { icon: StickyNote, iconColor: "text-yellow-600" },
  SYSTEM: { icon: Info, iconColor: "text-muted-foreground" },
};

function DateDivider({ date }: { date: Date }) {
  let label: string;
  if (isToday(date)) label = "Today";
  else if (isYesterday(date)) label = "Yesterday";
  else label = format(date, "MMM d, yyyy");
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function SessionDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-primary/40" />
      <span className="text-[12px] font-semibold text-primary bg-primary/10 rounded-full px-3 py-1">New conversation · {format(date, "MMM d, yyyy")}</span>
      <div className="flex-1 h-px bg-primary/40" />
    </div>
  );
}

export function MessageTimeline({ messages, conversationBoundaries }: MessageTimelineProps) {
  const dividerInfo = useMemo(() => {
    const boundaryConvIds = new Set<string>();
    const boundaryDateMap = new Map<string, string>();
    if (conversationBoundaries && conversationBoundaries.length > 1) {
      for (let i = 1; i < conversationBoundaries.length; i++) {
        boundaryConvIds.add(conversationBoundaries[i].conversationId);
        boundaryDateMap.set(conversationBoundaries[i].conversationId, conversationBoundaries[i].createdAt);
      }
    }
    const sessionDividerAt = new Map<number, string>();
    const dateDividerAt = new Map<number, Date>();
    const renderedSessions = new Set<string>();
    let lastDateStr: string | null = null;
    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx];
      if (boundaryConvIds.has(msg.conversation_id) && !renderedSessions.has(msg.conversation_id)) {
        const isFirstMsgInConv = idx === 0 || messages[idx - 1].conversation_id !== msg.conversation_id;
        if (isFirstMsgInConv) { renderedSessions.add(msg.conversation_id); sessionDividerAt.set(idx, boundaryDateMap.get(msg.conversation_id) || msg.created_at); lastDateStr = null; }
      }
      const msgDateStr = format(new Date(msg.created_at), "yyyy-MM-dd");
      if (msgDateStr !== lastDateStr) { dateDividerAt.set(idx, new Date(msg.created_at)); lastDateStr = msgDateStr; }
    }
    return { sessionDividerAt, dateDividerAt };
  }, [messages, conversationBoundaries]);

  return (
    <div className="flex flex-col gap-2 p-4">
      {messages.map((msg, idx) => {
        const config = channelConfig[msg.type] || channelConfig.SYSTEM;
        const Icon = config.icon;
        const isClient = msg.sender_type === "CLIENT";
        return (
          <React.Fragment key={msg.id}>
            {dividerInfo.sessionDividerAt.has(idx) && <SessionDivider date={new Date(dividerInfo.sessionDividerAt.get(idx)!)} />}
            {dividerInfo.dateDividerAt.has(idx) && <DateDivider date={dividerInfo.dateDividerAt.get(idx)!} />}
            <div className={cn("rounded-lg p-3 max-w-[85%]", msg.is_internal && "border border-dashed border-yellow-400", isClient ? "self-start rounded-bl-sm border-l-[3px] border-l-primary bg-card" : "self-end rounded-br-sm border-r-[3px] border-r-primary bg-primary/10")}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn("h-4 w-4", config.iconColor)} />
                <span className="text-[12px] font-medium text-muted-foreground">{msg.is_internal ? "Internal Note" : isClient ? "Client" : "Staff"} · {msg.type.replace("_", " ")}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">{format(new Date(msg.created_at), "h:mm a")}</span>
              </div>
              {msg.type === "VOICEMAIL" && msg.audio_url ? (
                <div className="space-y-2">
                  <audio controls className="w-full h-8 max-w-[300px]" src={msg.audio_url} />
                  {msg.transcription && <p className="text-sm leading-relaxed bg-background/60 rounded-md p-2">{msg.transcription}</p>}
                </div>
              ) : msg.content && <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>}
              {msg.triage_priority && (
                <div className={cn("mt-1.5 flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 w-fit", msg.triage_priority === "URGENT" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                  <span className="font-medium">AI: {msg.triage_priority}</span>
                  {msg.triage_reason && <span>— {msg.triage_reason}</span>}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
