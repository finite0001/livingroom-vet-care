import { Button } from "@/components/ui/button";
import { WorkforceForm } from "./WorkforceForm";
import { useTeam } from "./use-team";
import { denverInstant } from "../scheduling/time";
export function QuickTasksPanel() {
  const { query, perform, pending, error, userId } = useTeam();
  const d = query.data;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-display text-xl">Quick tasks & kennel duties</h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {query.isPending ? (
        <p>Loading staff tasks…</p>
      ) : query.isError ? (
        <p role="alert">{query.error.message}</p>
      ) : (
        d && (
          <>
            {d.tasks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No quick tasks yet.
              </p>
            )}
            {d.tasks.map((t) => (
              <div key={t.id} className="space-y-2 rounded border p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3
                    className={
                      t.done
                        ? "text-muted-foreground line-through"
                        : "font-medium"
                    }
                  >
                    {t.title}
                  </h3>
                  <span className="text-sm">
                    {d.staff.find((s) => s.id === t.assignee)?.name ??
                      "Unassigned"}
                  </span>
                </div>
                <p className="text-sm">
                  Due{" "}
                  {new Date(t.due_at).toLocaleString("en-US", {
                    timeZone: "America/Denver",
                  })}
                  {t.rotation_id && " · Rotating duty"}
                </p>
                {t.note && (
                  <p className="text-sm text-muted-foreground">{t.note}</p>
                )}
                {(!t.assignee || t.assignee === userId || d.can_manage) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void perform(
                        "task_status",
                        { done: !t.done, version: t.version },
                        t.id,
                      )
                    }
                  >
                    {t.done ? "Reopen" : "Mark complete"}
                  </Button>
                )}
                {d.can_manage && (
                  <label className="ml-3 text-sm">
                    Reassign
                    <select
                      className="ml-2 rounded border bg-background p-2"
                      aria-label={`Reassign ${t.title}`}
                      value={t.assignee ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        void perform(
                          "assign_task",
                          {
                            assignee: e.target.value || null,
                            version: t.version,
                          },
                          t.id,
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {d.staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
            {d.tasks.length === 300 && (
              <p>
                Showing the first 300 tasks; complete older tasks to reduce this
                list.
              </p>
            )}
            <WorkforceForm
              title="Add a quick task"
              pending={pending}
              fields={[
                { name: "title", label: "Task" },
                { name: "note", label: "Instructions", optional: true },
                { name: "due", label: "Due (Denver)", type: "datetime-local" },
                {
                  name: "assignee",
                  label: "Assign to",
                  optional: true,
                  options: d.staff
                    .filter((s) => d.can_manage || s.id === userId)
                    .map((s) => ({ value: s.id, label: s.name })),
                },
              ]}
              submit={(v, requestId) =>
                perform(
                  "task",
                  {
                    title: v.title,
                    note: v.note,
                    assignee: v.assignee || null,
                    due_at: denverInstant(String(v.due)),
                  },
                  requestId,
                )
              }
            />
          </>
        )
      )}
    </section>
  );
}
