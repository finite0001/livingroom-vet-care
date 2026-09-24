import { Link } from "react-router-dom";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  MessageSquare,
  Pill,
  Users,
} from "lucide-react";
import { useAuth } from "@/hub/contexts/auth-context";
import { PageShell } from "@/hub/components/shared/PageShell";
import { PageHeader } from "@/hub/components/shared/PageHeader";
import { useUnreadCount } from "@/hub/hooks/use-conversations";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";

// The newest native tables (e.g. native_refills) are RPC-only and not in the
// generated types, so the refill count uses the same permissive cast as the
// refill API rather than a typed table select.
interface Database {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      [key: string]: { Args: Record<string, unknown>; Returns: unknown };
    };
  };
}
const client = supabase as unknown as SupabaseClient<Database>;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const quickActions = [
  { label: "Inbox", icon: MessageSquare, path: "/hub/chats" },
  { label: "Schedule", icon: CalendarDays, path: "/hub/schedule" },
  { label: "Care reminders", icon: CalendarDays, path: "/hub/tools/care-reminders" },
  { label: "Clients", icon: Users, path: "/hub/clients" },
  { label: "Patients", icon: Users, path: "/hub/patients" },
  { label: "Inventory", icon: Pill, path: "/hub/inventory" },
  { label: "Templates", icon: FileText, path: "/hub/tools/templates" },
  { label: "Website inquiries", icon: ClipboardList, path: "/hub/inquiries" },
];

interface TodayItem {
  key: string;
  label: string;
  path: string;
}

const todayItems: TodayItem[] = [
  { key: "appointments", label: "Today's appointments", path: "/hub/schedule" },
  { key: "unread", label: "Unread conversations for you", path: "/hub/chats" },
  { key: "refills", label: "Open refill requests", path: "/hub/tools/refills" },
  { key: "reminders", label: "Reminders due", path: "/hub/tools/care-reminders" },
  { key: "unsigned", label: "Unsigned notes", path: "/hub/patients" },
  { key: "outbox", label: "Outbox failures", path: "/hub/admin/outbox" },
];

function CountCard({
  label,
  path,
  value,
  pending,
  failed,
  retry,
}: {
  label: string;
  path: string;
  value: number | null | undefined;
  pending: boolean;
  failed: boolean;
  retry: () => unknown;
}) {
  const unavailable = failed || (!pending && typeof value !== "number");
  return (
    <section aria-label={label} className="rounded-xl border bg-card p-4">
      <Link
        to={path}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold text-foreground" aria-live="polite">
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

function useCount(
  key: string,
  enabled: boolean,
  queryFn: () => Promise<number>,
) {
  return useQuery({
    queryKey: ["today", key],
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn,
  });
}

export default function HubHomePage() {
  const { profile, session, hasRole } = useAuth();
  const actor = session?.user.id;
  const isAdmin = hasRole("ADMIN");
  usePageTitle("Today");

  const unread = useUnreadCount();

  const appointments = useCount("appointments", !!actor, async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const { count, error } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .in("status", ["SCHEDULED", "CONFIRMED"]);
    if (error) throw error;
    if (count === null) throw new Error("Appointment count unavailable");
    return count;
  });

  const refills = useCount("refills", !!actor, async () => {
    const { data, error } = await client.rpc("list_native_refills", {
      p_pet_id: null,
      p_before_at: null,
      p_before_id: null,
      p_limit: 100,
    });
    if (error) throw error;
    const page = data as { refills?: { refill?: { state?: string } }[] };
    const open = (page?.refills ?? []).filter(
      (r) => r.refill?.state === "open",
    ).length;
    return open;
  });

  const reminders = useCount("reminders", !!actor, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [vaccines, labs] = await Promise.all([
      supabase
        .from("patient_vaccine_due_plans")
        .select("id", { count: "exact", head: true })
        .eq("status", "current")
        .eq("reminders_enabled", true)
        .lte("current_due_on", today),
      supabase
        .from("patient_lab_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["planned", "ordered"])
        .not("due_date", "is", null)
        .lte("due_date", today),
    ]);
    if (vaccines.error) throw vaccines.error;
    if (labs.error) throw labs.error;
    if (vaccines.count === null || labs.count === null)
      throw new Error("Reminder count unavailable");
    return vaccines.count + labs.count;
  });

  const unsigned = useCount("unsigned", !!actor, async () => {
    const { count, error } = await supabase
      .from("clinical_encounters")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft");
    if (error) throw error;
    if (count === null) throw new Error("Unsigned note count unavailable");
    return count;
  });

  const outbox = useCount("outbox", !!actor && isAdmin, async () => {
    const { count, error } = await supabase
      .from("communication_outbox")
      .select("id", { count: "exact", head: true })
      .eq("state", "failed");
    if (error) throw error;
    if (count === null) throw new Error("Outbox failure count unavailable");
    return count;
  });

  const counts: Record<string, ReturnType<typeof useCount>> = {
    appointments,
    unread,
    refills,
    reminders,
    unsigned,
    outbox,
  };

  return (
    <PageShell className="max-w-3xl space-y-6">
      <PageHeader
        title="Today"
        description={`${getGreeting()}, ${profile?.first_name || "there"} — The Living Room Vet`}
      />

      <section aria-label="Today at a glance" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {todayItems.map((item) => {
          const q = counts[item.key];
          if (!q) return null;
          return (
            <CountCard
              key={item.key}
              label={item.label}
              path={item.path}
              value={q.data}
              pending={q.isPending}
              failed={q.isError}
              retry={q.refetch}
            />
          );
        })}
      </section>

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
    </PageShell>
  );
}
