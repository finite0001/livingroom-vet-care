import { useRef, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Mail, Archive, MailOpen, StickyNote } from "lucide-react";
import { PhoneIncoming, PhoneOutgoing, AudioWaveform } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandAvatar } from "./BrandAvatar";
import type { ConversationWithClient } from "@/hub/hooks/use-conversations";
import { PriorityBadge } from "./PriorityDropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ConversationListItemProps {
  conversation: ConversationWithClient;
  onSelect: (id: string) => void;
  onLongPress: (conversation: ConversationWithClient) => void;
  onArchive?: (conversationId: string) => void;
  onToggleRead?: (conversationId: string, isRead: boolean) => void;
}

function getMessageIcon(type: string) {
  switch (type) {
    case "SMS": return <MessageSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" />;
    case "EMAIL": return <Mail className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />;
    case "CALL_INBOUND": return <PhoneIncoming className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />;
    case "CALL_OUTBOUND": return <PhoneOutgoing className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />;
    case "VOICEMAIL": return <AudioWaveform className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />;
    case "NOTE": return <StickyNote className="h-3.5 w-3.5 text-yellow-500" aria-hidden="true" />;
    default: return <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
  }
}

function getPreview(msg: ConversationWithClient["last_message"]) {
  if (!msg) return "No messages yet";
  if (msg.type === "VOICEMAIL") return "Voicemail";
  const raw = msg.content || "...";
  return raw.split("\n")[0]?.slice(0, 80) || "...";
}

function formatPetNames(pets: { name: string }[]) {
  if (pets.length === 0) return "";
  if (pets.length === 1) return pets[0].name;
  if (pets.length === 2) return `${pets[0].name} & ${pets[1].name}`;
  return `${pets[0].name} & ${pets.length - 1} more`;
}

export function ConversationListItem({ conversation, onSelect, onLongPress, onArchive, onToggleRead }: ConversationListItemProps) {
  const { client, pets, last_message } = conversation;
  const petStr = formatPetNames(pets);
  const isUnread = !conversation.is_read;
  const clientName = `${client.first_name} ${client.last_name}`;

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => { onLongPress(conversation); longPressTimer.current = null; }, 500);
  }, [conversation, onLongPress]);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  return (
    <div
      className={cn("group/item flex items-center gap-3 border-b px-4 py-3 min-h-[64px] cursor-pointer hover:bg-accent/40 transition-all duration-150", isUnread && "bg-primary/5")}
      onClick={() => onSelect(conversation.id)}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); onLongPress(conversation); }}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onSelect(conversation.id); }}
      aria-label={`${clientName}${isUnread ? " (unread)" : ""}`}
    >
      <BrandAvatar email={client.primary_email} name={clientName} className="h-9 w-9 shrink-0 text-sm font-semibold" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isUnread && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
          <PriorityBadge priority={conversation.priority} />
          <span className={cn("text-sm truncate", isUnread ? "font-bold" : "font-semibold")}>{client.first_name} {client.last_name[0]}.</span>
          {petStr && <span className="text-xs text-muted-foreground truncate">({petStr})</span>}
          {conversation.tags?.length > 0 && conversation.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="text-xs px-1 py-0 h-4">{tag}</Badge>)}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {last_message && getMessageIcon(last_message.type)}
          <p className={cn("text-xs truncate", isUnread ? "text-foreground font-medium" : "text-muted-foreground")}>{getPreview(last_message)}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground tabular-nums">{formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: true })}</span>
          {onToggleRead && <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover/item:opacity-100 transition-opacity hidden md:flex" onClick={(e) => { e.stopPropagation(); onToggleRead(conversation.id, !conversation.is_read); }}><MailOpen className="h-3.5 w-3.5 text-muted-foreground" /></Button>}
          {onArchive && <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover/item:opacity-100 transition-opacity hidden md:flex" onClick={(e) => { e.stopPropagation(); onArchive(conversation.id); }}><Archive className="h-3.5 w-3.5 text-muted-foreground" /></Button>}
        </div>
      </div>
    </div>
  );
}
