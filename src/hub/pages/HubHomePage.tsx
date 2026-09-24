import { Link } from "react-router-dom";
import {
  BellRing,
  CalendarDays,
  Check,
  ClipboardList,
  FileText,
  MailWarning,
  MessageSquare,
  Package,
  PawPrint,
  Pill,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hub/contexts/auth-context";
import { PageShell } from "@/hub/components/shared/PageShell";
import { useGuidedMode } from "@/hub/components/layout/guided-mode";
import {
  StatusChip,
  statusToneClass,
  type StatusTone,
} from "@/hub/components/shared/StatusChip";
import { useUnreadCount } from "@/hub/hooks/use-conversations";
import {
  useClockIn,
  useCurrentShift,
} from "@/hub/hooks/use-time-clock";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { formatDenverDayLabel, formatDenverTime, denverLocal } from "@/hub/features/scheduling/time";
import {
  drivingDirections,
  practiceBaseAddress,
  visitAddress,
} from "@/hub/features/scheduling/housecall-route";
import { useScheduleDay } from "@/hub/features/scheduling/use-schedule-day";
import { useAppointmentStatus } from "@/hub/features/scheduling/use-appointment-status";
import { cn } from "@/lib/utils";

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

const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function visitTypeLabel(visitType: string): string {
  return visitType === "housecall" ? "House call" : "Clinic";
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

const quickActions: { label: string; icon: LucideIcon; path: string }[] = [
  { label: "Messages", icon: MessageSquare, path: "/hub/chats" },
  { label: "Schedule", icon: CalendarDays, path: "/hub/schedule" },
  { label: "Care reminders", icon: BellRing, path: "/hub/tools/care-reminders" },
  { label: "Clients", icon: Users, path: "/hub/clients" },
  { label: "Patients", icon: PawPrint, path: "/hub/patients" },
  { label: "Inventory", icon: Package, path: "/hub/inventory" },
  { label: "Templates", icon: FileText, path: "/hub/tools/templates" },
  { label: "New inquiries", icon: ClipboardList, path: "/hub/inquiries" },
];

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  path: string;
  tone: StatusTone;
  icon: LucideIcon;
  /** Positive phrasing used in the "All caught up" card when count is zero. */
  clearLabel: string;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = item.icon;
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          statusToneClass[item.tone],
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{item.title}</p>
        <p className="text-xs text-muted-foreground">{item.detail}</p>
        <Link
          to={item.path}
          className="mt-1 inline-block text-sm font-semibold text-terracotta-dark underline-offset-2 hover:underline"
        >
          {item.actionLabel} →
        </Link>
      </div>
    </li>
  );
}

function CaughtUpRow({ item }: { item: AttentionItem }) {
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="tone-info flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <p className="text-sm text-foreground">{item.clearLabel}</p>
    </li>
  );
}

/** Direction C's morning checklist, styled with Direction A's warm tokens. */
function StartYourDayChecklist({
  steps,
}: {
  steps: { key: string; title: string; detail: string; done: boolean; action?: { label: string; onClick?: () => void; path?: string } }[];
}) {
  const firstOpen = steps.findIndex((step) => !step.done);
  return (
    <section
      aria-labelledby="start-your-day"
      className="rounded-2xl border-2 border-dashed border-gold/60 bg-card p-5 shadow-card"
    >
      <h2 id="start-your-day" className="font-display text-lg">
        Start your day
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A few small things, then you're ready for the first visit.
      </p>
      <ol className="mt-3 space-y-3">
        {steps.map((step, index) => {
          const state = step.done ? "done" : index === firstOpen ? "now" : "todo";
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-3 rounded-2xl bg-muted/50 p-3",
                step.done && "opacity-75",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  state === "done" && "tone-success",
                  state === "now" && "bg-primary text-primary-foreground",
                  state === "todo" && "tone-warning",
                )}
              >
                {step.done ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold text-foreground",
                    step.done && "line-through",
                  )}
                >
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {step.action && !step.done && (
                step.action.path ? (
                  <Button size="sm" className="guided-touch shrink-0" asChild>
                    <Link to={step.action.path}>{step.action.label}</Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="guided-touch shrink-0"
                    onClick={step.action.onClick}
                  >
                    {step.action.label}
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function HubHomePage() {
  const { profile, session, hasRole } = useAuth();
  const actor = session?.user.id;
  const isAdmin = hasRole("ADMIN");
  const guided = useGuidedMode().guided;
  usePageTitle("Today");

  const today = denverLocal(new Date()).slice(0, 10);
  const schedule = useScheduleDay(today, 1);
  const updateStatus = useAppointmentStatus();

  const visits = schedule.data?.appointments ?? [];
  const liveVisits = visits.filter(
    (visit) => !TERMINAL_STATUSES.includes(visit.status),
  );
  const nowMs = Date.now();
  const hero =
    liveVisits.find((visit) => visit.status === "CONFIRMED") ??
    liveVisits.find((visit) => {
      const start = Date.parse(visit.scheduled_at);
      return start <= nowMs && nowMs <= start + visit.duration_minutes * 60_000;
    }) ??
    liveVisits.find(
      (visit) =>
        Date.parse(visit.scheduled_at) + visit.duration_minutes * 60_000 >=
        nowMs,
    ) ??
    liveVisits[0] ??
    null;
  const restOfDay = visits.filter((visit) => visit.id !== hero?.id);
  const plannedToday = visits.filter(
    (visit) => visit.status === "SCHEDULED" || visit.status === "CONFIRMED",
  ).length;

  // --- Attention counts (same queries the old count cards used) ---
  const unread = useUnreadCount();

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
    const day = today;
    const [vaccines, labs] = await Promise.all([
      supabase
        .from("patient_vaccine_due_plans")
        .select("id", { count: "exact", head: true })
        .eq("status", "current")
        .eq("reminders_enabled", true)
        .lte("current_due_on", day),
      supabase
        .from("patient_lab_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["planned", "ordered"])
        .not("due_date", "is", null)
        .lte("due_date", day),
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

  // Admin-gated: the query stays disabled (and unread) for non-admins, and the
  // item below is only built for admins, so the card can never get stuck on
  // "Loading…" for staff without the admin role.
  const outbox = useCount("outbox", !!actor && isAdmin, async () => {
    const { count, error } = await supabase
      .from("communication_outbox")
      .select("id", { count: "exact", head: true })
      .eq("state", "failed");
    if (error) throw error;
    if (count === null) throw new Error("Outbox failure count unavailable");
    return count;
  });

  const inquiries = useCount("inquiries", !!actor, async () => {
    const { data, error } = await supabase.rpc("website_inquiry_open_count");
    if (error) throw error;
    return Number(data ?? 0);
  });

  const attentionItems: AttentionItem[] = [
    ...(isAdmin
      ? [
          {
            key: "outbox",
            title:
              (outbox.data ?? 0) === 1
                ? "1 message failed to send"
                : `${outbox.data ?? 0} messages failed to send`,
            detail: "Something a client was waiting for never arrived.",
            actionLabel: "Review and resend",
            path: "/hub/admin/outbox",
            tone: "destructive" as StatusTone,
            icon: MailWarning,
            clearLabel: "Every message and invoice went out on time.",
          },
        ]
      : []),
    {
      key: "unread",
      title:
        (unread.data ?? 0) === 1
          ? "1 conversation is waiting for a reply"
          : `${unread.data ?? 0} conversations are waiting for a reply`,
      detail: "Clients are waiting to hear back from the practice.",
      actionLabel: "Open inbox",
      path: "/hub/chats",
      tone: "info",
      icon: MessageSquare,
      clearLabel: "Your inbox is clear.",
    },
    {
      key: "inquiries",
      title:
        (inquiries.data ?? 0) === 1
          ? "1 new inquiry to look at"
          : `${inquiries.data ?? 0} new inquiries to look at`,
      detail: "Someone wrote in through the website.",
      actionLabel: "Review inquiries",
      path: "/hub/inquiries",
      tone: "warning",
      icon: ClipboardList,
      clearLabel: "No new inquiries waiting.",
    },
    {
      key: "refills",
      title:
        (refills.data ?? 0) === 1
          ? "1 refill request is waiting for approval"
          : `${refills.data ?? 0} refill requests are waiting for approval`,
      detail: "Approving tells the team to prepare the medication.",
      actionLabel: "Approve refills",
      path: "/hub/tools/refills",
      tone: "success",
      icon: Pill,
      clearLabel: "No refills waiting for approval.",
    },
    {
      key: "reminders",
      title:
        (reminders.data ?? 0) === 1
          ? "1 vaccine or lab reminder is due"
          : `${reminders.data ?? 0} vaccine and lab reminders are due`,
      detail: "Clients with care due today need a nudge.",
      actionLabel: "Review reminders",
      path: "/hub/tools/care-reminders",
      tone: "warning",
      icon: BellRing,
      clearLabel: "No reminders are due today.",
    },
    {
      key: "unsigned",
      title:
        (unsigned.data ?? 0) === 1
          ? "1 note is still unsigned"
          : `${unsigned.data ?? 0} notes are still unsigned`,
      detail: "Signed notes keep every patient record complete.",
      actionLabel: "Review notes",
      path: "/hub/patients",
      tone: "warning",
      icon: FileText,
      clearLabel: "Every note is signed.",
    },
  ];

  const counts: Record<string, number | undefined> = {
    outbox: outbox.data,
    unread: unread.data,
    inquiries: inquiries.data,
    refills: refills.data,
    reminders: reminders.data,
    unsigned: unsigned.data,
  };
  const countReady = (key: string) => typeof counts[key] === "number";
  const problems = attentionItems.filter(
    (item) => countReady(item.key) && (counts[item.key] ?? 0) > 0,
  );
  const caughtUp = attentionItems.filter(
    (item) => countReady(item.key) && counts[item.key] === 0,
  );
  const allCounted = attentionItems.every((item) => countReady(item.key));

  // --- Guided checklist data ---
  const shift = useCurrentShift();
  const clockIn = useClockIn();
  const shiftEntry = shift.data;
  const onDuty = !!shiftEntry;
  const checklistSteps = [
    {
      key: "clock-in",
      title: "Clock in for your shift",
      detail: onDuty
        ? `On duty since ${formatDenverTime(shiftEntry.clock_in_at)}.`
        : "Tap the button so the team knows you're here.",
      done: onDuty,
      action: onDuty
        ? undefined
        : {
            label: clockIn.isPending ? "Clocking in…" : "Clock in",
            onClick: () => clockIn.mutate(undefined),
          },
    },
    ...(isAdmin
      ? [
          {
            key: "outbox",
            title:
              (outbox.data ?? 0) > 0
                ? `Resend ${outbox.data} ${(outbox.data ?? 0) === 1 ? "message" : "messages"} that failed overnight`
                : "No failed sends to fix",
            detail:
              (outbox.data ?? 0) > 0
                ? "An invoice or reminder never reached its client."
                : "Everything sent overnight arrived.",
            done: (outbox.data ?? 0) === 0 && countReady("outbox"),
            action: { label: "Resend now", path: "/hub/admin/outbox" },
          },
        ]
      : []),
    {
      key: "inquiries",
      title:
        (inquiries.data ?? 0) > 0
          ? `Say hello to ${inquiries.data} new ${(inquiries.data ?? 0) === 1 ? "inquiry" : "inquiries"}`
          : "No new inquiries to match",
      detail:
        (inquiries.data ?? 0) > 0
          ? "Someone asked about appointments and isn't matched to a household yet."
          : "The website inbox is handled.",
      done: (inquiries.data ?? 0) === 0 && countReady("inquiries"),
      action: { label: "Match inquiry", path: "/hub/inquiries" },
    },
    {
      key: "refills",
      title:
        (refills.data ?? 0) > 0
          ? `Approve ${refills.data} refill ${(refills.data ?? 0) === 1 ? "request" : "requests"}`
          : "No refills waiting for approval",
      detail:
        (refills.data ?? 0) > 0
          ? "A pet's medication is ready to be prepared once you approve it."
          : "Every refill request is handled.",
      done: (refills.data ?? 0) === 0 && countReady("refills"),
      action: { label: "Approve refills", path: "/hub/tools/refills" },
    },
  ];

  // --- Right now hero ---
  const heroAddress = hero ? visitAddress(hero.address_snapshot) : null;
  const heroDirections = heroAddress
    ? drivingDirections(practiceBaseAddress, heroAddress)
    : null;
  const heroTime = hero ? formatDenverTime(hero.scheduled_at) : null;
  const heroHappening = hero?.status === "CONFIRMED";

  const firstName = profile?.first_name || "there";
  const visitLine =
    plannedToday === 0
      ? "No visits on the books today"
      : `${plannedToday} ${plannedToday === 1 ? "visit" : "visits"} today`;

  return (
    <PageShell className="max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl">
          {getGreeting()}, {firstName}.
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {formatDenverDayLabel(today)} ·{" "}
          {guided ? (
            "Here's your day, step by step."
          ) : (
            <>
              {visitLine}
              {problems.length > 0 && (
                <>
                  {", and "}
                  <strong className="font-semibold text-terracotta-dark">
                    {problems.length} small{" "}
                    {problems.length === 1 ? "thing needs" : "things need"} your
                    attention
                  </strong>
                  {" before the first house call."}
                </>
              )}
              {problems.length === 0 &&
                (allCounted ? " — everything is in hand." : "")}
            </>
          )}
        </p>
      </header>

      {guided && <StartYourDayChecklist steps={checklistSteps} />}

      <div className="grid items-start gap-5 lg:grid-cols-[1.9fr_1fr]">
        <div className="min-w-0 space-y-5">
          {/* Right now */}
          <section
            aria-label="Right now"
            className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card md:p-6"
          >
            <span
              className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-terracotta to-gold"
              aria-hidden="true"
            />
            {schedule.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading today's visits…
              </p>
            ) : schedule.isError ? (
              <div role="alert">
                <p className="text-sm text-muted-foreground">
                  Today's visits are unavailable.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => void schedule.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : hero ? (
              <>
                <p className="pl-2 text-xs font-semibold uppercase tracking-widest text-terracotta-dark">
                  {heroHappening ? "Right now" : "Up next"} · {heroTime}
                </p>
                <h2 className="mt-2 pl-2 font-display text-2xl">
                  {hero.pets?.name ?? "Patient"} — {hero.appointment_type}
                </h2>
                <p className="mt-1 pl-2 text-sm text-muted-foreground">
                  {[
                    hero.pets?.species,
                    visitTypeLabel(hero.visit_type),
                    `${hero.duration_minutes} min`,
                    hero.clients?.full_name
                      ? `with ${hero.clients.full_name}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {heroAddress && (
                  <p className="mt-3 pl-2 text-sm">
                    <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-lg bg-primary/15 align-middle text-terracotta-dark">
                      <PawPrint className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    {heroAddress}
                    {heroDirections && (
                      <>
                        {" · "}
                        <a
                          className="font-medium text-terracotta-dark underline-offset-2 hover:underline"
                          href={heroDirections}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Get directions
                        </a>
                      </>
                    )}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3 pl-2">
                  {hero.status === "SCHEDULED" && (
                    <Button
                      className="guided-touch"
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        updateStatus.mutate({
                          appointment: hero,
                          status: "CONFIRMED",
                        })
                      }
                    >
                      Check in for this visit
                    </Button>
                  )}
                  {heroHappening && (
                    <Button
                      className="guided-touch"
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        updateStatus.mutate({
                          appointment: hero,
                          status: "COMPLETED",
                        })
                      }
                    >
                      Complete visit
                    </Button>
                  )}
                  {hero.pet_id ? (
                    <Button variant="outline" asChild>
                      <Link to={`/hub/patient/${hero.pet_id}`}>
                        Open {hero.pets?.name ?? "patient"}'s record
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" asChild>
                      <Link to="/hub/schedule">Open schedule</Link>
                    </Button>
                  )}
                </div>
              </>
            ) : visits.length > 0 ? (
              <>
                <p className="pl-2 text-xs font-semibold uppercase tracking-widest text-terracotta-dark">
                  All done
                </p>
                <h2 className="mt-2 pl-2 font-display text-2xl">
                  All done for today
                </h2>
                <p className="mt-1 pl-2 text-sm text-muted-foreground">
                  Every visit today is finished — {visits.filter((v) => v.status === "COMPLETED").length} completed in
                  total. Time to tidy up and head home.
                </p>
              </>
            ) : (
              <>
                <p className="pl-2 text-xs font-semibold uppercase tracking-widest text-terracotta-dark">
                  Today
                </p>
                <h2 className="mt-2 pl-2 font-display text-2xl">
                  Nothing on the books today
                </h2>
                <p className="mt-1 pl-2 text-sm text-muted-foreground">
                  No visits are scheduled. Enjoy the quiet, or book the next
                  one from the schedule.
                </p>
                <div className="mt-4 pl-2">
                  <Button variant="outline" asChild>
                    <Link to="/hub/schedule">Open schedule</Link>
                  </Button>
                </div>
              </>
            )}
          </section>

          {/* The rest of your day */}
          <section
            aria-label="The rest of your day"
            className="rounded-2xl border border-border bg-card py-3 shadow-card"
          >
            <h2 className="px-5 pt-2 text-sm font-semibold text-foreground">
              The rest of your day
            </h2>
            {schedule.isPending ? (
              <p className="px-5 py-3 text-sm text-muted-foreground" role="status">
                Loading…
              </p>
            ) : restOfDay.length === 0 ? (
              <p className="px-5 py-3 text-sm text-muted-foreground">
                {hero
                  ? "That's the only visit today."
                  : "No visits scheduled for today."}
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border/70">
                {restOfDay.map((visit) => {
                  const address = visitAddress(visit.address_snapshot);
                  const subtitle = guided
                    ? `${visit.appointment_type} with ${visit.clients?.full_name ?? "the client"}${address ? ` at ${address}` : ""}, starting at ${formatDenverTime(visit.scheduled_at)}.`
                    : [
                        visit.appointment_type,
                        visit.clients?.full_name,
                        address,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                  return (
                    <li
                      key={visit.id}
                      className="grid grid-cols-[76px_1fr_auto] items-center gap-3 px-5 py-3"
                    >
                      <div className="tabular-nums">
                        <p className="text-[15px] font-bold leading-tight text-foreground">
                          {formatDenverTime(visit.scheduled_at)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {visitTypeLabel(visit.visit_type)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {visit.pets?.name ?? "Patient"} —{" "}
                          {visit.appointment_type}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {subtitle}
                        </p>
                      </div>
                      <StatusChip status={visit.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Right rail */}
        <aside className="min-w-0 space-y-4">
          {problems.length > 0 && (
            <section
              aria-label="Needs a little care"
              className="rounded-2xl border border-gold/50 bg-gold/15 p-5 shadow-card"
            >
              <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                Needs a little care
                <span className="ml-auto rounded-full bg-warning px-2 py-0.5 text-xs font-bold text-warning-foreground">
                  {problems.length}
                </span>
              </h2>
              <ul className="mt-2 divide-y divide-black/5">
                {problems.map((item) => (
                  <AttentionRow key={item.key} item={item} />
                ))}
              </ul>
            </section>
          )}
          {caughtUp.length > 0 && (
            <section
              aria-label="All caught up"
              className="rounded-2xl border border-border bg-card p-5 shadow-card"
            >
              <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                All caught up
                <span className="tone-success ml-auto flex h-5 w-5 items-center justify-center rounded-full">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
              </h2>
              <ul className="mt-2 divide-y divide-border/60">
                {caughtUp.map((item) => (
                  <CaughtUpRow key={item.key} item={item} />
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {/* Quick actions, demoted to a compact secondary row */}
      <section aria-labelledby="home-actions">
        <h2
          id="home-actions"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Jump to
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Link
              key={action.path}
              to={action.path}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-card transition-colors hover:border-primary/40 hover:text-terracotta-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <action.icon
                className="h-3.5 w-3.5 text-terracotta-dark"
                aria-hidden="true"
              />
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
