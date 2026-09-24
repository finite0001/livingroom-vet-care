import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  ArchiveRestore,
  Mail,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandAvatar } from "./BrandAvatar";
import type { ConversationWithClient } from "@/hub/hooks/use-conversations";
import { PriorityBadge } from "./PriorityDropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ConversationListItemProps {
  conversation: ConversationWithClient;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onLongPress: (conversation: ConversationWithClient) => void;
  onArchive?: (conversationId: string) => void;
  onToggleRead?: (conversationId: string, isRead: boolean) => void;
}
export function ConversationListItem({
  conversation: c,
  disabled,
  onSelect,
  onLongPress,
  onArchive,
  onToggleRead,
}: ConversationListItemProps) {
  const unread = !c.is_read;
  const Icon = c.last_message?.type === "EMAIL" ? Mail : MessageSquare;
  return (
    <article
      className={cn(
        "flex min-h-16 items-center gap-2 border-b px-4 py-3",
        unread && "bg-primary/5",
      )}
      aria-label={`${c.client.full_name} conversation`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(c.id)}
        aria-label={`Open ${c.client.full_name}${unread ? " (unread)" : ""}`}
      >
        <BrandAvatar
          email={c.client.primary_email}
          name={c.client.full_name}
          className="h-9 w-9 shrink-0 text-sm font-semibold"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unread && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
            )}
            <PriorityBadge priority={c.priority} />
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-bold" : "font-medium",
              )}
            >
              {c.client.full_name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Icon
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate text-xs text-muted-foreground">
              {c.last_message
                ? c.last_message.content?.split("\n")[0]?.slice(0, 80) ||
                  "Message"
                : "No messages yet"}
            </span>
          </div>
          {c.tags.length > 0 && (
            <div className="mt-1 flex gap-1">
              {c.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(c.last_message_at), {
            addSuffix: true,
          })}
        </span>
        <div className="flex gap-1">
          {onToggleRead && (
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled || (!c.is_read && !c.latest_message_id)}
              aria-label={c.is_read ? "Mark as unread" : "Mark as read"}
              className="hidden h-8 w-8 md:flex"
              onClick={() => onToggleRead(c.id, c.is_read)}
            >
              <MailOpen className="h-4 w-4" />
            </Button>
          )}
          {onArchive && (
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={
                c.status === "ARCHIVED"
                  ? "Restore conversation"
                  : "Archive conversation"
              }
              className="hidden h-8 w-8 md:flex"
              onClick={() => onArchive(c.id)}
            >
              {c.status === "ARCHIVED" ? (
                <ArchiveRestore className="h-4 w-4" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={`Actions for ${c.client.full_name}`}
            className="h-8 w-8"
            onClick={() => onLongPress(c)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
