import { Link } from "react-router-dom";
import {
  MessageSquare,
  ClipboardList,
  Users,
  FileText,
  CalendarDays,
  Pill,
} from "lucide-react";
import { useAuth } from "@/hub/contexts/AuthContext";
import { PageShell } from "@/hub/components/shared/PageShell";
import { PageHeader } from "@/hub/components/shared/PageHeader";
import {
  useConversations,
  useUnreadCount,
} from "@/hub/hooks/use-conversations";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
const quickActions = [
  { label: "Inbox", icon: MessageSquare, path: "/hub/chats" },
  { label: "Schedule", icon: CalendarDays, path: "/hub/schedule" },
  {
    label: "Care reminders",
    icon: CalendarDays,
    path: "/hub/tools/care-reminders",
  },
  { label: "Clients", icon: Users, path: "/hub/clients" },
  { label: "Inventory", icon: Pill, path: "/hub/inventory" },
  { label: "Templates", icon: FileText, path: "/hub/tools/templates" },
  { label: "Website inquiries", icon: ClipboardList, path: "/hub/inquiries" },
  { label: "Tickets", icon: ClipboardList, path: "/hub/tickets" },
];
interface CountCardProps {
  label: string;
  path: string;
  value: number | null | undefined;
  pending: boolean;
  failed: boolean;
  retry: () => unknown;
}
function CountCard({
  label,
  path,
  value,
  pending,
  failed,
  retry,
}: CountCardProps) {
  const unavailable = failed || (!pending && typeof value !== "number");
  return (
    <section aria-label={label} className="rounded-xl border bg-card p-4">
      <Link
        to={path}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className="mt-1 text-lg font-semibold text-foreground"
          aria-live="polite"
        >
          {unavailable ? "Unavailable" : pending ? "Loading…" : value}
        </p>
      </Link>
      {unavailable && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => void retry()}
        >
          Retry {label.toLowerCase()}
        </Button>
      )}
    </section>
  );
}

export default function HubHomePage() {
  const { profile, session } = useAuth();
  const actor = session?.user.id;
  usePageTitle("Hub Home");
  const unread = useUnreadCount();
  // Reuse the same actor-scoped, personal-read projection and invalidation keys as the inbox.
  const recent = useConversations({ status: "ACTIVE" });
  const active = useQuery({
    queryKey: ["conversations", actor, "active-count"],
    enabled: !!actor,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "ACTIVE");
      if (error) throw error;
      if (count === null)
        throw new Error("Active conversation count unavailable");
      return count;
    },
  });
  const tickets = useQuery({
    queryKey: ["tickets", "open-count", actor],
    enabled: !!actor,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "OPEN");
      if (error) throw error;
      if (count === null) throw new Error("Ticket count unavailable");
      return count;
    },
  });
  return (
    <PageShell className="max-w-3xl space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${profile?.first_name || "there"}`}
        description="The Living Room Vet — Staff workspace"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CountCard
          label="Unread conversations for you"
          path="/hub/chats"
          value={unread.data}
          pending={unread.isPending}
          failed={unread.isError}
          retry={unread.refetch}
        />
        <CountCard
          label="Active conversations"
          path="/hub/chats"
          value={active.data}
          pending={active.isPending}
          failed={active.isError}
          retry={active.refetch}
        />
        <CountCard
          label="Open tickets"
          path="/hub/tickets"
          value={tickets.data}
          pending={tickets.isPending}
          failed={tickets.isError}
          retry={tickets.refetch}
        />
      </div>
      <section aria-labelledby="home-actions">
        <h2 id="home-actions" className="mb-3 text-sm font-semibold">
          Quick actions
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {quickActions.map((action) => (
            <Link
              key={action.path}
              to={action.path}
              className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <action.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-xs font-semibold">{action.label}</span>
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="home-recent">
        <h2 id="home-recent" className="mb-3 text-sm font-semibold">
          Recent active conversations
        </h2>
        {recent.isError ? (
          <div role="alert" className="space-y-2 rounded-xl border p-4">
            <p>Recent conversations could not be loaded.</p>
            <Button variant="outline" onClick={() => void recent.refetch()}>
              Retry recent conversations
            </Button>
          </div>
        ) : recent.isPending ? (
          <p role="status">Loading recent conversations…</p>
        ) : recent.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active conversations.
          </p>
        ) : (
          <div className="space-y-2">
            {recent.data.slice(0, 3).map((conversation) => (
              <Link
                key={conversation.id}
                to={`/hub/conversation/${conversation.id}`}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm",
                      !conversation.is_read && "font-semibold",
                    )}
                  >
                    {conversation.client.full_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {conversation.last_message?.content ?? "No messages"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {conversation.is_read ? "Read by you" : "Unread for you"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
