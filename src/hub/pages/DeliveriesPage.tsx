import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import {
  useRetryOutboundDelivery,
  useCancelOutboundDelivery,
} from "@/hub/hooks/use-outbound-deliveries";
import {
  listDailyCommunications,
  readDailyCommunication,
} from "@/hub/features/daily-communications/api";
import {
  filtersSchema,
  initialFilters,
  statuses,
  statusLabels,
  type CommunicationRow,
  type CommunicationCursor,
  type CommunicationStatus,
} from "@/hub/features/daily-communications/model";
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const at = (stamp: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(stamp));
const tones: Record<CommunicationStatus, string> = {
  scheduled: "bg-muted text-muted-foreground",
  queued: "bg-info/10 text-info",
  processing: "bg-info/10 text-info",
  accepted: "bg-warning/10 text-warning",
  delivered: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  uncertain: "bg-warning/10 text-warning",
  suppressed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};
interface CommunicationCardProps {
  row: CommunicationRow;
  actor: string;
  admin: boolean;
  onChange: () => void;
}
function CommunicationCard({
  row,
  actor,
  admin,
  onChange,
}: CommunicationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const history = useQuery({
    queryKey: [
      "daily-communication-detail",
      actor,
      row.source,
      row.id,
      row.updated_at,
    ],
    queryFn: () => readDailyCommunication(row),
    enabled: expanded,
    retry: 1,
  });
  const retry = useRetryOutboundDelivery(),
    cancel = useCancelOutboundDelivery();
  const action = (kind: "retry" | "cancel") => {
    if (
      !window.confirm(
        kind === "retry"
          ? "Retry this retained failed delivery using its existing delivery workflow?"
          : "Cancel this retained queued delivery? The recorded message remains in history.",
      )
    )
      return;
    (kind === "retry" ? retry : cancel).mutate(
      { id: row.id, updated_at: row.updated_at },
      {
        onSuccess: () => {
          toast.success(
            kind === "retry"
              ? "Delivery requeued; delivery is not confirmed"
              : "Delivery cancelled",
          );
          onChange();
        },
        onError: () =>
          toast.error(
            "The delivery may have changed. Refresh and review it before trying again.",
          ),
      },
    );
  };
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`border-transparent ${tones[row.status]}`}>
            {statusLabels[row.status]}
          </Badge>
          <Badge variant="outline">
            {row.channel === "EMAIL" ? "Email" : "Text"}
          </Badge>
          {row.source === "legacy" && (
            <Badge variant="outline">Retained delivery</Badge>
          )}
        </div>
        <div>
          <h2 className="font-semibold">{row.summary}</h2>
          <p className="text-sm">
            {row.client_name ?? "Unlinked client"}
            {row.patient_name && ` · ${row.patient_name}`}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {row.recipient ?? "No current destination"}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {at(row.activity_at)} (Denver) · {row.attempt_count} recorded attempts
        </p>
        {row.reason && (
          <p className="text-sm text-muted-foreground">{row.reason}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {row.source_href && (
            <Button asChild variant="outline" size="sm">
              <Link to={row.source_href}>Open source</Link>
            </Button>
          )}
          {row.client_id && (
            <Button asChild variant="ghost" size="sm">
              <Link to={`/hub/client/${row.client_id}`}>Client</Link>
            </Button>
          )}
          {row.pet_id && (
            <Button asChild variant="ghost" size="sm">
              <Link to={`/hub/patient/${row.pet_id}`}>Patient</Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide history" : "Status and attempts"}
          </Button>
          {admin &&
            row.source === "outbox" &&
            ["failed", "suppressed"].includes(row.status) && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/hub/admin/outbox/${row.id}`}>Review retry</Link>
              </Button>
            )}
          {row.source === "legacy" && row.status === "failed" && (
            <Button
              variant="outline"
              size="sm"
              disabled={retry.isPending || cancel.isPending}
              onClick={() => action("retry")}
            >
              Retry retained delivery
            </Button>
          )}
          {row.source === "legacy" &&
            ["queued", "scheduled"].includes(row.status) && (
              <Button
                variant="outline"
                size="sm"
                disabled={retry.isPending || cancel.isPending}
                onClick={() => action("cancel")}
              >
                Cancel retained delivery
              </Button>
            )}
        </div>
        {expanded && (
          <section
            className="rounded-md bg-muted/50 p-3 text-sm"
            aria-label="Communication history"
          >
            {history.isPending ? (
              <p>Loading history…</p>
            ) : history.isError ? (
              <>
                <p role="alert">Could not load communication history.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void history.refetch()}
                >
                  Reload history
                </Button>
              </>
            ) : !history.data ? (
              <p>
                This row was superseded by its canonical message. Refresh the
                list.
              </p>
            ) : (
              <>
                <p>
                  Current status: {statusLabels[history.data.record.status]}
                </p>
                {history.data.record.accepted_at && (
                  <p>
                    Provider accepted: {at(history.data.record.accepted_at)}
                  </p>
                )}
                {history.data.record.delivered_at && (
                  <p>Delivered: {at(history.data.record.delivered_at)}</p>
                )}
                {history.data.attempts.length ? (
                  <ol className="mt-2 space-y-1">
                    {history.data.attempts.map((attempt) => (
                      <li key={attempt.attempt_number}>
                        Attempt {attempt.attempt_number} ·{" "}
                        {at(attempt.started_at)} ·{" "}
                        {attempt.outcome
                          ? statusLabels[attempt.outcome]
                          : "Started; result pending"}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No individual attempt history is stored for this row.</p>
                )}
              </>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
export default function DeliveriesPage() {
  usePageTitle("Daily communications");
  const { session, hasRole } = useAuth();
  const actor = session?.user.id ?? "";
  return (
    <DailyCommunicationsSession
      key={actor}
      actor={actor}
      admin={hasRole("ADMIN")}
    />
  );
}
interface SessionProps {
  actor: string;
  admin: boolean;
}
function DailyCommunicationsSession({ actor, admin }: SessionProps) {
  const [draft, setDraft] = useState(initialFilters),
    [applied, setApplied] = useState(draft);
  const [generation, setGeneration] = useState(0),
    [error, setError] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["daily-communications", actor, applied, generation],
    enabled: !!actor,
    retry: 1,
    initialPageParam: null as CommunicationCursor | null,
    queryFn: ({ pageParam }) => listDailyCommunications(applied, pageParam),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const refresh = () => setGeneration((n) => n + 1);
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = filtersSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError("");
    setApplied(parsed.data);
    refresh();
  };
  const set = (key: keyof typeof draft, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Daily communications</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled reminders, outgoing messages and delivery outcomes.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={list.isFetching}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </header>
      <form
        onSubmit={apply}
        className="space-y-3 rounded-lg border bg-card p-4"
        aria-label="Communication filters"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label htmlFor="daily-from">From (Denver date)</Label>
            <Input
              id="daily-from"
              type="date"
              value={draft.from}
              onChange={(e) => set("from", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="daily-to">Through (Denver date)</Label>
            <Input
              id="daily-to"
              type="date"
              value={draft.to}
              onChange={(e) => set("to", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="daily-channel">Channel</Label>
            <select
              id="daily-channel"
              className={selectClass}
              value={draft.channel}
              onChange={(e) => set("channel", e.target.value)}
            >
              <option value="">Email and text</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">Text</option>
            </select>
          </div>
          <div>
            <Label htmlFor="daily-status">Status</Label>
            <select
              id="daily-status"
              className={selectClass}
              value={draft.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="daily-search">Client or patient name</Label>
          <Input
            id="daily-search"
            value={draft.search}
            maxLength={200}
            onChange={(e) => set("search", e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Dates use the most recent attempt start, or the scheduled time for
          reminder jobs. Messages awaiting their first attempt use their
          creation date. Status updates alone do not move a message to another
          day.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit">Apply filters</Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Results use the last applied filters. Provider acceptance does not
        confirm delivery. Scheduled reminder jobs still require an enabled
        policy and final eligibility checks.
      </p>
      {list.isPending ? (
        <p role="status">Loading communications…</p>
      ) : list.isError && !rows.length ? (
        <div role="alert">
          <p>Could not load daily communications.</p>
          <Button variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {rows.length} communications loaded
            {list.data?.pages[0] &&
              ` · read ${at(list.data.pages[0].read_at)} (Denver)`}
            . Refresh to restart the list; new attempts can change its order.
          </p>
          {!rows.length ? (
            <EmptyState
              icon={Send}
              title="No communications in this range"
              description="Change the dates or filters to find earlier messages and scheduled reminder jobs."
            />
          ) : (
            rows.map((row) => (
              <CommunicationCard
                key={`${row.source}:${row.id}`}
                row={row}
                actor={actor}
                admin={admin}
                onChange={refresh}
              />
            ))
          )}
          {list.isFetchNextPageError && (
            <p role="alert">
              Could not load the next page. Your loaded results are retained.
            </p>
          )}
          {list.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage
                ? "Loading…"
                : "Load more communications"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
