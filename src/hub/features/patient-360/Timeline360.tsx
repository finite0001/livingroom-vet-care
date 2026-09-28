import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, Award, Bell, CalendarDays, DollarSign, FileText, FlaskConical, MessageSquare,
  Phone, Pill, Receipt, Send, Stethoscope, Syringe, Voicemail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTimeline360 } from "./api";
import {
  TIMELINE_FILTERS, formatDay, groupByDay, timelineEntryView,
  type TimelineFilter, type TimelineView,
} from "./model";

const ICONS: Record<TimelineView["icon"], typeof Activity> = {
  calendar: CalendarDays, stethoscope: Stethoscope, chart: Activity, syringe: Syringe, flask: FlaskConical,
  file: FileText, award: Award, pill: Pill, receipt: Receipt, dollar: DollarSign, message: MessageSquare,
  phone: Phone, voicemail: Voicemail, bell: Bell, send: Send,
};

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" });

interface Timeline360Props {
  scope: "patient" | "household";
  id: string;
  clientId: string;
  /** Filters offered as chips; the first is selected initially. */
  filters?: TimelineFilter[];
  title?: string;
  /** Show the pet name on each entry (household view). */
  showPet?: boolean;
}

/** Unified, filterable, paginated history across every system for a pet or household. */
export function Timeline360({ scope, id, clientId, filters, title = "Timeline", showPet = scope === "household" }: Timeline360Props) {
  const offered = useMemo(() => TIMELINE_FILTERS.filter((f) => !filters || filters.includes(f.id)), [filters]);
  const [filter, setFilter] = useState<TimelineFilter>(offered[0]?.id ?? "all");
  const query = useTimeline360(scope, id, filter);
  const views = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.entries).map((entry) => timelineEntryView(entry, { clientId })),
    [query.data, clientId],
  );
  const days = groupByDay(views);
  const headingId = `timeline-${scope}-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border bg-card p-4 shadow-card md:p-5">
      <h2 id={headingId} className="font-display text-lg">{title}</h2>
      {offered.length > 1 && (
        <div role="group" aria-label="Filter timeline" className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {offered.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={cn(
                "min-h-[36px] shrink-0 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === option.id ? "border-terracotta bg-terracotta text-primary-foreground" : "bg-background hover:bg-accent",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3">
        {query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">Loading timeline…</p>
        ) : query.isError ? (
          <div role="alert" className="text-sm">
            Timeline could not be loaded.{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        ) : views.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded here yet.</p>
        ) : (
          <ol className="space-y-4" aria-label={`${title} entries`}>
            {days.map((group) => (
              <li key={group.day}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatDay(group.day)}</p>
                <ul className="mt-1 divide-y rounded-xl border bg-background">
                  {group.items.map((item) => <TimelineRow key={item.key} item={item} showPet={showPet} />)}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {query.hasNextPage && (
          <Button variant="outline" className="mt-3 w-full md:w-auto" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? "Loading…" : "Load older entries"}
          </Button>
        )}
        {query.isFetchNextPageError && <p role="alert" className="mt-2 text-sm text-destructive">Older entries could not be loaded. Try again.</p>}
      </div>
    </section>
  );
}

function TimelineRow({ item, showPet }: { item: TimelineView; showPet: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <li data-kind={item.kind}>
      <Link
        to={item.href}
        className="flex min-h-[44px] items-start gap-3 p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{item.title}</span>
            {item.status && <span className={cn("status-chip", `tone-${item.status.tone}`)}>{item.status.label}</span>}
          </span>
          {item.detail && <span className="block break-words text-xs text-muted-foreground line-clamp-2">{item.detail}</span>}
          <span className="block text-xs text-muted-foreground">
            {item.label !== item.title && `${item.label} · `}
            <time dateTime={item.at}>{TIME.format(new Date(item.at))}</time>
            {showPet && item.petName && ` · ${item.petName}`}
          </span>
        </span>
        {item.amount && <span className="shrink-0 text-sm tabular-nums">{item.amount}</span>}
      </Link>
    </li>
  );
}
