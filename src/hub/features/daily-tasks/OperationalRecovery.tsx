import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  readOperationalReview,
  executeOperationalReview,
  cancelOperationalReview,
  type OperationalReview,
} from "./task-api";
import {
  storedOperationalReviews,
  forgetOperationalReview,
  type OperationalMetadata,
} from "./task-model";
import { operationalChangeEvent } from "./use-task-action";
import { operationalActionError, operationalTimeLabel } from "./task-ui";
import { refreshOperationalFacts } from "./task-invalidation";
function RecoveryItem({ meta }: { meta: OperationalMetadata }) {
  const { refreshProfile } = useAuth();
  const [review, setReview] = useState<OperationalReview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false),
    cache = useQueryClient();
  async function authorize() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== meta.actor_id) throw { code: "42501" };
  }
  async function run(mode: "check" | "retry" | "release") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user.id !== meta.actor_id) throw { code: "42501" };
      const saved = await readOperationalReview(meta);
      await authorize();
      setReview(saved);
      if (mode === "retry") {
        if (!saved || saved.state !== "prepared") {
          setMessage(
            "Check the saved result before retrying. A missing, expired or cancelled review cannot create new work here.",
          );
          return;
        }
        await executeOperationalReview(meta);
        const latest = await readOperationalReview(meta);
        await authorize();
        setReview(latest);
        refreshOperationalFacts(cache, meta.actor_id);
      }
      if (mode === "release") {
        await cancelOperationalReview(meta);
        await authorize();
        forgetOperationalReview(localStorage, meta);
        window.dispatchEvent(new Event(operationalChangeEvent));
        refreshOperationalFacts(cache, meta.actor_id);
        return;
      }
      if (!saved && mode === "check")
        setMessage(
          "No server review is confirmed yet. Check and cancel this action before reviewing new work.",
        );
    } catch (cause) {
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "42501"
      ) {
        try {
          await refreshProfile();
        } catch {
          /* Recovery remains available. */
        }
      }
      setMessage(operationalActionError(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const label = {
    template: "Template review",
    use: "Resource-use record",
    task: "Task action",
    policy: "Generation review",
  }[meta.operation];
  const id =
    review?.request && "id" in review.request ? review.request.id : null;
  return (
    <li className="space-y-2 rounded-xl border p-3">
      <p className="font-medium">
        {label} ·{" "}
        {review?.state === "saved"
          ? "Saved"
          : review?.state === "expired"
            ? "Expired"
            : review?.state === "cancelled"
              ? "Cancelled"
              : "Unconfirmed"}
      </p>
      {review && (
        <p className="text-xs text-muted-foreground">
          Execution review expires {operationalTimeLabel(review.expires_at)}.
          Saved work remains in history.
        </p>
      )}
      {review?.state === "saved" && id && (
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={
            meta.operation === "task"
              ? `/hub/tasks?task=${id}`
              : meta.operation === "template"
                ? "/hub/tools/task-templates"
                : "/hub/schedule"
          }
        >
          Open current{" "}
          {meta.operation === "task"
            ? "task"
            : meta.operation === "template"
              ? "templates"
              : "schedule"}
        </Link>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 h-auto max-w-full whitespace-normal break-words"
          disabled={busy}
          variant="outline"
          onClick={() => void run("check")}
        >
          Check saved action
        </Button>
        {review?.state === "prepared" && (
          <Button
            className="min-h-11 h-auto max-w-full whitespace-normal break-words"
            disabled={busy}
            onClick={() => void run("retry")}
          >
            Retry this reviewed action
          </Button>
        )}
        <Button
          className="min-h-11 h-auto max-w-full whitespace-normal break-words"
          disabled={busy}
          variant="outline"
          onClick={() => {
            if (
              window.confirm(
                "Check and release this recovery action? Saved work will remain in history.",
              )
            )
              void run("release");
          }}
        >
          Check and release action
        </Button>
      </div>
    </li>
  );
}
function ActorRecovery({ actor }: { actor: string }) {
  const [items, setItems] = useState(() =>
    storedOperationalReviews(localStorage, actor),
  );
  useEffect(() => {
    function changed() {
      setItems(storedOperationalReviews(localStorage, actor));
    }
    window.addEventListener(operationalChangeEvent, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(operationalChangeEvent, changed);
      window.removeEventListener("storage", changed);
    };
  }, [actor]);
  return items.length ? (
    <section
      aria-label="Operational recovery"
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-card"
    >
      <h2 className="font-display text-xl">Operational recovery</h2>
      <p className="text-sm text-muted-foreground">
        Check your unconfirmed actions before starting replacements.
      </p>
      <ul className="space-y-2">
        {items.map((meta) => (
          <RecoveryItem key={meta.id} meta={meta} />
        ))}
      </ul>
    </section>
  ) : null;
}
export function OperationalRecovery() {
  const { session } = useAuth();
  return session ? (
    <ActorRecovery key={session.user.id} actor={session.user.id} />
  ) : null;
}
