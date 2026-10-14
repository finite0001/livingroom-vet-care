import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { denverLocal } from "../scheduling/time";
import {
  operationalAssignees,
  operationalTemplates,
  operationalTaskHistory,
  readOperationalTask,
  readOperationalAppointment,
} from "./task-api";
import {
  canonicalOperationalValue,
  type OperationalTask,
  type TaskRequest,
} from "./task-model";
import { useOperationalAction } from "./use-task-action";
import {
  OperationalDialog,
  OperationalActionStatus,
} from "./OperationalDialog";
import {
  operationalTimeLabel,
  operationalSelectClass,
  operationalLocal,
  operationalInstant,
} from "./task-ui";
import { refreshOperationalFacts } from "./task-invalidation";
interface TaskDetailProps {
  task: OperationalTask;
  close: () => void;
  reloaded: (task: OperationalTask) => void;
}
export function TaskDetailDialog({ task, close, reloaded }: TaskDetailProps) {
  const { session, roles, hasRole } = useAuth(),
    actor = session?.user.id ?? "",
    reviewer = hasRole("DVM") || hasRole("ADMIN"),
    eligible = task.enrollment.definition.eligible_roles.some((role) =>
      roles.includes(role),
    ),
    cache = useQueryClient();
  const closed = ["completed", "superseded"].includes(task.current.state);
  const [checked, setChecked] = useState(task.current.checked_ids),
    [note, setNote] = useState(""),
    [assignee, setAssignee] = useState(task.current.assignee_id ?? ""),
    [due, setDue] = useState(
      task.current.due_at ? operationalLocal(task.current.due_at) : "",
    ),
    [resolution, setResolution] = useState<"reject" | "earlier" | "later">(
      "reject",
    ),
    [reviewAttest, setReviewAttest] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [done, setDone] = useState(false),
    [reloadError, setReloadError] = useState("");
  const initial = useRef(
    canonicalOperationalValue({
      checked,
      note,
      assignee,
      due,
      resolution,
      reviewAttest,
    }),
  );
  const action = useOperationalAction(actor, "task", () => {
    setDone(true);
    refreshOperationalFacts(cache, actor);
    close();
  });
  const frozen = action.busy || action.pending,
    dirty =
      !done &&
      (frozen ||
        initial.current !==
          canonicalOperationalValue({
            checked,
            note,
            assignee,
            due,
            resolution,
            reviewAttest,
          }));
  const people = useQuery({
    queryKey: [
      "operational",
      actor,
      "assignees",
      task.enrollment.definition.eligible_roles,
    ],
    queryFn: () =>
      operationalAssignees(task.enrollment.definition.eligible_roles),
    refetchOnWindowFocus: !dirty,
  });
  const templates = useQuery({
    queryKey: ["operational", actor, "templates"],
    enabled: reviewer && !closed,
    queryFn: operationalTemplates,
    refetchOnWindowFocus: !dirty,
  });
  const source = useQuery({
    queryKey: [
      "operational",
      actor,
      "appointment",
      task.context.appointment?.id,
    ],
    enabled: !!task.context.appointment,
    queryFn: () => readOperationalAppointment(task.context.appointment!.id),
    refetchOnWindowFocus: !dirty,
  });
  const history = useInfiniteQuery({
    queryKey: ["operational", actor, "history", task.id],
    enabled: historyOpen,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => operationalTaskHistory(task.id, pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchOnWindowFocus: !dirty,
  });
  const sourceStale =
    !!source.data && source.data.version !== task.context.appointment?.version;
  const sourceUnavailable =
    !!task.context.appointment &&
    (source.isPending || source.isError || !source.data);
  const completeReady =
    eligible &&
    !closed &&
    task.current.state !== "needs_review" &&
    task.current.due_at !== null &&
    task.enrollment.definition.checklist.every(
      (item) => !item.required || checked.includes(item.id),
    );
  const replacement = templates.data?.find(
    (item) => item.id === task.template_id,
  )?.published;
  async function save(operation: TaskRequest["action"]) {
    try {
      await action.save({
        id: task.id,
        expected_version: task.version,
        context_hash: task.context_hash,
        action: operation,
        assignee_id:
          operation === "claim"
            ? actor
            : operation === "assign"
              ? assignee || null
              : null,
        checked_ids: operation === "complete" ? checked : [],
        note: note.trim(),
        due_at:
          operation === "resolve" ? operationalInstant(due, resolution) : null,
        template_version_id: operation === "replace" ? replacement!.id : null,
      });
    } catch (cause) {
      action.setError(
        cause instanceof Error
          ? cause.message
          : "Review the checklist and current source.",
      );
    }
  }
  async function reload() {
    if (
      dirty &&
      !window.confirm("Discard these unsaved choices and reload this task?")
    )
      return;
    try {
      const latest = await readOperationalTask(task.id);
      if (!latest) throw new Error("Task unavailable");
      reloaded(latest);
    } catch {
      setReloadError("Current task facts could not be reloaded.");
    }
  }
  return (
    <OperationalDialog
      title={task.enrollment.definition.name}
      description={`Frozen checklist · task revision ${task.version}. Changes to published templates do not rewrite completed work.`}
      dirty={dirty}
      busy={action.busy}
      pending={action.pending}
      close={close}
    >
      <section className="space-y-2 rounded-xl border p-3">
        <p className="font-semibold break-words">
          {task.resource_name || "Retained resource"}
        </p>
        <StatusChip status={`task:${task.current.state}`} />
        <p className="text-sm">
          Due{" "}
          {task.current.due_at
            ? operationalTimeLabel(task.current.due_at)
            : "time needs review"}{" "}
          · {task.assignee_name || "Unassigned"}
        </p>
        {task.assignee_eligible === false && (
          <p className="text-sm text-destructive">
            The assigned member is no longer eligible. Review the assignment.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {task.actor_name || "Recorded staff member"} ·{" "}
          {operationalTimeLabel(task.current.recorded_at)}
        </p>
      </section>
      <section
        aria-label="Current task source"
        className="space-y-2 rounded-xl border p-3"
      >
        <h3 className="font-semibold">Current source facts</h3>
        {task.context.appointment && (
          <>
            <StatusChip
              status={source.data?.status ?? task.context.appointment.status}
            />
            <p className="text-sm">
              {source.data?.patient_name
                ? `${source.data.patient_name} · `
                : ""}
              {source.data?.appointment_type || "Source visit"} ·{" "}
              {operationalTimeLabel(
                source.data?.scheduled_at ??
                  task.context.appointment.scheduled_at,
              )}
            </p>
            <Link
              className="inline-flex min-h-11 items-center underline"
              to={`/hub/schedule?date=${denverLocal(task.context.appointment.scheduled_at).slice(0, 10)}`}
            >
              Open source schedule
            </Link>
          </>
        )}
        {task.context.use && (
          <p className="text-sm">
            Actual use of{" "}
            {task.context.use.resource_name || "the recorded resource"}{" "}
            {task.context.use.current.facts.state === "open"
              ? "is still open"
              : `ended ${operationalTimeLabel(task.context.use.current.facts.ended_at!)}`}
            .
          </p>
        )}
        {task.context.appointment_uses.length > 0 && (
          <ul className="text-sm">
            {task.context.appointment_uses.map((use) => (
              <li key={use.id}>
                {use.resource_name || "Recorded resource"}:{" "}
                {use.current.facts.state === "open"
                  ? "use still open"
                  : "actual use ended"}
              </li>
            ))}
          </ul>
        )}
        {task.context.coverage.length > 0 && (
          <p className="text-sm">
            {task.context.coverage.length} recorded use revisions covered by
            this resource-day checklist.
          </p>
        )}
        {sourceUnavailable && (
          <p role="status" className="text-sm">
            Current visit details are not confirmed. Reload before an action.
          </p>
        )}
        {sourceStale && (
          <p role="alert" className="text-sm">
            The source changed after this task was loaded. Reload and review it.
          </p>
        )}
        <p className="text-sm break-words">{task.current.note}</p>
      </section>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save("complete");
        }}
      >
        <fieldset
          className="space-y-4"
          disabled={
            frozen ||
            closed ||
            (!eligible && !reviewer) ||
            sourceStale ||
            sourceUnavailable
          }
        >
          <section className="space-y-2">
            <h3 className="font-semibold">Frozen checklist</h3>
            <p className="text-sm break-words">
              {task.enrollment.definition.sop_reference}
            </p>
            {task.enrollment.definition.checklist.map((item) => (
              <label
                key={item.id}
                className="flex min-h-11 items-start gap-3 rounded-lg border p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-primary"
                  checked={checked.includes(item.id)}
                  disabled={!eligible}
                  onChange={(e) =>
                    setChecked((previous) =>
                      e.target.checked
                        ? [...previous, item.id]
                        : previous.filter((id) => id !== item.id),
                    )
                  }
                />
                <span className="text-sm break-words">
                  {item.label}
                  {item.required ? " · Required" : " · Optional"}
                </span>
              </label>
            ))}
          </section>
          {task.enrollment.definition.category === "restock" && (
            <p className="text-sm">
              Completing this checklist does not change stock.{" "}
              <Link className="underline" to="/hub/inventory">
                Record actual inventory transfers separately.
              </Link>
            </p>
          )}
          {!closed && (
            <>
              <div>
                <Label htmlFor="operational-task-note">Task action note</Label>
                <Textarea
                  id="operational-task-note"
                  required
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              {(eligible || reviewer) && (
                <section className="space-y-2">
                  <Label htmlFor="operational-task-assignee">
                    Eligible assignment
                  </Label>
                  <select
                    id="operational-task-assignee"
                    className={operationalSelectClass}
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {assignee &&
                      !people.data?.some(
                        (person) => person.id === assignee,
                      ) && (
                        <option value={assignee}>
                          {task.assignee_name || "Previous staff member"} · no
                          longer eligible
                        </option>
                      )}
                    {people.data?.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name || "Staff member"}
                      </option>
                    ))}
                  </select>
                  {people.isPending && (
                    <p role="status">Loading eligible staff…</p>
                  )}
                  {people.isError && (
                    <p role="alert">
                      Eligible staff unavailable.{" "}
                      <Button
                        type="button"
                        className="min-h-11"
                        variant="outline"
                        onClick={() => void people.refetch()}
                      >
                        Retry eligible staff
                      </Button>
                    </p>
                  )}
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    disabled={people.isPending || people.isError}
                    onClick={() => void save("assign")}
                  >
                    Save task assignment
                  </Button>
                </section>
              )}
              <div className="flex flex-wrap gap-2">
                {eligible &&
                  (!task.current.assignee_id ||
                    task.current.assignee_id === actor) && (
                    <Button
                      type="button"
                      className="min-h-11"
                      variant="outline"
                      onClick={() => void save("claim")}
                    >
                      Claim this task
                    </Button>
                  )}
                {eligible &&
                  ["pending", "blocked"].includes(task.current.state) && (
                    <Button
                      type="button"
                      className="min-h-11"
                      variant="outline"
                      onClick={() => void save("start")}
                    >
                      Start this task
                    </Button>
                  )}
                {eligible && (
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    onClick={() => void save("block")}
                  >
                    Record task blocked
                  </Button>
                )}
                <Button className="min-h-11" disabled={!completeReady}>
                  Complete reviewed checklist
                </Button>
              </div>
              {reviewer && task.current.state === "needs_review" && (
                <section className="space-y-2 rounded-xl border p-3">
                  <h3 className="font-semibold">Resolve source review</h3>
                  <Label htmlFor="operational-task-due">
                    Reviewed due time (Denver)
                  </Label>
                  <Input
                    id="operational-task-due"
                    className="min-h-11"
                    type="datetime-local"
                    step="1"
                    value={due}
                    onChange={(e) => {
                      setDue(e.target.value);
                      setReviewAttest(false);
                    }}
                  />
                  <Label htmlFor="operational-task-dst">
                    Repeated-hour interpretation
                  </Label>
                  <select
                    id="operational-task-dst"
                    className={operationalSelectClass}
                    value={resolution}
                    onChange={(e) => {
                      setResolution(e.target.value as typeof resolution);
                      setReviewAttest(false);
                    }}
                  >
                    <option value="reject">Require an unambiguous time</option>
                    <option value="earlier">Earlier occurrence</option>
                    <option value="later">Later occurrence</option>
                  </select>
                  <label className="flex min-h-11 items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0 accent-primary"
                      checked={reviewAttest}
                      onChange={(e) => setReviewAttest(e.target.checked)}
                    />
                    <span className="text-sm">
                      I reviewed the current source facts and this task’s
                      continued necessity.
                    </span>
                  </label>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={!reviewAttest || !due}
                    onClick={() => void save("resolve")}
                  >
                    Save reviewed task resolution
                  </Button>
                </section>
              )}
              {reviewer &&
                replacement &&
                replacement.id !== task.enrollment.template_version_id && (
                  <section className="space-y-2 rounded-xl border p-3">
                    <p className="text-sm">
                      A newer published checklist is available (v
                      {replacement.version}). Replacement preserves this task’s
                      prior revisions.
                    </p>
                    <Button
                      type="button"
                      className="min-h-11"
                      variant="outline"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Replace this unfinished task with the current reviewed checklist? Prior checklist evidence will remain in history.",
                          )
                        )
                          void save("replace");
                      }}
                    >
                      Apply reviewed replacement
                    </Button>
                  </section>
                )}
            </>
          )}
        </fieldset>
        <OperationalActionStatus action={action} />
      </form>
      {!eligible && !reviewer && !closed && (
        <p className="text-sm">
          This work is assigned to the checklist’s eligible roles:{" "}
          {task.enrollment.definition.eligible_roles.join(", ")}.
        </p>
      )}
      {reloadError && <p role="alert">{reloadError}</p>}
      {!frozen && (
        <Button
          className="min-h-11"
          type="button"
          variant="outline"
          onClick={() => void reload()}
        >
          Reload current task
        </Button>
      )}
      <section aria-label="Task history" className="space-y-2">
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() => setHistoryOpen((value) => !value)}
        >
          {historyOpen ? "Hide task history" : "View task history"}
        </Button>
        {historyOpen &&
          (history.isPending ? (
            <p role="status">Loading task history…</p>
          ) : history.isError ? (
            <p role="alert">
              History unavailable.{" "}
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => void history.refetch()}
              >
                Retry task history
              </Button>
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {history.data.pages
                  .flatMap((page) => page.items)
                  .map((item) => (
                    <li
                      key={item.revision.id}
                      className="rounded-xl border p-3"
                    >
                      <p className="font-medium">
                        Revision {item.revision.version} ·{" "}
                        {item.revision.event.replace(/_/g, " ")} ·{" "}
                        {item.revision.state.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.actor_name || "Recorded system/staff action"} ·{" "}
                        {operationalTimeLabel(item.revision.recorded_at)}
                      </p>
                      <p className="text-sm break-words">
                        {item.revision.note}
                      </p>
                      <p className="text-sm break-words">
                        Checklist: {item.enrollment.definition.name} ·{" "}
                        {item.enrollment.definition.sop_reference}
                      </p>
                      <ul className="text-sm">
                        {item.enrollment.definition.checklist.map((check) => (
                          <li key={check.id}>
                            {item.revision.checked_ids.includes(check.id)
                              ? "✓ "
                              : ""}
                            {check.label}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
              {history.hasNextPage && (
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  Load older task history
                </Button>
              )}
            </>
          ))}
      </section>
    </OperationalDialog>
  );
}
