import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Filter, Archive, Inbox, MessageSquare, CheckCheck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ConversationListItem } from "@/hub/components/conversations/ConversationListItem";
import { ConversationActionSheet } from "@/hub/components/conversations/ConversationActionSheet";
import { NewMessageSheet } from "@/hub/components/conversations/NewMessageSheet";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import {
  useConversations,
  useToggleRead,
  useArchiveConversation,
  useDeleteConversation,
  useMarkAllRead,
  type ConversationWithClient,
  type ConversationPriority,
} from "@/hub/hooks/use-conversations";
import { useProfiles } from "@/hub/hooks/use-profiles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

type ReadFilter = "all" | "unread" | "read";

export default function ConversationsPage() {
  usePageTitle("Messages");
  const navigate = useNavigate();
  const { data: conversations, isLoading, isError } = useConversations();
  const toggleRead = useToggleRead();
  const archiveConv = useArchiveConversation();
  const deleteConv = useDeleteConversation();
  const markAllRead = useMarkAllRead();
  const { data: profiles } = useProfiles();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [actionConv, setActionConv] = useState<ConversationWithClient | null>(null);

  // Filters
  const [priorityFilter, setPriorityFilter] = useState<ConversationPriority | null>(null);
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [assignedFilter, setAssignedFilter] = useState<string | null>(null);

  const activeFilterCount = [priorityFilter, readFilter !== "all" ? readFilter : null, assignedFilter].filter(Boolean).length;

  const filtered = useMemo(() => {
    if (!conversations) return [];
    let list = conversations.filter((c) =>
      tab === "active" ? c.status === "ACTIVE" : c.status === "ARCHIVED"
    );
    if (priorityFilter) {
      list = list.filter((c) => c.priority === priorityFilter);
    }
    if (readFilter === "unread") {
      list = list.filter((c) => !c.is_read);
    } else if (readFilter === "read") {
      list = list.filter((c) => c.is_read);
    }
    if (assignedFilter) {
      list = list.filter((c) => c.assigned_to_id === assignedFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.client.full_name.toLowerCase().includes(s) ||
          c.client.primary_phone?.includes(s) ||
          c.pets.some((p) => p.name.toLowerCase().includes(s))
      );
    }
    return list;
  }, [conversations, search, tab, priorityFilter, readFilter, assignedFilter]);

  const unreadInView = useMemo(() => filtered.filter((c) => !c.is_read).length, [filtered]);

  const clearFilters = () => {
    setPriorityFilter(null);
    setReadFilter("all");
    setAssignedFilter(null);
  };

  const handleAssign = async (convId: string, dvmId: string | null) => {
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_to_id: dvmId })
      .eq("id", convId);
    if (error) toast.error("Failed to assign");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Chats</h1>
          <div className="flex items-center gap-1.5">
            {tab === "active" && unreadInView > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                aria-label="Mark all as read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Read all</span>
              </Button>
            )}
            <Button size="sm" className="h-8 gap-1" onClick={() => setNewMsgOpen(true)}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients, pets, phones..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 relative" aria-label="Filter conversations">
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Filters</p>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>Clear all</Button>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Priority</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["URGENT", "NORMAL", "LOW"] as ConversationPriority[]).map((p) => (
                    <Button
                      key={p}
                      variant={priorityFilter === p ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setPriorityFilter(priorityFilter === p ? null : p)}
                    >
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Read status</p>
                <div className="flex flex-wrap gap-1.5">
                  {([["all", "All"], ["unread", "Unread"], ["read", "Read"]] as [ReadFilter, string][]).map(([val, label]) => (
                    <Button
                      key={val}
                      variant={readFilter === val ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setReadFilter(val)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              {profiles && profiles.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Assigned to</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant={assignedFilter === null ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setAssignedFilter(null)}
                    >
                      Anyone
                    </Button>
                    {profiles.slice(0, 6).map((p) => (
                      <Button
                        key={p.id}
                        variant={assignedFilter === p.id ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setAssignedFilter(assignedFilter === p.id ? null : p.id)}
                      >
                        {p.first_name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {priorityFilter && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setPriorityFilter(null)}>
                {priorityFilter.charAt(0) + priorityFilter.slice(1).toLowerCase()} <X className="h-3 w-3" />
              </Badge>
            )}
            {readFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setReadFilter("all")}>
                {readFilter === "unread" ? "Unread" : "Read"} <X className="h-3 w-3" />
              </Badge>
            )}
            {assignedFilter && profiles && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setAssignedFilter(null)}>
                {profiles.find((p) => p.id === assignedFilter)?.first_name ?? "Staff"} <X className="h-3 w-3" />
              </Badge>
            )}
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "archived")}>
          <TabsList className="w-full h-8">
            <TabsTrigger value="active" className="flex-1 text-xs gap-1">
              <Inbox className="h-3.5 w-3.5" /> Inbox
            </TabsTrigger>
            <TabsTrigger value="archived" className="flex-1 text-xs gap-1">
              <Archive className="h-3.5 w-3.5" /> Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={MessageSquare}
            title="Failed to load conversations"
            description="Something went wrong. Please try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={search || activeFilterCount > 0 ? "No results" : tab === "archived" ? "No archived chats" : "No conversations yet"}
            description={search || activeFilterCount > 0 ? "Try adjusting your search or filters" : "Start a new message to begin"}
            actionLabel={!search && activeFilterCount === 0 ? "New Message" : activeFilterCount > 0 ? "Clear Filters" : undefined}
            onAction={!search && activeFilterCount === 0 ? () => setNewMsgOpen(true) : activeFilterCount > 0 ? clearFilters : undefined}
          />
        ) : (
          filtered.map((conv) => (
            <ConversationListItem
              key={conv.id}
              conversation={conv}
              onSelect={(id) => navigate(`/hub/conversation/${id}`)}
              onLongPress={setActionConv}
              onArchive={(id) =>
                archiveConv.mutate({
                  conversationId: id,
                  status: tab === "active" ? "ARCHIVED" : "ACTIVE",
                })
              }
              onToggleRead={(id, isRead) =>
                toggleRead.mutate({ conversationId: id, isRead: !isRead })
              }
            />
          ))
        )}
      </div>

      <NewMessageSheet open={newMsgOpen} onOpenChange={setNewMsgOpen} />
      <ConversationActionSheet
        conversation={actionConv}
        open={!!actionConv}
        onOpenChange={(open) => !open && setActionConv(null)}
        onToggleRead={(id, currentIsRead) =>
          toggleRead.mutate({ conversationId: id, isRead: !currentIsRead })
        }
        onArchive={(id) =>
          archiveConv.mutate({
            conversationId: id,
            status: tab === "active" ? "ARCHIVED" : "ACTIVE",
          })
        }
        onDelete={(id) => deleteConv.mutate(id)}
        onAssign={handleAssign}
        isArchiveView={tab === "archived"}
      />
    </div>
  );
}
