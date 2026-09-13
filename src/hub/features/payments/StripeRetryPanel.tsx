import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  matchingStripeRetry,
  retryReasons,
  type StripeRetryCycle,
  stripeRetryCycle,
  type StripeRetryIntent,
  stripeRetryIntent,
  type StripeRetryPreview,
  stripeRetryPreview,
  type StripeRetryRow,
  stripeRetryRows,
} from "./StripeRetryState";
interface RetryDatabase {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as RetryDatabase;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export function StripeRetryPanel() {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active && hasRole("ADMIN")
    ? <RetrySession key={session.user.id} actor={session.user.id} />
    : null;
}
function RetrySession({ actor }: { actor: string }) {
  const [rows, setRows] = useState<StripeRetryRow[]>([]),
    [selected, setSelected] = useState(""),
    [review, setReview] = useState<StripeRetryPreview | null>(null),
    [reason, setReason] = useState<keyof typeof retryReasons>(
      "provider_recovered",
    ),
    [attest, setAttest] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<StripeRetryIntent | null>(null),
    [receipt, setReceipt] = useState<StripeRetryCycle | null>(null);
  const active = useRef(true),
    lock = useRef(false),
    key = `invoice-payment-intent:${actor}:stripe-event-retry`;
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (active.current) {
        setError(
          "Processing review unavailable or response unconfirmed. Recover the saved retry before starting another.",
        );
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const load = async () => {
    const data = stripeRetryRows(
      await rpc("read_stripe_event_queue", { p_limit: 100 }),
    );
    if (active.current) setRows(data);
  };
  const accept = (cycle: StripeRetryCycle, intent: StripeRetryIntent) => {
    if (!matchingStripeRetry(cycle, intent, actor)) {
      throw new Error("Retry receipt differs");
    }
    if (active.current) {
      setReceipt(cycle);
      setPending(null);
      setAttest(false);
      sessionStorage.removeItem(key);
    }
  };
  const recover = async (intent: StripeRetryIntent) => {
    const current = stripeRetryPreview(
      await rpc("preview_stripe_event_retry", {
        p_receipt_id: intent.p_receipt_id,
      }),
      intent.p_receipt_id,
    );
    const cycle = current.cycles.find((c) => c.id === intent.p_resolution_id);
    if (cycle) accept(cycle, intent);
    if (active.current) {
      setSelected(intent.p_receipt_id);
      setReview(current);
      setAttest(false);
    }
    return current;
  };
  useEffect(() => {
    active.current = true;
    void run(async () => {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const intent = stripeRetryIntent(JSON.parse(stored));
        setPending(intent);
        await recover(intent);
      }
      await load();
    });
    return () => {
      active.current = false;
    }; /* Actor-keyed session, existing auth cleanup clears the pending prefix. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = () =>
    void run(async () => {
      const current = stripeRetryPreview(
        await rpc("preview_stripe_event_retry", { p_receipt_id: selected }),
        selected,
      );
      if (active.current) {
        setReview(current);
        setReceipt(null);
        setAttest(false);
      }
    });
  const submit = () =>
    void run(async () => {
      if (!pending && (!review?.eligible || !attest)) {
        throw new Error("Explicit eligible review required");
      }
      const intent = pending ??
        stripeRetryIntent({
          p_resolution_id: crypto.randomUUID(),
          p_receipt_id: review!.receiptId,
          p_expected_work_hash: review!.hash,
          p_reason: reason,
          p_attest: true,
        });
      if (!pending) {
        sessionStorage.setItem(key, JSON.stringify(intent));
        setPending(intent);
      }
      setAttest(false);
      try {
        const cycle = stripeRetryCycle(
          await rpc("requeue_stripe_event", { ...intent }),
        );
        accept(cycle, intent);
      } catch {
        await recover(intent);
      }
      await load();
    });
  return (
    <section
      aria-label="Payment processing recovery"
      className="space-y-3 rounded-md border bg-card p-4"
    >
      <h2 className="text-lg font-semibold">Payment processing recovery</h2>
      <p className="text-sm text-muted-foreground">
        Review exhausted payment notifications after the underlying processing
        problem is fixed. A retry permits up to five more worker attempts. It
        does not confirm payment or resolve conflicting financial evidence.
      </p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {receipt && (
        <p role="status">
          Retry cycle {receipt.cycle_no} recorded. Previous{" "}
          {receipt.previous_attempt_count}{" "}
          attempts remain in history. Worker processing is still required.
        </p>
      )}
      {pending
        ? (
          <div className="space-y-2">
            <p role="status">
              Saved retry awaiting confirmation. Its original receipt, reason
              and reviewed state remain fixed.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await recover(pending);
                  await load();
                })}
            >
              Recover saved retry
            </Button>
            <Button variant="outline" disabled={busy} onClick={submit}>
              Retry same reviewed request
            </Button>
            {review && review.receiptId === pending.p_receipt_id &&
              !review.cycles.some((c) => c.id === pending.p_resolution_id) &&
              review.hash !== pending.p_expected_work_hash && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  sessionStorage.removeItem(key);
                  setPending(null);
                  setReview(null);
                  setAttest(false);
                }}
              >
                Discard stale unsaved review
              </Button>
            )}
          </div>
        )
        : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid flex-1 gap-1 text-sm">
              Payment notification<select
                aria-label="Payment notification"
                className="min-w-0 rounded-md border bg-background p-2"
                disabled={busy}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setReview(null);
                  setReceipt(null);
                  setAttest(false);
                }}
              >
                <option value="">Select a notification</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.event_type} · {row.work_state} · {row.attempt_count}
                    {" "}
                    attempts · {row.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={busy || !selected} onClick={open}>
              Review processing history
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(load)}
            >
              Refresh notifications
            </Button>
          </div>
        )}
      {rows.length === 100 && (
        <p className="text-sm text-muted-foreground">
          Showing the newest 100 notifications. A saved older retry can still be
          recovered.
        </p>
      )}
      {review && (
        <div className="space-y-3">
          <p>
            State: {review.workState}. Total attempts:{" "}
            {review.attemptCount}. Cycle {review.cycleNo}:{" "}
            {review.cycleAttemptCount} of 5 attempts.
          </p>
          <ul aria-label="Processing attempts" className="space-y-1 text-sm">
            {review.history.map((h, i) => (
              <li key={i}>
                Attempt {h.attemptCount} · cycle {h.cycleNo} ·{" "}
                {h.action.split("_").join(" ")} ·{" "}
                {h.reason.split("_").join(" ")}
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-sm">
            {review.cycles.map((c) => (
              <li key={c.id}>
                Cycle {c.cycle_no}: {retryReasons[c.reason]} ·{" "}
                {new Date(c.created_at).toLocaleString("en-US", {
                  timeZone: "America/Denver",
                })} Mountain
              </li>
            ))}
          </ul>
          {!review.eligible
            ? (
              <p role="status">
                This notification cannot be retried through this workflow.
                Active work, unknown provider objects and conflicting financial
                evidence require their own review.
              </p>
            )
            : !pending && (
              <>
                <label className="grid gap-1 text-sm">
                  Resolved processing problem<select
                    aria-label="Resolved processing problem"
                    value={reason}
                    disabled={busy}
                    className="rounded-md border bg-background p-2"
                    onChange={(e) => {
                      setReason(e.target.value as keyof typeof retryReasons);
                      setAttest(false);
                    }}
                  >
                    {Object.entries(retryReasons).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attest}
                    disabled={busy}
                    onChange={(e) => setAttest(e.target.checked)}
                  />I reviewed the processing history and confirm the selected
                  problem has been addressed.
                </label>
                <Button disabled={busy || !attest} onClick={submit}>
                  Queue reviewed processing retry
                </Button>
              </>
            )}
        </div>
      )}
    </section>
  );
}
