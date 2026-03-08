import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Filter, Archive, Inbox, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConversationListItem } from "@/hub/components/conversations/ConversationListItem";
import { ConversationActionSheet } from "@/hub/components/conversations/ConversationActionSheet";
import { NewMessageSheet } from "@/hub/components/conversations/NewMessageSheet";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import {
  useConversations,
  useToggleRead,
  useArchiveConversation,
  useDeleteConversation,
  type ConversationWithClient,
} from "@/hub/hooks/use-conversations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationsPage() {
  const navigate = useNavigate();
  const { data: conversations, isLoading } = useConversations();
  const toggleRead = useToggleRead();
  const archiveConv = useArchiveConversation();
  const deleteConv = useDeleteConversation();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [actionConv, setActionConv] = useState<ConversationWithClient | null>(null);

  const filtered = useMemo(() => {
    if (!conversations) return [];
    let list = conversations.filter((c) =>
      tab === "active" ? c.status === "ACTIVE" : c.status === "ARCHIVED"
    );
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
  }, [conversations, search, tab]);

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
          <Button size="sm" className="h-8 gap-1" onClick={() => setNewMsgOpen(true)}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clients, pets, phones..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
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
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={search ? "No results" : tab === "archived" ? "No archived chats" : "No conversations yet"}
            description={search ? "Try a different search term" : "Start a new message to begin"}
            actionLabel={!search ? "New Message" : undefined}
            onAction={!search ? () => setNewMsgOpen(true) : undefined}
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
