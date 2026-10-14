import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { operationalReconciliationPolicy } from "./task-api";
import { canonicalOperationalValue } from "./task-model";
import { useOperationalAction } from "./use-task-action";
import {
  OperationalActionStatus,
  OperationalDialog,
} from "./OperationalDialog";
import {
  operationalInstant,
  operationalLocal,
  operationalSelectClass,
  operationalTimeLabel,
} from "./task-ui";
import { refreshOperationalFacts } from "./task-invalidation";

interface SettingsProps {
  close: () => void;
}
interface FormProps extends SettingsProps {
  policy: Awaited<ReturnType<typeof operationalReconciliationPolicy>>;
  reload: () => void;
}
function ReconciliationForm({ policy, close, reload }: FormProps) {
  const { session, hasRole } = useAuth(),
    actor = session?.user.id ?? "",
    cache = useQueryClient();
  const reviewer = hasRole("DVM") || hasRole("ADMIN");
  const initialFrom = policy?.window_from
    ? operationalLocal(policy.window_from)
    : "";
  const initialUntil = policy?.window_until
    ? operationalLocal(policy.window_until)
    : "";
  const [enabled, setEnabled] = useState(policy?.enabled ?? false),
    [from, setFrom] = useState(initialFrom),
    [until, setUntil] = useState(initialUntil),
    [resolution, setResolution] = useState<"reject" | "earlier" | "later">(
      "reject",
    ),
    [note, setNote] = useState(""),
    [attest, setAttest] = useState(false),
    [done, setDone] = useState(false);
  const baseline = useRef(
    canonicalOperationalValue({
      enabled,
      from,
      until,
      resolution,
      note,
      attest,
    }),
  );
  const action = useOperationalAction(actor, "reconciliation_policy", () => {
    setDone(true);
    refreshOperationalFacts(cache, actor);
    close();
  });
  const frozen = action.busy || action.pending;
  const dirty = !done &&
    (frozen ||
      baseline.current !==
        canonicalOperationalValue({
          enabled,
          from,
          until,
          resolution,
          note,
          attest,
        }));
  async function save() {
    try {
      await action.save({
        expected_version: policy?.version ?? null,
        enabled,
        // Preserve the original microseconds and known DST occurrence if the
        // reviewer keeps an existing instant unchanged.
        window_from: enabled
          ? (from === initialFrom && resolution === "reject" &&
              policy?.window_from
            ? policy.window_from
            : operationalInstant(from, resolution))
          : null,
        window_until: enabled
          ? (until === initialUntil && resolution === "reject" &&
              policy?.window_until
            ? policy.window_until
            : operationalInstant(until, resolution))
          : null,
        review_note: note.trim(),
        attest_review: attest as true,
      });
    } catch (cause) {
      action.setError(
        cause instanceof Error ? cause.message : "Review the window and note.",
      );
    }
  }
  return (
    <OperationalDialog
      title="Review task reconciliation"
      description="Review the appointment window used to check scheduled preparation and existing actual-use obligations."
      dirty={dirty}
      busy={action.busy}
      pending={action.pending}
      close={close}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-sm">
          Current: {policy?.enabled
            ? "Reconciliation policy enabled"
            : "Reconciliation policy off"}
          {policy
            ? ` · review v${policy.version} · ${
              operationalTimeLabel(policy.recorded_at)
            }`
            : " · no review recorded"}.
        </p>
        <fieldset className="space-y-4" disabled={frozen || !reviewer}>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setAttest(false);
              }}
            />
            Reconcile operational tasks
          </label>
          {enabled && (
            <>
              <div>
                <Label htmlFor="reconciliation-from">
                  Appointment window from (Denver)
                </Label>
                <Input
                  id="reconciliation-from"
                  className="min-h-11"
                  type="datetime-local"
                  step="1"
                  required
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setAttest(false);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="reconciliation-until">
                  Appointment window until (Denver, at most 31 days)
                </Label>
                <Input
                  id="reconciliation-until"
                  className="min-h-11"
                  type="datetime-local"
                  step="1"
                  required
                  value={until}
                  onChange={(event) => {
                    setUntil(event.target.value);
                    setAttest(false);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="reconciliation-dst">
                  Repeated-hour interpretation
                </Label>
                <select
                  id="reconciliation-dst"
                  className={operationalSelectClass}
                  value={resolution}
                  onChange={(event) => {
                    setResolution(event.target.value as typeof resolution);
                    setAttest(false);
                  }}
                >
                  <option value="reject">Require an unambiguous time</option>
                  <option value="earlier">Earlier occurrence</option>
                  <option value="later">Later occurrence</option>
                </select>
              </div>
            </>
          )}
          <p className="text-sm text-muted-foreground">
            Actual-use checks include older appointments. Completed checklist
            evidence is preserved. This policy does not enable new-task
            generation, the worker or its timetable. Pausing stops new scheduled
            attempts; an interrupted run retains its recovery reference.
          </p>
          <div>
            <Label htmlFor="reconciliation-note">
              Reconciliation review note
            </Label>
            <Textarea
              id="reconciliation-note"
              required
              maxLength={2000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setAttest(false);
              }}
            />
          </div>
          <label className="flex min-h-11 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-primary"
              checked={attest}
              onChange={(event) => setAttest(event.target.checked)}
            />
            <span className="text-sm">
              I reviewed the appointment window, published checklists, resource
              mappings and eligible assignments.
            </span>
          </label>
          <Button className="min-h-11" disabled={!attest}>
            Save reconciliation review
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
                  "Discard this review and reload reconciliation settings?",
                )
              ) reload();
            }}
          >
            Reload reconciliation settings
          </Button>
        )}
      </form>
    </OperationalDialog>
  );
}
export function OperationalReconciliationSettings({ close }: SettingsProps) {
  const { session } = useAuth(), actor = session?.user.id ?? "";
  const [nonce, setNonce] = useState(0);
  const query = useQuery({
    queryKey: ["operational", actor, "reconciliation-policy"],
    queryFn: operationalReconciliationPolicy,
    enabled: !!actor,
    refetchOnWindowFocus: false,
  });
  return query.isPending || query.isError
    ? (
      <OperationalDialog
        title="Task reconciliation"
        description="Load the current saved policy before reviewing it."
        dirty={false}
        busy={false}
        pending={false}
        close={close}
      >
        {query.isError
          ? (
            <p role="alert">
              Reconciliation settings unavailable.{" "}
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                Retry reconciliation settings
              </Button>
            </p>
          )
          : <p role="status">Loading reconciliation settings…</p>}
      </OperationalDialog>
    )
    : (
      <ReconciliationForm
        key={`${actor}:${nonce}`}
        policy={query.data}
        close={close}
        reload={() => {
          void query.refetch().then((result) => {
            if (!result.error) setNonce((value) => value + 1);
          });
        }}
      />
    );
}
