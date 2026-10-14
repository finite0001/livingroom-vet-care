import { useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { catalogList } from "../scheduling/catalog-api";
import { readOperationalAppointment, operationalUsesPage } from "./task-api";
import {
  canonicalOperationalValue,
  type OperationalAppointment,
  type OperationalUse,
} from "./task-model";
import { useOperationalAction } from "./use-task-action";
import {
  OperationalDialog,
  OperationalActionStatus,
} from "./OperationalDialog";
import {
  operationalLocal,
  operationalInstant,
  operationalTimeLabel,
  operationalSelectClass,
} from "./task-ui";
import { refreshOperationalFacts } from "./task-invalidation";
interface ResourceUseWorkspaceProps {
  appointmentId: string;
  close: () => void;
}
interface UseEditorProps {
  source: OperationalAppointment;
  existing: OperationalUse | null;
  mode: "start" | "end" | "correct";
  close: () => void;
  reload: () => void;
}
function UseEditor({ source, existing, mode, close, reload }: UseEditorProps) {
  const { session, hasRole } = useAuth(),
    actor = session?.user.id ?? "",
    reviewer = hasRole("DVM") || hasRole("ADMIN"),
    cache = useQueryClient(),
    id = useRef(existing?.id ?? crypto.randomUUID());
  const [resource, setResource] = useState(
      existing?.current.facts.resource_version_id ?? "",
    ),
    [started, setStarted] = useState(
      existing
        ? operationalLocal(existing.current.facts.started_at)
        : operationalLocal(new Date()),
    ),
    [ended, setEnded] = useState(
      existing?.current.facts.ended_at
        ? operationalLocal(existing.current.facts.ended_at)
        : operationalLocal(new Date()),
    ),
    [stillOpen, setStillOpen] = useState(
      mode === "correct" && existing?.current.facts.state === "open",
    ),
    [reason, setReason] = useState(""),
    [overlap, setOverlap] = useState(false),
    [closedAttest, setClosedAttest] = useState(false),
    [resolution, setResolution] = useState<"reject" | "earlier" | "later">(
      "reject",
    ),
    [done, setDone] = useState(false);
  const initial = useRef(
    canonicalOperationalValue({
      resource,
      started,
      ended,
      stillOpen,
      reason,
      overlap,
      closedAttest,
      resolution,
    }),
  );
  const action = useOperationalAction(actor, "use", () => {
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
            resource,
            started,
            ended,
            stillOpen,
            reason,
            overlap,
            closedAttest,
            resolution,
          }));
  const resources = useQuery({
    queryKey: ["operational", actor, "resource-catalog"],
    queryFn: () => catalogList("resource"),
    refetchOnWindowFocus: !dirty,
  });
  const closed = ["CANCELLED", "NO_SHOW"].includes(source.status);
  async function save() {
    try {
      await action.save({
        id: id.current,
        expected_version: existing?.version ?? null,
        action: mode,
        appointment_id: source.id,
        appointment_version: source.version,
        resource_version_id: resource,
        started_at:
          mode === "end"
            ? existing!.current.facts.started_at
            : operationalInstant(started, resolution),
        ended_at:
          mode === "start" || stillOpen
            ? null
            : operationalInstant(ended, resolution),
        reason: reason.trim(),
        allow_overlap: overlap,
        attest_closed_source: mode === "start" && closed ? closedAttest : false,
      });
    } catch (cause) {
      action.setError(
        cause instanceof Error
          ? cause.message
          : "Review the actual resource and interval.",
      );
    }
  }
  return (
    <OperationalDialog
      title={
        mode === "start"
          ? "Record actual resource use"
          : mode === "end"
            ? "End actual resource use"
            : "Correct actual resource use"
      }
      description="Record what physically happened. Appointment status and elapsed booking time do not record room use or cleaning."
      dirty={dirty}
      busy={action.busy}
      pending={action.pending}
      close={close}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="rounded-xl border p-3">
          <p className="font-semibold break-words">
            {source.patient_name || "Retained visit"} ·{" "}
            {source.appointment_type}
          </p>
          <p className="text-sm">{operationalTimeLabel(source.scheduled_at)}</p>
          <StatusChip status={source.status} />
        </section>
        <fieldset className="space-y-4" disabled={frozen}>
          <div>
            <Label htmlFor="actual-use-resource">Actually used resource</Label>
            <select
              id="actual-use-resource"
              className={operationalSelectClass}
              required
              disabled={mode !== "start"}
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">Choose the actual resource</option>
              {existing &&
                !resources.data?.some(
                  (item) => item.published?.id === resource,
                ) && (
                  <option value={resource}>
                    {existing.resource_name || "Resource from saved use"} ·
                    retained reviewed version
                  </option>
                )}
              {resources.data
                ?.filter(
                  (item) =>
                    item.published &&
                    item.published.definition.visit_types.includes(
                      source.visit_type,
                    ),
                )
                .map((item) => (
                  <option key={item.id} value={item.published!.id}>
                    {item.published!.definition.name}
                  </option>
                ))}
            </select>
            {resources.isPending && (
              <p role="status">Loading reviewed resources…</p>
            )}
            {resources.isError && (
              <p role="alert">
                Resources unavailable.{" "}
                <Button
                  type="button"
                  className="min-h-11"
                  variant="outline"
                  onClick={() => void resources.refetch()}
                >
                  Retry resources
                </Button>
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="actual-use-started">
              Actual use started (Denver)
            </Label>
            <Input
              id="actual-use-started"
              className="min-h-11"
              type="datetime-local"
              step="1"
              required
              value={started}
              disabled={mode === "end"}
              onChange={(e) => setStarted(e.target.value)}
            />
            {mode === "start" && (
              <Button
                type="button"
                className="mt-2 min-h-11"
                variant="outline"
                onClick={() => setStarted(operationalLocal(new Date()))}
              >
                Use current start time
              </Button>
            )}
          </div>
          {mode === "correct" && (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5 accent-primary"
                checked={stillOpen}
                onChange={(e) => setStillOpen(e.target.checked)}
              />
              This resource use is still open
            </label>
          )}
          {mode !== "start" && !stillOpen && (
            <div>
              <Label htmlFor="actual-use-ended">
                Actual use ended (Denver)
              </Label>
              <Input
                id="actual-use-ended"
                className="min-h-11"
                type="datetime-local"
                step="1"
                required
                value={ended}
                onChange={(e) => setEnded(e.target.value)}
              />
              <Button
                type="button"
                className="mt-2 min-h-11"
                variant="outline"
                onClick={() => setEnded(operationalLocal(new Date()))}
              >
                Use current end time
              </Button>
            </div>
          )}
          <div>
            <Label htmlFor="actual-use-dst">Repeated-hour interpretation</Label>
            <select
              id="actual-use-dst"
              className={operationalSelectClass}
              value={resolution}
              onChange={(e) =>
                setResolution(e.target.value as typeof resolution)
              }
            >
              <option value="reject">Require an unambiguous time</option>
              <option value="earlier">Earlier occurrence</option>
              <option value="later">Later occurrence</option>
            </select>
          </div>
          {mode === "start" && closed && (
            <label className="flex min-h-11 items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-primary"
                checked={closedAttest}
                disabled={!reviewer}
                onChange={(e) => setClosedAttest(e.target.checked)}
              />
              <span className="text-sm">
                As the reviewer, I attest that this cancelled/no-show visit had
                actual resource use. The visit remains closed.
              </span>
            </label>
          )}
          {reviewer && (
            <label className="flex min-h-11 items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-primary"
                checked={overlap}
                onChange={(e) => setOverlap(e.target.checked)}
              />
              <span className="text-sm">
                I reviewed any overlap with other actual use and explained it in
                the note.
              </span>
            </label>
          )}
          <div>
            <Label htmlFor="actual-use-reason">
              Actual-use note
              {mode === "correct" ? " and correction reason" : ""}
            </Label>
            <Textarea
              id="actual-use-reason"
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            className="min-h-11"
            disabled={
              (mode === "correct" && !reviewer) ||
              (mode === "start" &&
                (resources.isPending ||
                  resources.isError ||
                  (closed && !closedAttest)))
            }
          >
            {mode === "start"
              ? "Save actual use"
              : mode === "end"
                ? "Record actual use ended"
                : "Save reviewed use correction"}
          </Button>
        </fieldset>
        <OperationalActionStatus action={action} />
        {!frozen && (
          <Button
            type="button"
            className="min-h-11"
            variant="outline"
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Discard this draft and reload the current visit/use?",
                )
              )
                reload();
            }}
          >
            Reload current use context
          </Button>
        )}
      </form>
    </OperationalDialog>
  );
}
function ActorUses({
  actor,
  appointmentId,
  close,
}: ResourceUseWorkspaceProps & { actor: string }) {
  const { hasRole } = useAuth(),
    reviewer = hasRole("DVM") || hasRole("ADMIN");
  const [editing, setEditing] = useState<{
      use: OperationalUse | null;
      mode: UseEditorProps["mode"];
    } | null>(null),
    [nonce, setNonce] = useState(0),
    [error, setError] = useState("");
  const source = useQuery({
    queryKey: ["operational", actor, "appointment", appointmentId],
    queryFn: () => readOperationalAppointment(appointmentId),
    refetchOnWindowFocus: !editing,
  });
  const uses = useInfiniteQuery({
    queryKey: ["operational", actor, "uses", appointmentId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => operationalUsesPage(appointmentId, pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchOnWindowFocus: !editing,
  });
  async function reload() {
    const [a, b] = await Promise.all([source.refetch(), uses.refetch()]);
    if (a.error || b.error) {
      setError("Current source facts are unavailable.");
      return;
    }
    if (editing?.use) {
      const current = b.data?.pages
        .flatMap((page) => page.items)
        .find((item) => item.id === editing.use!.id);
      if (!current) {
        setError(
          "Use record unavailable in the loaded pages; reload the list before editing.",
        );
        return;
      }
      setEditing({ ...editing, use: current });
    }
    setNonce((value) => value + 1);
  }
  if (editing && source.data)
    return (
      <UseEditor
        key={`${actor}:${nonce}`}
        source={source.data}
        existing={editing.use}
        mode={editing.mode}
        close={() => setEditing(null)}
        reload={() => void reload()}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl [&>button]:min-h-11 [&>button]:min-w-11">
        <DialogHeader>
          <DialogTitle>Actual resource use</DialogTitle>
          <DialogDescription>
            Open and ended physical-use records remain separate from the
            appointment status. Ending use does not attest that cleaning is
            complete.
          </DialogDescription>
        </DialogHeader>
        {source.isPending ? (
          <p role="status">Loading current visit…</p>
        ) : source.isError || !source.data ? (
          <p role="alert">
            Visit unavailable.{" "}
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => void source.refetch()}
            >
              Retry visit
            </Button>
          </p>
        ) : (
          <section className="space-y-2">
            <p className="font-semibold">
              {source.data.patient_name || "Retained visit"} ·{" "}
              {source.data.appointment_type}
            </p>
            <StatusChip status={source.data.status} />
            {(!["CANCELLED", "NO_SHOW"].includes(source.data.status) ||
              reviewer) && (
              <Button
                className="min-h-11"
                onClick={() => setEditing({ use: null, mode: "start" })}
              >
                Record actual use
              </Button>
            )}
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        {uses.isPending ? (
          <p role="status">Loading recorded use…</p>
        ) : uses.isError ? (
          <p role="alert">
            Use records unavailable.{" "}
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => void uses.refetch()}
            >
              Retry use records
            </Button>
          </p>
        ) : (
          <ul className="space-y-3">
            {uses.data.pages
              .flatMap((page) => page.items)
              .map((use) => (
                <li key={use.id} className="space-y-2 rounded-xl border p-3">
                  <h3 className="font-semibold">
                    {use.resource_name || "Retained resource"} ·{" "}
                    {use.current.facts.state === "open"
                      ? "Use still open"
                      : "Actual use ended"}
                  </h3>
                  <p className="text-sm">
                    Started {operationalTimeLabel(use.current.facts.started_at)}
                    {use.current.facts.ended_at
                      ? ` · Ended ${operationalTimeLabel(use.current.facts.ended_at)}`
                      : ""}
                  </p>
                  <p className="text-sm break-words">
                    {use.current.facts.reason}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {use.actor_name || "Recorded staff member"} · v{use.version}{" "}
                    · {operationalTimeLabel(use.current.recorded_at)}
                  </p>
                  {use.current.facts.closed_source_attested && (
                    <p className="text-xs">
                      Actual use of a closed visit was explicitly reviewed.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {use.current.facts.state === "open" && (
                      <Button
                        className="min-h-11"
                        onClick={() => setEditing({ use, mode: "end" })}
                      >
                        End this actual use
                      </Button>
                    )}
                    {reviewer && (
                      <Button
                        className="min-h-11"
                        variant="outline"
                        onClick={() => setEditing({ use, mode: "correct" })}
                      >
                        Correct this actual use
                      </Button>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
        {uses.data?.pages.flatMap((page) => page.items).length === 0 && (
          <p className="text-sm">
            No actual use has been recorded. The visit status does not establish
            room use.
          </p>
        )}
        {uses.hasNextPage && (
          <Button
            className="min-h-11"
            variant="outline"
            disabled={uses.isFetchingNextPage}
            onClick={() => void uses.fetchNextPage()}
          >
            Load more use records
          </Button>
        )}
        <Button className="min-h-11" variant="outline" onClick={close}>
          Close resource-use records
        </Button>
      </DialogContent>
    </Dialog>
  );
}
export function ResourceUseWorkspace(props: ResourceUseWorkspaceProps) {
  const { session } = useAuth();
  return session ? (
    <ActorUses
      key={`${session.user.id}:${props.appointmentId}`}
      actor={session.user.id}
      {...props}
    />
  ) : null;
}
