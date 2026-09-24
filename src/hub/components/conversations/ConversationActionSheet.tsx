import { useState } from "react";
import { Archive, ArchiveRestore, Eye, EyeOff } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfiles } from "@/hub/hooks/use-profiles";
import type {
  ConversationWithClient,
  MetadataChange,
  ConversationPriority,
} from "@/hub/hooks/use-conversations";

interface ConversationActionSheetProps {
  conversation: ConversationWithClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleRead: (conversation: ConversationWithClient) => Promise<unknown>;
  onArchive: (conversation: ConversationWithClient) => Promise<unknown>;
  onMetadata: (
    conversation: ConversationWithClient,
    change: Omit<MetadataChange, "conversation">,
  ) => Promise<unknown>;
  onReload: () => Promise<unknown>;
  busy: boolean;
  hasError: boolean;
}
export function ConversationActionSheet({
  conversation,
  open,
  onOpenChange,
  onToggleRead,
  onArchive,
  onMetadata,
  onReload,
  busy,
  hasError,
}: ConversationActionSheetProps) {
  const profiles = useProfiles();
  const [tags, setTags] = useState(conversation?.tags.join(", ") ?? "");
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      onOpenChange(false);
    } catch {
      /* Keep the editor and draft after an unconfirmed write. */
    }
  };
  if (!conversation) return null;
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto pb-8"
      >
        <SheetHeader>
          <SheetTitle>{conversation.client.full_name}</SheetTitle>
          <SheetDescription>
            Changes are saved to this conversation. Read status is personal to
            you.
          </SheetDescription>
        </SheetHeader>
        <div className="mx-auto mt-4 max-w-xl space-y-4">
          {hasError && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>
                Save not confirmed. Reload the current details and review before
                retrying. Your tag draft is kept.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void onReload()}
              >
                Reload current details
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={
                busy ||
                (!conversation.is_read && !conversation.latest_message_id)
              }
              onClick={() => void run(() => onToggleRead(conversation))}
            >
              {conversation.is_read ? (
                <EyeOff className="mr-2 h-4 w-4" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              {conversation.is_read ? "Mark as unread" : "Mark as read"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => onArchive(conversation))}
            >
              {conversation.status === "ARCHIVED" ? (
                <ArchiveRestore className="mr-2 h-4 w-4" />
              ) : (
                <Archive className="mr-2 h-4 w-4" />
              )}
              {conversation.status === "ARCHIVED"
                ? "Restore to active"
                : "Archive"}
            </Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversation-assignee">Assigned staff</Label>
            <select
              id="conversation-assignee"
              value={conversation.assigned_to_id ?? ""}
              disabled={busy || profiles.isError || profiles.isLoading}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(e) =>
                void run(() =>
                  onMetadata(conversation, {
                    assignedToId: e.target.value || null,
                  }),
                )
              }
            >
              <option value="">Unassigned</option>
              {profiles.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            {profiles.isError && (
              <p className="text-sm text-destructive">
                Staff list unavailable.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversation-priority">Priority</Label>
            <select
              id="conversation-priority"
              value={conversation.priority}
              disabled={busy}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(e) =>
                void run(() =>
                  onMetadata(conversation, {
                    priority: e.target.value as ConversationPriority,
                  }),
                )
              }
            >
              <option value="URGENT">Urgent</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="conversation-tags">Tags, separated by commas</Label>
            <Input
              id="conversation-tags"
              value={tags}
              maxLength={820}
              disabled={busy}
              onChange={(e) => setTags(e.target.value)}
            />
            <Button
              disabled={
                busy ||
                tags.split(",").filter((t) => t.trim()).length > 20 ||
                tags.split(",").some((t) => t.trim().length > 40)
              }
              onClick={() =>
                void run(() =>
                  onMetadata(conversation, {
                    tags: tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  }),
                )
              }
            >
              Save tags
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Archived conversations retain their messages and audit history.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
