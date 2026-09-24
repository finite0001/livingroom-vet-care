import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import * as api from "./OperationsApi";
import {
  displayTime,
  conversationLink,
  householdLink,
  patientLink,
  type Cursor,
} from "./OperationsState";
interface PageData<T> {
  items: T[];
  has_more: boolean;
  observed_at?: string;
}
interface SectionProps<T> {
  title: string;
  load: (cursor: Cursor | null) => Promise<PageData<T>>;
  // Optional: a section whose rows are a fixed set has no next page and must not
  // have to invent a cursor.
  next?: (row: T) => Cursor;
  render: (row: T) => ReactNode;
  children?: ReactNode;
}
function QueueSection<T>({
  title,
  load,
  next,
  render,
  children,
}: SectionProps<T>) {
  const [data, setData] = useState<PageData<T> | null>(null),
    [cursor, setCursor] = useState<Cursor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const generation = useRef(0);
  const fetch = useCallback(
    async (position: Cursor | null) => {
      const serial = ++generation.current;
      setBusy(true);
      setError(false);
      setData(null);
      try {
        const result = await load(position);
        if (serial === generation.current) {
          setData(result);
          setCursor(position);
        }
      } catch {
        if (serial === generation.current) setError(true);
      } finally {
        if (serial === generation.current) setBusy(false);
      }
    },
    [load],
  );
  useEffect(() => {
    const tracker = generation;
    void fetch(null);
    return () => {
      tracker.current++;
    };
  }, [fetch]);
  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
      {busy && <p role="status">Loading current observation…</p>}
      {error && (
        <p role="alert">
          This section is unavailable. No current observation is shown.
        </p>
      )}
      {data && (
        <>
          {data.observed_at && (
            <p className="text-sm text-muted-foreground">
              Observed {displayTime(data.observed_at)}
            </p>
          )}
          {!data.items.length && (
            <p>
              No items in this observation. This does not establish service
              health.
            </p>
          )}
          <ul className="space-y-3">
            {data.items.map((row, i) => (
              <li className="space-y-1 border-t pt-3" key={i}>
                {render(row)}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void fetch(null)}
        >
          Refresh {title.toLowerCase()}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !cursor}
          onClick={() => void fetch(null)}
        >
          First {title.toLowerCase()} page
        </Button>
        <Button
          variant="outline"
          disabled={busy || !data?.has_more || !data.items.length}
          onClick={() => {
            const last = data?.items.at(-1);
            if (last && next) void fetch(next(last));
          }}
        >
          Next {title.toLowerCase()} page
        </Button>
      </div>
    </section>
  );
}
function Overview() {
  const [data, setData] = useState<Awaited<
      ReturnType<typeof api.overview>
    > | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const serial = ++generation.current;
    setData(null);
    setError(false);
    setBusy(true);
    try {
      const result = await api.overview();
      if (serial === generation.current) setData(result);
    } catch {
      if (serial === generation.current) setError(true);
    } finally {
      if (serial === generation.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const tracker = generation;
    void refresh();
    return () => {
      tracker.current++;
    };
  }, [refresh]);
  return (
    <section
      aria-label="Operations counts"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h2 className="text-lg font-semibold">Operations counts</h2>
      {busy && <p>Loading observation…</p>}
      {error && (
        <p role="alert">
          Counts unavailable. Other sections may still be available.
        </p>
      )}
      {data && (
        <>
          <p>Observed {displayTime(data.observed_at)}</p>
          <dl className="grid gap-4 md:grid-cols-2">
            <div>
              <dt className="font-semibold">Outgoing messages</dt>
              <dd>
                {data.outbox.pending} pending · {data.outbox.expired_claims}{" "}
                expired claims · {data.outbox.uncertain} uncertain ·{" "}
                {data.outbox.failed} failed
              </dd>
              <dd>
                Oldest pending: {displayTime(data.outbox.oldest_pending_at)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Incoming messages</dt>
              <dd>
                {data.inbound.processing_review} processing reviews ·{" "}
                {data.inbound.unassigned} unmatched messages
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Payment notifications</dt>
              <dd>
                {data.stripe.queued} queued · {data.stripe.processing}{" "}
                processing · {data.stripe.quarantined} held
              </dd>
              <dd>
                Oldest unfinished:{" "}
                {displayTime(data.stripe.oldest_unfinished_at)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Reminders</dt>
              <dd>
                {data.reminders.candidate_count} candidates ·{" "}
                {data.reminders.blocked_handoffs} blocked handoffs ·{" "}
                {data.reminders.unresolved_runs} unresolved scheduler runs
              </dd>
              <dd>
                Oldest candidate:{" "}
                {displayTime(data.reminders.oldest_candidate_at)}
              </dd>
              <dd>
                Last completed: {displayTime(data.reminders.last_completed_at)}
              </dd>
              <dd>
                {data.reminders.last_run
                  ? `Latest run: ${data.reminders.last_run.outcome === "started" ? "started; outcome unknown" : data.reminders.last_run.outcome}`
                  : "No recorded run"}
              </dd>
            </div>
          </dl>
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
        Refresh operations counts
      </Button>
    </section>
  );
}
function OperationsSession() {
  const [filter, setFilter] = useState("attention");
  const loadOutbox = useCallback(
    (cursor: Cursor | null) => api.outbox(cursor, filter),
    [filter],
  );
  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Operations</h1>
        <p>
          Observed unfinished work and scheduler evidence. Counts and pages can
          change between reads. Empty queues do not confirm deployment,
          scheduling or provider readiness.
        </p>
        <nav
          aria-label="Operations workflows"
          className="flex flex-wrap gap-4 text-primary underline"
        >
          <Link to="/hub/admin/outbox">Recorded outgoing retries</Link>
          <Link to="/hub/inbox/review">Review unmatched messages</Link>
          <Link to="/hub/inbox/processing">Review incoming processing</Link>
          <Link to="/hub/tools/care-reminders">Care reminders</Link>
          <Link to="/hub/admin">Payment processing recovery</Link>
        </nav>
      </header>
      <Overview />
      <QueueSection
        key={filter}
        title="Outgoing work"
        load={loadOutbox}
        next={(r) => ({ at: r.created_at, id: r.id })}
        render={(r) => (
          <>
            <p>
              {r.channel} · {r.state} · {r.attempt_count} attempts
              {r.lease_expired ? " · expired claim" : ""}
            </p>
            <p>
              {r.reason?.split("_").join(" ") ?? "No review reason recorded"}
              {r.delivery_failure_kind ? ` · ${r.delivery_failure_kind}` : ""}
            </p>
            <p className="text-sm">
              Created {displayTime(r.created_at)} · updated{" "}
              {displayTime(r.updated_at)}
            </p>
            <p className="text-sm">
              First attempt {displayTime(r.first_attempt_at)} · accepted{" "}
              {displayTime(r.accepted_at)} · delivered{" "}
              {displayTime(r.delivered_at)}
            </p>
            <div className="flex gap-3 text-primary underline">
              <Link to={`/hub/admin/outbox/${r.id}`}>
                Review outgoing retry
              </Link>
              <Link to={conversationLink(r.conversation_id)}>
                Open conversation
              </Link>
              {r.client_id && (
                <Link to={householdLink(r.client_id)}>
                  Open household billing
                </Link>
              )}
            </div>
          </>
        )}
      >
        <label className="grid gap-1 text-sm">
          Outgoing state
          <select
            aria-label="Outgoing state"
            className="rounded-md border bg-background p-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              "attention",
              "pending",
              "expired_claim",
              "uncertain",
              "failed",
              "accepted",
            ].map((v) => (
              <option value={v} key={v}>
                {v.split("_").join(" ")}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          Accepted is provider acceptance; recipient delivery requires its own
          evidence. Review uncertain sends in their existing conversation
          workflow.
        </p>
      </QueueSection>
      <QueueSection
        title="Reminder candidates"
        load={api.candidates}
        next={(r) => ({ key: r.cursor_key })}
        render={(r) => (
          <>
            <p>
              {r.source_kind.split("_").join(" ")} · {r.channel} · eligible{" "}
              {displayTime(r.eligible_at)}
            </p>
            <p>
              Source version {r.source_version} · template version{" "}
              {r.template_version}
              {r.job_id ? " · existing job" : " · job not yet created"}
            </p>
            {r.pet_id && (
              <Link
                className="text-primary underline"
                to={patientLink(r.pet_id)}
              >
                Open patient
              </Link>
            )}
          </>
        )}
      >
        <p>
          Candidates are eligible for scheduler consideration. Final source and
          recipient checks still apply; this is not guaranteed delivery.
        </p>
      </QueueSection>
      <QueueSection
        title="Blocked reminder handoffs"
        load={api.blocks}
        next={(r) => ({ at: r.created_at, kind: r.job_kind, id: r.job_id })}
        render={(r) => (
          <>
            <p>
              {r.job_kind.split("_").join(" ")} · {r.state.split("_").join(" ")}
            </p>
            <p>{r.reason.split("_").join(" ")}</p>
            <p className="break-all text-sm">Reminder job: {r.job_id}</p>
            <p className="break-all text-sm">
              Source: {r.source_kind ?? "not available"} {r.source_id ?? ""}
            </p>
            {r.appointment_id && (
              <p className="break-all text-sm">
                Appointment reference: {r.appointment_id}
              </p>
            )}
            {r.pet_id && (
              <Link
                className="block text-primary underline"
                to={patientLink(r.pet_id)}
              >
                Open source patient
              </Link>
            )}
            {r.appointment_id && (
              <Link className="block text-primary underline" to="/hub/schedule">
                Open schedule to locate appointment
              </Link>
            )}
            <p>
              Created {displayTime(r.created_at)} · invalidated{" "}
              {displayTime(r.invalidated_at)}
            </p>
            <Link
              className="text-primary underline"
              to="/hub/tools/care-reminders"
            >
              Open care reminder policies
            </Link>
          </>
        )}
      />
      <QueueSection
        title="Scheduler runs"
        load={api.runs}
        next={(r) => ({ at: r.started_at, id: r.run_id })}
        render={(r) => (
          <>
            <p>
              {r.outcome === "started"
                ? "Started; outcome unknown"
                : r.outcome === "failed"
                  ? "Queue transaction rolled back"
                  : "Completed queue transaction"}
            </p>
            <p className="break-all text-sm">
              Run reference: {r.run_id} · requested limit {r.requested_limit}
            </p>
            <p>
              Started {displayTime(r.started_at)} · finished{" "}
              {displayTime(r.finished_at)}
            </p>
            {r.counts ? (
              <p>
                {r.counts.queued} queued · {r.counts.blocked} blocked ·{" "}
                {r.counts.skipped} skipped · no provider dispatch
              </p>
            ) : (
              <p>Queue counts unknown.</p>
            )}
          </>
        )}
      >
        <p>
          No recorded run means scheduling is unverified. An unfinished run does
          not establish failure or zero work. This page does not invoke a
          worker.
        </p>
      </QueueSection>
      <QueueSection
        title="Scheduled jobs"
        load={api.schedulerJobs}
        render={(j) => (
          <>
            <p className={j.stale ? "text-destructive" : undefined}>
              {j.outcome === "ok"
                ? "Worker accepted the call"
                : j.outcome === "dispatched"
                  ? "Sent; no answer recorded yet"
                  : j.outcome === "configuration_missing"
                    ? "Installed but not configured"
                    : "Worker refused or failed the call"}
            </p>
            <p className="break-all text-sm">
              {j.job} ·{" "}
              {j.status_code === null ? "no status" : `HTTP ${j.status_code}`}
            </p>
            <p>
              Requested {displayTime(j.requested_at)}
              {j.stale ? " · overdue for its cadence" : ""}
            </p>
            {j.error_message ? <p>{j.error_message}</p> : null}
          </>
        )}
      >
        <p>
          Each row is the last attempt for that job. A job that is overdue, or
          whose worker refused the call, is shown here rather than passing
          silently. Installed is not enabled: every worker still refuses to
          deliver until its own gate is switched on.
        </p>
      </QueueSection>
    </div>
  );
}
export default function OperationsPage() {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active && hasRole("ADMIN") ? (
    <OperationsSession key={session.user.id} />
  ) : (
    <p className="p-4">Administrator access required.</p>
  );
}
