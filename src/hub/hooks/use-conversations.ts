import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

export type ConversationPriority = "URGENT" | "NORMAL" | "LOW";
export interface ConversationWithClient {
  id: string;
  client_id: string;
  assigned_to_id: string | null;
  status: "ACTIVE" | "PENDING" | "ARCHIVED";
  is_read: boolean;
  unread_count: number;
  revision: number;
  latest_message_id: string | null;
  priority: ConversationPriority;
  tags: string[];
  first_message_at: string | null;
  first_response_at: string | null;
  last_message_at: string;
  created_at: string;
  client: {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    primary_phone: string | null;
    primary_email: string | null;
    preferred_channel: string | null;
    ezyvet_id: string | null;
  };
  pets: { id: string; name: string; species: string; breed: string | null }[];
  last_message?: { content: string | null; type: string; created_at: string };
}
export interface InboxFilters {
  search?: string;
  status?: "ACTIVE" | "PENDING" | "ARCHIVED";
  assignment?: string;
  priority?: ConversationPriority | null;
  tags?: string[];
  channel?: Database["public"]["Enums"]["message_type"] | null;
  read?: "all" | "read" | "unread";
}
interface Cursor {
  at: string;
  id: string;
}
const pageSize = 50;
const pollInterval = 15_000;

function useActor() {
  const { session } = useAuth();
  return session?.user.id;
}
function requireActor(actor: string | undefined) {
  if (!actor) throw new Error("Sign in before changing the inbox.");
  return actor;
}
function useRefreshInbox() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["conversations"] }),
      client.invalidateQueries({ queryKey: ["conversation"] }),
      client.invalidateQueries({ queryKey: ["unread-count"] }),
    ]);
}
function mutationError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  toast.error(
    code === "40001"
      ? "This conversation changed. Refresh and review before trying again."
      : "Unable to confirm the change. Refresh to check the saved state before retrying.",
  );
}

export function useConversations(filters: InboxFilters = {}) {
  const actor = useActor();
  const query = useInfiniteQuery({
    queryKey: ["conversations", actor, filters],
    enabled: !!actor,
    initialPageParam: null as Cursor | null,
    staleTime: 10_000,
    refetchInterval: pollInterval,
    refetchOnWindowFocus: true,
    queryFn: async ({ pageParam, signal }) => {
      const assignment = filters.assignment ?? "all";
      const { data, error } = await supabase
        .rpc("list_inbox_workspace", {
          p_search: filters.search?.trim() ?? "",
          p_status: filters.status ?? "ACTIVE",
          p_assignment:
            assignment === "all" || assignment === "unassigned"
              ? assignment
              : "staff",
          p_assigned_to_id:
            assignment !== "all" && assignment !== "unassigned"
              ? assignment
              : undefined,
          p_priority: filters.priority ?? undefined,
          p_tags: filters.tags ?? [],
          p_channel: filters.channel ?? undefined,
          p_read: filters.read ?? "all",
          p_before_at: pageParam?.at,
          p_before_id: pageParam?.id,
          p_limit: pageSize,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map((row): ConversationWithClient => ({
        id: row.conversation_id!,
        client_id: row.client_id!,
        assigned_to_id: row.assigned_to_id,
        status: row.status!,
        is_read: !row.is_unread,
        unread_count: row.unread_count ?? 0,
        revision: row.revision!,
        latest_message_id: row.latest_message_id,
        priority: row.priority!,
        tags: row.tags ?? [],
        first_message_at: null,
        first_response_at: null,
        last_message_at: row.updated_at!,
        created_at: row.updated_at!,
        client: {
          id: row.client_id!,
          first_name: row.client_name ?? "",
          last_name: "",
          full_name: row.client_name ?? "",
          primary_phone: row.primary_phone,
          primary_email: row.primary_email,
          preferred_channel: null,
          ezyvet_id: null,
        },
        pets: [],
        last_message: row.latest_message_id
          ? {
              content: row.latest_content,
              type: row.latest_type!,
              created_at: row.updated_at!,
            }
          : undefined,
      }));
    },
    getNextPageParam: (last) =>
      last.length === pageSize
        ? {
            at: last[last.length - 1].last_message_at,
            id: last[last.length - 1].id,
          }
        : undefined,
  });
  const rows = query.data?.pages.flat() ?? [];
  return {
    ...query,
    data: [...new Map(rows.map((row) => [row.id, row])).values()],
  };
}

export interface ReadBoundary {
  conversationId: string;
  messageId: string;
}
export function useMarkRead() {
  const actor = useActor();
  const refresh = useRefreshInbox();
  return useMutation({
    // The string shape is retained only to fail closed during the detail-page cutover.
    mutationFn: async (boundary: ReadBoundary | string) => {
      if (typeof boundary === "string")
        throw new Error("A rendered message boundary is required.");
      const { error } = await supabase.rpc("mark_conversation_read", {
        p_actor_id: requireActor(actor),
        p_conversation_id: boundary.conversationId,
        p_message_id: boundary.messageId,
      });
      if (error) throw error;
    },
    onError: mutationError,
    onSettled: refresh,
  });
}
export function useToggleRead() {
  const actor = useActor();
  const refresh = useRefreshInbox();
  return useMutation({
    mutationFn: async ({
      conversation,
      isRead,
    }: {
      conversation: ConversationWithClient;
      isRead: boolean;
    }) => {
      const user = requireActor(actor);
      if (isRead) {
        if (!conversation.latest_message_id)
          throw new Error("No rendered message to mark read.");
        const { error } = await supabase.rpc("mark_conversation_read", {
          p_actor_id: user,
          p_conversation_id: conversation.id,
          p_message_id: conversation.latest_message_id,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("mark_conversation_unread", {
          p_actor_id: user,
          p_conversation_id: conversation.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => toast.success("Your read status was updated"),
    onError: mutationError,
    onSettled: refresh,
  });
}
export interface MetadataChange {
  conversation: ConversationWithClient;
  status?: ConversationWithClient["status"];
  assignedToId?: string | null;
  priority?: ConversationPriority;
  tags?: string[];
}
export function useUpdateConversationMetadata() {
  const actor = useActor();
  const refresh = useRefreshInbox();
  return useMutation({
    mutationFn: async ({ conversation: c, ...change }: MetadataChange) => {
      const { data, error } = await supabase.rpc(
        "update_conversation_metadata",
        {
          p_actor_id: requireActor(actor),
          p_conversation_id: c.id,
          p_expected_revision: c.revision,
          p_status: change.status ?? c.status,
          p_assigned_to_id:
            change.assignedToId === undefined
              ? c.assigned_to_id
              : change.assignedToId,
          p_priority: change.priority ?? c.priority,
          p_tags: change.tags ?? c.tags,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("Conversation updated"),
    onError: mutationError,
    onSettled: refresh,
  });
}
export function useMarkAllRead() {
  const actor = useActor();
  const refresh = useRefreshInbox();
  return useMutation({
    mutationFn: async () => {
      const user = requireActor(actor);
      const snapshot = await supabase.rpc("capture_inbox_read_snapshot");
      if (snapshot.error) throw snapshot.error;
      const { error } = await supabase.rpc("apply_inbox_read_snapshot", {
        p_actor_id: user,
        p_snapshot_id: snapshot.data,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      toast.success(
        "Active conversations marked through the captured messages. Later arrivals stay unread.",
      ),
    onError: mutationError,
    onSettled: refresh,
  });
}

export function useConversationMessages(conversationId: string | undefined) {
  const actor = useActor();
  const query = useInfiniteQuery({
    queryKey: ["messages", actor, conversationId],
    enabled: !!actor && !!conversationId,
    initialPageParam: null as Cursor | null,
    staleTime: 10_000,
    refetchInterval: pollInterval,
    refetchOnWindowFocus: true,
    queryFn: async ({ pageParam, signal }) => {
      let request = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize);
      if (pageParam)
        request = request.or(
          `created_at.lt.${pageParam.at},and(created_at.eq.${pageParam.at},id.lt.${pageParam.id})`,
        );
      const { data, error } = await request.abortSignal(signal);
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last) =>
      last.length === pageSize
        ? { at: last[last.length - 1].created_at, id: last[last.length - 1].id }
        : undefined,
  });
  const rows = query.data?.pages.flat() ?? [];
  const messages = [...new Map(rows.map((row) => [row.id, row])).values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  return { ...query, data: messages, messages };
}

export function useClientMessages(clientId: string | undefined) {
  const actor = useActor();
  return useQuery({
    queryKey: ["client-messages", actor, clientId],
    enabled: !!actor && !!clientId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*, conversations!inner(client_id)")
        .eq("conversations.client_id", clientId!)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
}
export function useConversation(conversationId: string | undefined) {
  const actor = useActor();
  return useQuery({
    queryKey: ["conversation", actor, conversationId],
    enabled: !!actor && !!conversationId,
    staleTime: 10_000,
    refetchInterval: pollInterval,
    queryFn: async (): Promise<ConversationWithClient | null> => {
      const { data: conv, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId!)
        .maybeSingle();
      if (error) throw error;
      if (!conv) return null;
      const [client, latest, cursor, flag] = await Promise.all([
        supabase.from("clients").select("*").eq("id", conv.client_id).single(),
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1),
        supabase
          .from("conversation_read_cursors")
          .select("read_at,message_id")
          .eq("user_id", actor!)
          .eq("conversation_id", conv.id)
          .maybeSingle(),
        supabase
          .from("conversation_unread_flags")
          .select("forced")
          .eq("user_id", actor!)
          .eq("conversation_id", conv.id)
          .maybeSingle(),
      ]);
      if (client.error) throw client.error;
      if (latest.error) throw latest.error;
      if (cursor.error) throw cursor.error;
      if (flag.error) throw flag.error;
      let unread = supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conv.id)
        .eq("sender_type", "CLIENT");
      if (cursor.data)
        unread = unread.or(
          `created_at.gt.${cursor.data.read_at},and(created_at.eq.${cursor.data.read_at},id.gt.${cursor.data.message_id})`,
        );
      const count = await unread;
      if (count.error) throw count.error;
      const message = latest.data[0];
      return {
        ...conv,
        is_read: !(flag.data?.forced || (count.count ?? 0) > 0),
        unread_count: count.count ?? 0,
        latest_message_id: message?.id ?? null,
        client: client.data,
        pets: [],
        last_message: message,
      };
    },
  });
}
export function useUnreadCount() {
  const actor = useActor();
  return useQuery({
    queryKey: ["unread-count", actor],
    enabled: !!actor,
    staleTime: 10_000,
    refetchInterval: pollInterval,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inbox_unread_totals");
      if (error) throw error;
      if (!data?.[0]) throw new Error("Unread totals unavailable");
      return data[0].unread_conversations;
    },
  });
}
