import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import {
  operationalReconciliationPolicy,
  operationalReconciliationRuns,
  operationalReconciliationStatus,
  type ReconciliationCursor,
} from "./task-api";
import { OperationalReconciliationSettings } from "./OperationalReconciliationSettings";
import { operationalTimeLabel } from "./task-ui";

interface ReviewerPanelProps {
  actor: string;
}
function ReviewerPanel({ actor }: ReviewerPanelProps) {
  const [editing, setEditing] = useState(false),
    [cursor, setCursor] = useState<ReconciliationCursor | null>(null);
  const policy = useQuery({
    queryKey: ["operational", actor, "reconciliation-policy"],
    queryFn: operationalReconciliationPolicy,
    refetchOnWindowFocus: !editing,
  });
  const status = useQuery({
    queryKey: ["operational", actor, "reconciliation-status"],
    queryFn: operationalReconciliationStatus,
  });
  const runs = useQuery({
    queryKey: ["operational", actor, "reconciliation-runs", cursor],
    queryFn: () => operationalReconciliationRuns(cursor),
  });
  return (
    <section
      aria-label="Operational reconciliation"
      className="space-y-4 rounded-2xl border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Operational reconciliation</h2>
          <p className="text-sm text-muted-foreground">
            Saved task checks, separate from scheduler HTTP acknowledgments.
          </p>
        </div>
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() => setEditing(true)}
        >
          Review task reconciliation
        </Button>
      </div>
      {policy.isPending
        ? <p role="status">Loading reconciliation policy…</p>
        : policy.isError
        ? <p role="alert">Current reconciliation policy unavailable.</p>
        : (
          <>
            <p>
              {policy.data?.enabled
                ? "Reconciliation policy enabled"
                : "Reconciliation policy off"}
              {policy.data
                ? ` · review v${policy.data.version}`
                : " · no review recorded"}.
            </p>
            {policy.data?.window_from && policy.data.window_until && (
              <p className="text-sm">
                Appointment window:{" "}
                {operationalTimeLabel(policy.data.window_from)} to{" "}
                {operationalTimeLabel(policy.data.window_until)}.
              </p>
            )}
          </>
        )}
      {status.isPending
        ? <p role="status">Loading timetable observation…</p>
        : status.isError
        ? <p role="alert">Timetable and pending-run observation unavailable.</p>
        : (
          <>
            <p>
              Timetable: {status.data.cron_registered
                ? (status.data.cron_active ? "active" : "inactive")
                : "not registered"} · every 5 minutes when active.
            </p>
            {status.data.pending_run_id && (
              <p className="break-all text-sm">
                Pending run:{" "}
                {status.data.pending_run_id}. Its next attempt keeps the
                original request.
              </p>
            )}
          </>
        )}
      <p className="text-sm text-muted-foreground">
        Worker configuration is not established by this page. An enabled policy
        or an accepted HTTP call does not establish a completed task check.
      </p>
      <Link
        to="/hub/tasks"
        className="inline-flex min-h-11 items-center underline"
      >
        Open daily tasks and unresolved work
      </Link>
      <h3 className="font-semibold">Saved reconciliation runs</h3>
      {runs.isPending
        ? <p role="status">Loading reconciliation runs…</p>
        : runs.isError
        ? (
          <p role="alert">
            Saved reconciliation runs unavailable. No result is established.
          </p>
        )
        : runs.data.items.length
        ? (
          <ul className="space-y-4">
            {runs.data.items.map((run) => (
              <li className="space-y-2 border-t pt-3" key={run.run_id}>
                <p className="font-semibold">
                  {run.outcome === "completed"
                    ? "Committed task check"
                    : run.outcome === "started"
                    ? "Started; result unconfirmed"
                    : run.outcome === "paused"
                    ? "Paused after policy changed"
                    : "Task check rolled back"}
                </p>
                <p className="break-all text-sm">
                  Run: {run.run_id} · policy v{run.policy_version}
                </p>
                <p className="text-sm">
                  Started {operationalTimeLabel(run.started_at)}
                  {run.finished_at
                    ? ` · finished ${operationalTimeLabel(run.finished_at)}`
                    : ""}
                </p>
                <p className="text-sm">
                  Appointment window: {operationalTimeLabel(run.window_from)} to
                  {" "}
                  {operationalTimeLabel(run.window_until)}.
                </p>
                <p className="text-sm">
                  Limit {run.requested_limit} sources · {run.fan_out_limit}{" "}
                  task changes per source · {run.budget_ms / 1000}{" "}
                  second budget.
                </p>
                {run.counts
                  ? (
                    <p>
                      {run.counts.examined} examined · {run.counts.generated}
                      {" "}
                      generated · {run.counts.revised} revised ·{" "}
                      {run.counts.unresolved} sources needing review.
                    </p>
                  )
                  : <p>Committed counts unknown.</p>}
                {run.checkpoint
                  ? (
                    <p className="break-all text-sm">
                      Checkpoint v{run.checkpoint.version} ·{" "}
                      {run.checkpoint.lane} ·{" "}
                      {run.checkpoint.after_id ?? "no continuation ID"} ·{" "}
                      {run.sweep_complete
                        ? "sweep complete; changes are checked again next sweep"
                        : "sweep continues"}.
                    </p>
                  )
                  : (
                    <p className="text-sm">
                      No checkpoint advancement established.
                    </p>
                  )}
                {run.failure_code && (
                  <p className="text-sm">
                    Recorded reason: {run.failure_code.split("_").join(" ")}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )
        : (
          <p>
            No saved runs on this page. Reconciliation has not been established
            by this observation.
          </p>
        )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          variant="outline"
          disabled={runs.isFetching || policy.isFetching || status.isFetching}
          onClick={() => {
            void policy.refetch();
            void status.refetch();
            void runs.refetch();
          }}
        >
          Refresh reconciliation
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={runs.isFetching || !cursor}
          onClick={() => setCursor(null)}
        >
          First reconciliation page
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={runs.isFetching || !runs.data?.next}
          onClick={() => {
            if (runs.data?.next) setCursor(runs.data.next);
          }}
        >
          Next reconciliation page
        </Button>
      </div>
      {editing && (
        <OperationalReconciliationSettings close={() => setEditing(false)} />
      )}
    </section>
  );
}
export function OperationalReconciliationPanel() {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active && (hasRole("DVM") || hasRole("ADMIN"))
    ? <ReviewerPanel key={session.user.id} actor={session.user.id} />
    : null;
}
