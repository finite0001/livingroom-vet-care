import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, CheckCheck, Inbox, Plus, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConversationListItem } from "@/hub/components/conversations/ConversationListItem";
import { ConversationActionSheet } from "@/hub/components/conversations/ConversationActionSheet";
import { NewMessageSheet } from "@/hub/components/conversations/NewMessageSheet";
import {
  useConversations,
  useToggleRead,
  useUpdateConversationMetadata,
  useMarkAllRead,
  useUnreadCount,
  type ConversationWithClient,
  type InboxFilters,
} from "@/hub/hooks/use-conversations";
import { useProfiles } from "@/hub/hooks/use-profiles";
import { usePageTitle } from "@/hooks/use-page-title";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
export default function ConversationsPage() {
  usePageTitle("Messages");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<InboxFilters>({ status: "ACTIVE" });
  const [tag, setTag] = useState("");
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [actionConv, setActionConv] = useState<ConversationWithClient | null>(
    null,
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useConversations({
    ...filters,
    search: searchTerm,
    tags: tag.trim() ? [tag.trim()] : [],
  });
  const count = useUnreadCount();
  const toggle = useToggleRead();
  const metadata = useUpdateConversationMetadata();
  const markAll = useMarkAllRead();
  const profiles = useProfiles();
  const busy = toggle.isPending || metadata.isPending || markAll.isPending;
  const set = (change: Partial<InboxFilters>) =>
    setFilters((old) => ({ ...old, ...change }));
  const archive = (conversation: ConversationWithClient) =>
    metadata.mutateAsync({
      conversation,
      status: conversation.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
    });
  const reloadSelected = async () => {
    const result = await list.refetch();
    const row = result.data?.pages.flat().find((c) => c.id === actionConv?.id);
    if (row) setActionConv(row);
    else if (!result.isError) setActionConv(null);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">Inbox</h1>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {count.isError
                ? "Your unread count is unavailable"
                : count.isLoading
                  ? "Loading your unread count…"
                  : `${count.data ?? 0} active conversations unread for you`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.refetch()}
              disabled={list.isFetching}
              aria-label="Refresh inbox"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={busy || count.isError || !count.data}
            >
              <CheckCheck className="mr-1 h-4 w-4" /> Read all active
            </Button>
            <Button size="sm" onClick={() => setNewMsgOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New
            </Button>
          </div>
        </div>
        <Label htmlFor="inbox-search">Search household, pet or message</Label>
        <Input
          id="inbox-search"
          value={search}
          maxLength={200}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, phone, email or message text"
        />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <div>
            <Label htmlFor="inbox-status">Status</Label>
            <select
              id="inbox-status"
              className={selectClass}
              value={filters.status}
              onChange={(e) =>
                set({ status: e.target.value as InboxFilters["status"] })
              }
            >
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <div>
            <Label htmlFor="inbox-read">Read status</Label>
            <select
              id="inbox-read"
              className={selectClass}
              value={filters.read ?? "all"}
              onChange={(e) =>
                set({ read: e.target.value as InboxFilters["read"] })
              }
            >
              <option value="all">All</option>
              <option value="unread">Unread for me</option>
              <option value="read">Read by me</option>
            </select>
          </div>
          <div>
            <Label htmlFor="inbox-assignment">Assigned staff</Label>
            <select
              id="inbox-assignment"
              className={selectClass}
              value={filters.assignment ?? "all"}
              onChange={(e) => set({ assignment: e.target.value })}
            >
              <option value="all">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {profiles.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            {profiles.isError && (
              <p className="text-xs text-destructive">Staff list unavailable</p>
            )}
          </div>
          <div>
            <Label htmlFor="inbox-priority">Priority</Label>
            <select
              id="inbox-priority"
              className={selectClass}
              value={filters.priority ?? ""}
              onChange={(e) =>
                set({
                  priority:
                    (e.target.value as InboxFilters["priority"]) || null,
                })
              }
            >
              <option value="">Any priority</option>
              <option value="URGENT">Urgent</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div>
            <Label htmlFor="inbox-channel">Channel</Label>
            <select
              id="inbox-channel"
              className={selectClass}
              value={filters.channel ?? ""}
              onChange={(e) =>
                set({
                  channel: (e.target.value as InboxFilters["channel"]) || null,
                })
              }
            >
              <option value="">Any channel</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="CALL_INBOUND">Incoming call</option>
              <option value="CALL_OUTBOUND">Outgoing call</option>
              <option value="VOICEMAIL">Voicemail</option>
              <option value="NOTE">Note</option>
            </select>
          </div>
          <div>
            <Label htmlFor="inbox-tag">Tag</Label>
            <Input
              id="inbox-tag"
              className="h-9"
              maxLength={40}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="Exact tag"
            />
          </div>
        </div>
        <Button
          variant="link"
          size="sm"
          className="px-0"
          onClick={() => {
            setFilters({ status: "ACTIVE" });
            setSearch("");
            setTag("");
          }}
        >
          Clear filters
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto" aria-busy={list.isFetching}>
        {list.isError && (
          <div className="p-4 text-sm text-destructive" role="alert">
            Unable to refresh conversations. Displayed details may be stale.
            Refresh before editing.
          </div>
        )}
        {list.isLoading ? (
          <p className="p-6 text-muted-foreground">Loading conversations…</p>
        ) : list.data.length === 0 && !list.isError ? (
          <div className="space-y-2 p-8 text-center text-muted-foreground">
            {filters.status === "ARCHIVED" ? (
              <Archive className="mx-auto h-6 w-6" />
            ) : (
              <Inbox className="mx-auto h-6 w-6" />
            )}
            <p>No conversations match these filters.</p>
          </div>
        ) : (
          list.data.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              disabled={busy || list.isError}
              onSelect={(id) => navigate(`/hub/conversation/${id}`)}
              onLongPress={(selected) => {
                metadata.reset();
                toggle.reset();
                setActionConv(selected);
              }}
              onArchive={() => {
                void archive(conversation).catch(() => undefined);
              }}
              onToggleRead={() =>
                toggle.mutate({ conversation, isRead: !conversation.is_read })
              }
            />
          ))
        )}
        {list.hasNextPage && (
          <div className="p-4 text-center">
            <Button
              variant="outline"
              disabled={list.isFetching}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? "Loading…" : "Load more conversations"}
            </Button>
          </div>
        )}
      </div>
      <NewMessageSheet open={newMsgOpen} onOpenChange={setNewMsgOpen} />
      <ConversationActionSheet
        key={actionConv?.id}
        conversation={actionConv}
        open={!!actionConv}
        onOpenChange={(open) => {
          if (!open) setActionConv(null);
        }}
        busy={busy}
        hasError={metadata.isError || toggle.isError}
        onReload={reloadSelected}
        onToggleRead={(c) =>
          toggle.mutateAsync({ conversation: c, isRead: !c.is_read })
        }
        onArchive={archive}
        onMetadata={(c, changes) =>
          metadata.mutateAsync({ conversation: c, ...changes })
        }
      />
    </div>
  );
}
