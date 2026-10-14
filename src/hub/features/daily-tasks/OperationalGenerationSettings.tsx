import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { operationalGenerationPolicy, operationalTemplates } from "./task-api";
import { canonicalOperationalValue } from "./task-model";
import { useOperationalAction } from "./use-task-action";
import {
  OperationalDialog,
  OperationalActionStatus,
} from "./OperationalDialog";
import {
  operationalInstant,
  operationalLocal,
  operationalSelectClass,
  operationalTimeLabel,
} from "./task-ui";
import { refreshOperationalFacts } from "./task-invalidation";
interface GenerationProps {
  close: () => void;
}
type Policy = Awaited<ReturnType<typeof operationalGenerationPolicy>>;
function GenerationForm({
  policy,
  close,
  reload,
}: {
  policy: Policy;
  close: () => void;
  reload: () => void;
}) {
  const { session, hasRole } = useAuth(),
    reviewer = hasRole("DVM") || hasRole("ADMIN"),
    actor = session?.user.id ?? "",
    cache = useQueryClient();
  const [enabled, setEnabled] = useState(policy?.enabled ?? false),
    [from, setFrom] = useState(
      policy?.effective_from ? operationalLocal(policy.effective_from) : "",
    ),
    [until, setUntil] = useState(
      policy?.effective_until ? operationalLocal(policy.effective_until) : "",
    ),
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
  const action = useOperationalAction(actor, "policy", () => {
    setDone(true);
    refreshOperationalFacts(cache, actor);
    close();
  });
  const frozen = action.busy || action.pending,
    dirty =
      !done &&
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
  const templates = useQuery({
    queryKey: ["operational", actor, "templates"],
    queryFn: operationalTemplates,
    refetchOnWindowFocus: !dirty,
  });
  async function save() {
    try {
      await action.save({
        expected_version: policy?.version ?? null,
        enabled,
        effective_from: enabled ? operationalInstant(from, resolution) : null,
        effective_until: enabled ? operationalInstant(until, resolution) : null,
        review_note: note.trim(),
        attest_review: attest as true,
      });
    } catch (cause) {
      action.setError(
        cause instanceof Error
          ? cause.message
          : "Review the generation interval and note.",
      );
    }
  }
  return (
    <OperationalDialog
      title="Review task generation"
      description="Publishing a checklist does not activate generation. Review the practice configuration and choose an explicit effective interval."
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
        <p className="text-sm">
          Current:{" "}
          {policy?.enabled
            ? "New task generation enabled"
            : "New task generation off"}
          {policy
            ? ` · review v${policy.version} · ${operationalTimeLabel(policy.recorded_at)}`
            : " · no activation recorded"}
          .
        </p>
        <fieldset className="space-y-4" disabled={frozen || !reviewer}>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setAttest(false);
              }}
            />
            Generate new operational tasks
          </label>
          {enabled && (
            <>
              <div>
                <Label htmlFor="task-generation-from">
                  Effective from (Denver)
                </Label>
                <Input
                  className="min-h-11"
                  id="task-generation-from"
                  type="datetime-local"
                  step="1"
                  required
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setAttest(false);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="task-generation-until">
                  Effective until (Denver, at most 366 days)
                </Label>
                <Input
                  className="min-h-11"
                  id="task-generation-until"
                  type="datetime-local"
                  step="1"
                  required
                  value={until}
                  onChange={(e) => {
                    setUntil(e.target.value);
                    setAttest(false);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="task-generation-dst">
                  Repeated-hour interpretation
                </Label>
                <select
                  className={operationalSelectClass}
                  id="task-generation-dst"
                  value={resolution}
                  onChange={(e) => {
                    setResolution(e.target.value as typeof resolution);
                    setAttest(false);
                  }}
                >
                  <option value="reject">Require an unambiguous time</option>
                  <option value="earlier">Earlier occurrence</option>
                  <option value="later">Later occurrence</option>
                </select>
              </div>
              {templates.isPending ? (
                <p role="status">Loading published checklists…</p>
              ) : templates.isError ? (
                <p role="alert">
                  Published checklists unavailable.{" "}
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void templates.refetch()}
                  >
                    Retry checklists
                  </Button>
                </p>
              ) : (
                <p className="text-sm">
                  {templates.data.filter((item) => item.published).length}{" "}
                  currently published checklists.
                </p>
              )}
            </>
          )}
          <p className="text-sm text-muted-foreground">
            Pausing stops new enrollment. Existing work still follows source
            changes, cancellations and actual-use corrections. Restock
            completion never adjusts inventory.
          </p>
          <div>
            <Label htmlFor="task-generation-note">Generation review note</Label>
            <Textarea
              id="task-generation-note"
              required
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <label className="flex min-h-11 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-primary"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
            />
            <span className="text-sm">
              I reviewed the published checklists, resource/type mapping,
              eligible assignments and effective interval.
            </span>
          </label>
          <Button
            className="min-h-11"
            disabled={
              !attest ||
              (enabled &&
                (templates.isPending ||
                  templates.isError ||
                  !templates.data?.some((item) => item.published)))
            }
          >
            Save generation review
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
                  "Discard this review and reload generation settings?",
                )
              )
                reload();
            }}
          >
            Reload generation settings
          </Button>
        )}
      </form>
    </OperationalDialog>
  );
}
export function OperationalGenerationSettings({ close }: GenerationProps) {
  const { session } = useAuth(),
    actor = session?.user.id ?? "";
  const [nonce, setNonce] = useState(0);
  const policy = useQuery({
    queryKey: ["operational", actor, "policy"],
    enabled: !!actor,
    queryFn: operationalGenerationPolicy,
    refetchOnWindowFocus: false,
  });
  return policy.isPending || policy.isError ? (
    <OperationalDialog
      title="Task generation"
      description="Load the current review before changing task generation."
      dirty={false}
      busy={false}
      pending={false}
      close={close}
    >
      {policy.isError ? (
        <p role="alert">
          Generation settings unavailable.{" "}
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => void policy.refetch()}
          >
            Retry generation settings
          </Button>
        </p>
      ) : (
        <p role="status">Loading generation settings…</p>
      )}
    </OperationalDialog>
  ) : (
    <GenerationForm
      key={`${actor}:${nonce}`}
      policy={policy.data}
      close={close}
      reload={() => {
        void policy.refetch().then((result) => {
          if (!result.error) setNonce((value) => value + 1);
        });
      }}
    />
  );
}
