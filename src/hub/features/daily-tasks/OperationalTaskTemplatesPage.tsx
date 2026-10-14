import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { operationalTemplates } from "./task-api";
import { type OperationalTemplate } from "./task-model";
import { TaskTemplateEditor } from "./TaskTemplateEditor";
import { OperationalRecovery } from "./OperationalRecovery";
import { operationalTimeLabel } from "./task-ui";
import { OperationalGenerationSettings } from "./OperationalGenerationSettings";
interface ActorTemplatesProps {
  actor: string;
  reviewer: boolean;
}
function ActorTemplates({ actor, reviewer }: ActorTemplatesProps) {
  const [editing, setEditing] = useState<
      OperationalTemplate | null | undefined
    >(),
    [settings, setSettings] = useState(false),
    [reloadNonce, setReloadNonce] = useState(0),
    [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["operational", actor, "templates"],
    queryFn: operationalTemplates,
    refetchOnWindowFocus: editing === undefined && !settings,
  });
  async function reload() {
    try {
      const result = await query.refetch();
      if (result.error) throw result.error;
      const current = result.data?.find((value) => value.id === editing?.id);
      if (!current) throw new Error("Saved template is unavailable");
      setEditing(current);
      setReloadNonce((value) => value + 1);
    } catch {
      setError("Saved template could not be reloaded.");
    }
  }
  return (
    <main className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl">
            Operational templates
          </h1>
          <p className="text-sm text-muted-foreground">
            Reviewed cleaning, preparation, restocking and housecall checklists.
          </p>
        </div>
        {reviewer && (
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 h-auto max-w-full whitespace-normal break-words"
              onClick={() => setEditing(null)}
            >
              New operational draft
            </Button>
            <Button
              className="min-h-11 h-auto max-w-full whitespace-normal break-words"
              variant="outline"
              onClick={() => setSettings(true)}
            >
              Review task generation
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/hub/tools/appointment-catalog"
        >
          Review appointment types and resources
        </Link>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/hub/tasks"
        >
          Daily tasks
        </Link>
      </div>
      <OperationalRecovery />
      {error && <p role="alert">{error}</p>}
      {query.isPending ? (
        <p role="status">Loading operational templates…</p>
      ) : query.isError ? (
        <div role="alert">
          Templates unavailable.{" "}
          <Button
            className="min-h-11 h-auto max-w-full whitespace-normal break-words"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Retry templates
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-5 shadow-card">
          <h2 className="font-display text-xl">No reviewed templates yet</h2>
          <p className="mt-2 text-sm">
            Create drafts from the practice’s actual SOPs and resources.
            Publication is a separate veterinarian or administrator review.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {query.data.map((entry) => (
            <li
              key={entry.id}
              className="space-y-2 rounded-2xl border bg-card p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl break-words">
                    {entry.current.definition.name}
                  </h2>
                  <p className="text-sm">
                    Current {entry.current.state} v{entry.version}
                    {entry.published
                      ? ` · Active publication v${entry.published.version}`
                      : " · No active publication"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.reviewer_name || "Recorded reviewer"} ·{" "}
                    {operationalTimeLabel(entry.current.recorded_at)}
                  </p>
                </div>
                {reviewer && (
                  <Button
                    className="min-h-11 h-auto max-w-full whitespace-normal break-words"
                    variant="outline"
                    onClick={() => setEditing(entry)}
                  >
                    Review {entry.current.definition.name}
                  </Button>
                )}
              </div>
              <p className="text-sm break-words">
                {entry.current.definition.sop_reference}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.current.definition.checklist.length} checklist items ·{" "}
                {entry.current.definition.eligible_roles.join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && (
        <TaskTemplateEditor
          key={`${editing?.id ?? "new"}:${editing?.version ?? 0}:${reloadNonce}`}
          entry={editing}
          close={() => setEditing(undefined)}
          reload={() => void reload()}
        />
      )}{" "}
      {settings && (
        <OperationalGenerationSettings close={() => setSettings(false)} />
      )}
    </main>
  );
}
export default function OperationalTaskTemplatesPage() {
  usePageTitle("Operational templates");
  const { session, hasRole } = useAuth();
  return session ? (
    <ActorTemplates
      key={session.user.id}
      actor={session.user.id}
      reviewer={hasRole("DVM") || hasRole("ADMIN")}
    />
  ) : null;
}
