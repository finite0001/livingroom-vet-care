import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { denverLocal, denverInstant, shiftDay } from "../scheduling/time";
import { catalogList } from "../scheduling/catalog-api";
import {
  operationalTasksPage,
  operationalGenerationPolicy,
  readOperationalTask,
} from "./task-api";
import { type OperationalTask } from "./task-model";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { OperationalRecovery } from "./OperationalRecovery";
import { operationalSelectClass, operationalTimeLabel } from "./task-ui";
interface DailyTasksProps {
  day: string;
  full?: boolean;
}
interface ActorTasksProps extends DailyTasksProps {
  actor: string;
}
const openStates = ["pending", "started", "blocked", "needs_review"];
function ActorTasks({ actor, day, full = false }: ActorTasksProps) {
  const [filter, setFilter] = useState("open"),
    [role, setRole] = useState(""),
    [resource, setResource] = useState(""),
    [selected, setSelected] = useState<OperationalTask | null>(null),
    [nonce, setNonce] = useState(0),
    [closedLink, setClosedLink] = useState(""),
    [params] = useSearchParams();
  const range = useMemo(() => {
    try {
      return {
        from: denverInstant(day + "T00:00"),
        until: denverInstant(shiftDay(day, 1) + "T00:00"),
      };
    } catch {
      return null;
    }
  }, [day]);
  const query = useInfiniteQuery({
    queryKey: ["operational", actor, "tasks", day, resource],
    enabled: !!range,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      operationalTasksPage(
        range!.from,
        range!.until,
        resource || null,
        pageParam,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchOnWindowFocus: !selected,
  });
  const policy = useQuery({
    queryKey: ["operational", actor, "policy"],
    queryFn: operationalGenerationPolicy,
    refetchOnWindowFocus: !selected,
  });
  const catalog = useQuery({
    queryKey: ["operational", actor, "resource-catalog"],
    queryFn: () => catalogList("resource"),
    refetchOnWindowFocus: !selected,
  });
  const link = full ? params.get("task") : null;
  const linked = useQuery({
    queryKey: ["operational", actor, "task", link],
    enabled: !!link && link !== closedLink,
    queryFn: () => readOperationalTask(link!),
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (linked.data && link && link !== closedLink && !selected)
      setSelected(linked.data);
  }, [linked.data, link, closedLink, selected]);
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [],
    now = Date.now();
  const visible = rows
    .filter(
      (task) =>
        (!role ||
          task.enrollment.definition.eligible_roles.includes(
            role as "STAFF" | "TECH" | "DVM" | "ADMIN",
          )) &&
        (filter === "all" ||
          (filter === "open" && openStates.includes(task.current.state)) ||
          (filter === "mine" &&
            task.current.assignee_id === actor &&
            openStates.includes(task.current.state)) ||
          (filter === "unassigned" &&
            task.current.assignee_id === null &&
            openStates.includes(task.current.state)) ||
          (filter === "overdue" &&
            task.current.due_at !== null &&
            Date.parse(task.current.due_at) < now &&
            openStates.includes(task.current.state)) ||
          (filter === "needs_review" &&
            task.current.state === "needs_review") ||
          (filter === "completed" && task.current.state === "completed")),
    )
    .sort(
      (a, b) =>
        (a.current.due_at ? Date.parse(a.current.due_at) : 0) -
          (b.current.due_at ? Date.parse(b.current.due_at) : 0) ||
        a.id.localeCompare(b.id),
    );
  return (
    <section
      aria-label="Daily operational tasks"
      className="space-y-4 rounded-2xl border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Daily operational tasks</h2>
          <p className="text-xs text-muted-foreground">
            {day} · Denver · Includes earlier unfinished work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11 h-auto max-w-full whitespace-normal break-words"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh tasks
          </Button>
          {!full && (
            <Button
              className="min-h-11 h-auto max-w-full whitespace-normal break-words"
              variant="outline"
              asChild
            >
              <Link to={`/hub/tasks?date=${day}`}>Open full task list</Link>
            </Button>
          )}
        </div>
      </div>
      {policy.isError ? (
        <p role="alert">Generation status unavailable.</p>
      ) : policy.isPending ? (
        <p role="status">Loading generation status…</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {policy.data?.enabled
            ? "New task generation is enabled for its reviewed effective interval."
            : "New task generation is off. Existing obligations and their source updates remain visible."}{" "}
          <Link className="underline" to="/hub/tools/task-templates">
            Review templates and generation.
          </Link>
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor={`task-view-${full ? "full" : "panel"}`}>
            Task view
          </Label>
          <select
            className={operationalSelectClass}
            id={`task-view-${full ? "full" : "panel"}`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="open">Open work</option>
            <option value="mine">My tasks</option>
            <option value="unassigned">Unassigned</option>
            <option value="needs_review">Needs review</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Completed</option>
            <option value="all">All states</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`task-role-${full ? "full" : "panel"}`}>
            Eligible role
          </Label>
          <select
            className={operationalSelectClass}
            id={`task-role-${full ? "full" : "panel"}`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">All roles</option>
            <option value="STAFF">Staff</option>
            <option value="TECH">Technician</option>
            <option value="DVM">Veterinarian</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`task-resource-${full ? "full" : "panel"}`}>
            Resource
          </Label>
          <select
            className={operationalSelectClass}
            id={`task-resource-${full ? "full" : "panel"}`}
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          >
            <option value="">All resources</option>
            {catalog.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.published?.definition.name ??
                  item.current.definition.name}
                {item.published ? "" : " · retained resource"}
              </option>
            ))}
          </select>
          {catalog.isError && (
            <p role="alert" className="text-xs">
              Resource list unavailable.{" "}
              <Button
                className="min-h-11 h-auto max-w-full whitespace-normal break-words"
                variant="outline"
                onClick={() => void catalog.refetch()}
              >
                Retry resource list
              </Button>
            </p>
          )}
        </div>
      </div>
      {link && linked.isError && <p role="alert">Linked task unavailable.</p>}
      {!range ? (
        <p role="alert">Choose a valid calendar day.</p>
      ) : query.isPending ? (
        <p role="status">Loading operational tasks…</p>
      ) : query.isError ? (
        <p role="alert">
          Tasks unavailable.{" "}
          <Button
            className="min-h-11 h-auto max-w-full whitespace-normal break-words"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Retry task list
          </Button>
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm">No matching tasks in the loaded pages.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((task) => (
            <li key={task.id} className="space-y-2 rounded-xl border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold break-words">
                    {task.enrollment.definition.name}
                  </h3>
                  <p className="text-sm break-words">
                    {task.resource_name || "Retained resource"} ·{" "}
                    {task.assignee_name || "Unassigned"}
                  </p>
                  <p className="text-sm">
                    Due{" "}
                    {task.current.due_at
                      ? operationalTimeLabel(task.current.due_at)
                      : "time needs review"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusChip status={`task:${task.current.state}`} />
                  {task.current.due_at &&
                    Date.parse(task.current.due_at) < now &&
                    openStates.includes(task.current.state) && (
                      <StatusChip status="task:overdue" />
                    )}
                </div>
              </div>
              {task.assignee_eligible === false && (
                <p className="text-sm text-destructive">
                  Assignment needs review.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {task.actor_name || "Recorded system/staff action"} ·{" "}
                {operationalTimeLabel(task.current.recorded_at)}
              </p>
              <Button
                className="min-h-11 h-auto max-w-full whitespace-normal break-words"
                variant="outline"
                onClick={() => setSelected(task)}
              >
                Open checklist for {task.enrollment.definition.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            More tasks are available. Filters describe the loaded pages until
            all pages are loaded.
          </p>
          <Button
            className="min-h-11 h-auto max-w-full whitespace-normal break-words"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more operational tasks
          </Button>
        </div>
      )}
      {selected && (
        <TaskDetailDialog
          key={`${selected.id}:${nonce}`}
          task={selected}
          close={() => {
            setSelected(null);
            if (link) setClosedLink(link);
          }}
          reloaded={(task) => {
            setSelected(task);
            setNonce((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}
export function DailyTasksPanel(props: DailyTasksProps) {
  const { session } = useAuth();
  return session ? (
    <ActorTasks key={session.user.id} actor={session.user.id} {...props} />
  ) : null;
}
export default function DailyTasksPage() {
  usePageTitle("Daily tasks");
  const [params, setParams] = useSearchParams(),
    today = denverLocal(new Date()).slice(0, 10),
    day = params.get("date") || today;
  return (
    <main className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl">Daily tasks</h1>
        <p className="text-sm text-muted-foreground">
          Operational work, frozen checklists and recorded resource use.
        </p>
      </div>
      <div className="max-w-xs">
        <Label htmlFor="operational-task-day">Task day</Label>
        <Input
          className="min-h-11 h-auto max-w-full whitespace-normal break-words"
          id="operational-task-day"
          type="date"
          value={day}
          onChange={(e) => {
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("date", e.target.value);
                return next;
              },
              { replace: true },
            );
          }}
        />
      </div>
      <OperationalRecovery />
      <DailyTasksPanel day={day} full />
    </main>
  );
}
