import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router-dom";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  failureLabel,
  intentSchema,
  reasonLabels,
  type Preview,
  type Queue,
  type RetryIntent,
  type RetryPage,
  type RetryReceipt,
} from "./ProcessingState";
import {
  readProcessingQueue,
  previewRetry,
  recoverRetry,
  requeue,
  retryHistory,
  type Cursor,
} from "./ProcessingApi";
const date = (v: string) =>
  new Date(v).toLocaleString("en-US", { timeZone: "America/Denver" });
const selectClass =
  "w-full rounded-md border border-input bg-background p-2 text-sm";
export default function ProcessingQueuePage() {
  const { session, profile, hasRole } = useAuth(),
    admin = hasRole("ADMIN");
  return session && profile?.is_active ? (
    <ProcessingQueue
      key={`${session.user.id}:${admin}`}
      actor={session.user.id}
      admin={admin}
    />
  ) : null;
}
function ProcessingQueue({ actor, admin }: { actor: string; admin: boolean }) {
  const [data, setData] = useState<Queue | null>(null),
    [filter, setFilter] = useState(""),
    [cursor, setCursor] = useState<Cursor | null>(null),
    [history, setHistory] = useState<RetryPage | null>(null),
    [historyCursor, setHistoryCursor] = useState<Cursor | null>(null),
    [review, setReview] = useState<Preview | null>(null),
    [receipt, setReceipt] = useState<RetryReceipt | null>(null),
    [pending, setPending] = useState<RetryIntent | null>(null),
    [reason, setReason] = useState<keyof typeof reasonLabels | "">(""),
    [checked, setChecked] = useState(false),
    [absent, setAbsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    lock = useRef(false),
    initialized = useRef(false),
    pendingRef = useRef<RetryIntent | null>(null),
    key = `communication-processing-intent:${actor}:pending`;
  const dirty =
      busy || Boolean(pending) || Boolean(review) || checked || Boolean(reason),
    blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch {
      if (alive.current)
        setError(
          "Processing review is unavailable or unconfirmed. Keep the original retry request and recover its receipt before trying again. Changed work must be reviewed again.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const load = async (state = filter, next = cursor, hc = historyCursor) => {
    const [q, h] = await Promise.all([
      readProcessingQueue(state || null, next),
      admin ? retryHistory(actor, hc) : Promise.resolve(null),
    ]);
    if (alive.current) {
      setData(q);
      setHistory(h);
    }
  };
  const clearPending = () => {
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
    setAbsent(false);
  };
  const accept = (r: RetryReceipt) => {
    setReceipt(r);
    setReview(null);
    setReason("");
    setChecked(false);
    clearPending();
    setNotice(
      "The reviewed retry cycle is recorded. Processing and delivery are not yet confirmed.",
    );
  };
  const recover = async () => {
    const p = pendingRef.current;
    setChecked(false);
    if (p) {
      const r = await recoverRetry(actor, p.p_id, p);
      if (!alive.current) return;
      if (r) accept(r);
      else {
        setAbsent(true);
        setNotice(
          "No retry receipt was found. The original request is retained for unchanged retry or explicit discard.",
        );
      }
    }
    await load();
  };
  useEffect(() => {
    alive.current = true;
    const auth = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.user.id !== actor) {
        alive.current = false;
        sessionStorage.removeItem(key);
      }
    });
    if (!initialized.current) {
      initialized.current = true;
      void run(async () => {
        if (admin) {
          const raw = sessionStorage.getItem(key);
          if (raw) {
            const p = intentSchema.parse(JSON.parse(raw)) as RetryIntent;
            pendingRef.current = p;
            setPending(p);
            await recover();
            return;
          }
        }
        await load();
      });
    }
    return () => {
      alive.current = false;
      auth.data.subscription.unsubscribe();
    };
    // Identity and role changes remount the operator panel; no ADMIN call runs for staff-only readers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = () =>
    void run(async () => {
      if (
        !admin ||
        !review?.eligible ||
        !reason ||
        !checked ||
        pendingRef.current
      )
        throw new Error("Reviewed repair required");
      const p = intentSchema.parse({
        p_id: crypto.randomUUID(),
        p_event_id: review.event.id,
        p_expected_work_hash: review.expected_work_hash,
        p_reason: reason,
        p_attest: true,
      }) as RetryIntent;
      sessionStorage.setItem(key, JSON.stringify(p));
      pendingRef.current = p;
      setPending(p);
      setChecked(false);
      try {
        const r = await requeue(actor, p);
        if (alive.current) accept(r);
      } catch {
        await recover();
      }
      await load();
    });
  const retry = () =>
    void run(async () => {
      await recover();
      const p = pendingRef.current;
      if (!p || !alive.current) return;
      try {
        const r = await requeue(actor, p);
        if (alive.current) accept(r);
      } catch {
        await recover();
      }
      await load();
    });
  const close = () => {
    setReview(null);
    setReason("");
    setChecked(false);
    setReceipt(null);
  };
  return (
    <main className="space-y-5 overflow-y-auto p-4 md:p-6">
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave processing review?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsubmitted review choices will be lost. A submitted retry remains
              recoverable from its original action receipt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              Keep reviewing processing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              Leave and recover later
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Link to="/hub/chats" className="text-primary underline">
        Back to inbox
      </Link>
      <h1 className="text-xl font-semibold">Communication processing</h1>
      <p className="text-sm text-muted-foreground">
        Provider callbacks awaiting processing, requiring review, or already
        processed. This queue does not send messages or prove recipient
        delivery. Household assignment is reviewed separately after incoming
        content is available.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void run(recover)}
      >
        Refresh processing and recover retry
      </Button>
      {pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Original administrator retry request retained. Its exact event, work
            snapshot and repair reason cannot be changed.
          </p>
          <Button disabled={busy} onClick={retry}>
            Retry original processing request
          </Button>
          {absent && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const p = pendingRef.current;
                  if (!p) return;
                  const r = await recoverRetry(actor, p.p_id, p);
                  if (!alive.current) return;
                  if (r) {
                    accept(r);
                    await load();
                    return;
                  }
                  clearPending();
                  setReview(null);
                  setReason("");
                  setNotice(
                    "Uncreated retry request discarded. Select current work for a fresh review.",
                  );
                })
              }
            >
              Discard uncreated processing request
            </Button>
          )}
        </div>
      )}
      {receipt && (
        <section
          aria-label="Processing retry receipt"
          className="space-y-2 rounded-md border p-3"
        >
          <h2 className="font-medium">Administrator retry recorded</h2>
          <p>
            Cycle {receipt.previous_cycle_no} → {receipt.cycle_no} ·{" "}
            {receipt.lifetime_attempts} lifetime attempts retained
          </p>
          <p>
            {reasonLabels[receipt.reason]} · {date(receipt.created_at)} Denver
          </p>
          <p>
            Original provider facts, consent restrictions and delivery evidence
            remain unchanged. A worker must still fetch and validate the
            content.
          </p>
        </section>
      )}
      <Label htmlFor="processing-state">Processing state</Label>
      <select
        id="processing-state"
        className={selectClass}
        disabled={dirty}
        value={filter}
        onChange={(e) => {
          const v = e.target.value;
          void run(async () => {
            await load(v, null);
            if (alive.current) {
              setFilter(v);
              setCursor(null);
            }
          });
        }}
      >
        <option value="">Unfinished work</option>
        <option value="pending">Pending</option>
        <option value="claimed">Being processed</option>
        <option value="review">Requires review</option>
        <option value="processed">Processed callbacks</option>
      </select>
      {!data && !error && <p role="status">Loading processing queue…</p>}
      {data && !data.events.length && !error && (
        <p>No processing work on this page.</p>
      )}
      <ul className="space-y-3">
        {data?.events.map((e) => (
          <li key={e.id} className="space-y-2 rounded-md border p-3">
            <p className="font-medium">
              {e.provider === "resend" ? "Resend" : "Twilio"} · {e.event_type} ·{" "}
              {e.state}
            </p>
            <p>{failureLabel(e.last_error)}</p>
            <p className="text-sm">
              Cycle {e.cycle_no}: {e.cycle_attempts}/10 attempts · lifetime{" "}
              {e.attempts} · received {date(e.received_at)} Denver
            </p>
            <details>
              <summary>Provider event reference</summary>
              <p className="break-all text-xs">
                Event {e.event_id} · resource {e.resource_id}
              </p>
              <p className="text-xs">
                Revision {e.revision} · available {date(e.available_at)} Denver
              </p>
            </details>
            {admin && (
              <Button
                variant="outline"
                disabled={dirty}
                onClick={() =>
                  void run(async () => {
                    const p = await previewRetry(e.id);
                    if (!alive.current) return;
                    if (!p) throw new Error("Processing event unavailable");
                    setReview(p);
                    setReceipt(null);
                    setChecked(false);
                    setReason("");
                  })
                }
              >
                Review processing event {e.id.slice(0, 8)}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={dirty || !cursor}
          onClick={() =>
            void run(async () => {
              await load(filter, null);
              if (alive.current) setCursor(null);
            })
          }
        >
          Newest processing events
        </Button>
        <Button
          variant="outline"
          disabled={dirty || !data?.has_more}
          onClick={() =>
            void run(async () => {
              const last = data?.events.at(-1);
              if (!last) return;
              const next = { at: last.received_at, id: last.id };
              await load(filter, next);
              if (alive.current) setCursor(next);
            })
          }
        >
          Older processing events
        </Button>
      </div>
      {admin && review && (
        <section
          aria-label="Administrator processing review"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 className="font-semibold">Review exact processing work</h2>
          <p>
            {review.event.provider} · {review.event.event_type} ·{" "}
            {review.event.state} · revision {review.event.revision}
          </p>
          <p>{failureLabel(review.event.last_error)}</p>
          <p>
            Cycle {review.event.cycle_no}: {review.event.cycle_attempts}/10
            attempts · {review.event.attempts} lifetime attempts
          </p>
          {!review.eligible ? (
            <p role="alert">
              A retry is unavailable for this snapshot. Content, crashed-worker
              and unknown failures need separate review; opening this panel does
              not resolve them.
            </p>
          ) : (
            <fieldset disabled={busy || Boolean(pending)} className="space-y-3">
              <Label htmlFor="processing-repair">
                Repair completed before retry
              </Label>
              <select
                id="processing-repair"
                className={selectClass}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value as keyof typeof reasonLabels | "");
                  setChecked(false);
                }}
              >
                <option value="">Choose the completed repair</option>
                {Object.entries(reasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I reviewed this exact exhausted processing cycle and completed
                the selected repair. Request one new processing cycle; do not
                change consent or delivery status.
              </label>
              <Button disabled={!checked || !reason} onClick={submit}>
                Request reviewed processing retry
              </Button>
            </fieldset>
          )}
          <details open>
            <summary>Processing history</summary>
            {review.history_has_more && (
              <p className="text-sm">
                Latest 100 state observations shown. Earlier history is
                retained.
              </p>
            )}
            <ul className="space-y-1">
              {review.history.map((h) => (
                <li key={h.id} className="text-sm">
                  {date(h.created_at)} Denver · {h.action.replace(/_/g, " ")} ·{" "}
                  {h.state} · cycle {h.cycle_no} attempt {h.cycle_attempts} ·
                  lifetime {h.attempts} · {failureLabel(h.last_error)}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Recorded administrator retry cycles</summary>
            <p className="text-sm">
              Latest 100 retry cycles shown; earlier actions remain in history.
            </p>
            <ul>
              {review.retries.map((r) => (
                <li key={r.id}>
                  Cycle {r.previous_cycle_no} → {r.cycle_no} ·{" "}
                  {reasonLabels[r.reason]} · {date(r.created_at)} Denver
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      {admin && history && (
        <section className="space-y-3">
          <h2 className="font-semibold">Your recorded retry actions</h2>
          <Label htmlFor="processing-receipt">Recover a recorded retry</Label>
          <select
            id="processing-receipt"
            className={selectClass}
            disabled={dirty}
            value={receipt?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                setReceipt(null);
                return;
              }
              void run(async () => {
                const r = await recoverRetry(actor, id);
                if (!r) throw new Error("Retry unavailable");
                if (alive.current) setReceipt(r);
              });
            }}
          >
            <option value="">Choose a recorded retry</option>
            {history.retries.map((r) => (
              <option key={r.id} value={r.id}>
                {date(r.created_at)} · cycle {r.previous_cycle_no} →{" "}
                {r.cycle_no} · {reasonLabels[r.reason]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={dirty || !historyCursor}
              onClick={() =>
                void run(async () => {
                  await load(filter, cursor, null);
                  if (alive.current) setHistoryCursor(null);
                })
              }
            >
              Newest retry actions
            </Button>
            <Button
              variant="outline"
              disabled={dirty || !history.has_more}
              onClick={() =>
                void run(async () => {
                  const last = history.retries.at(-1);
                  if (!last) return;
                  const next = { at: last.created_at, id: last.id };
                  await load(filter, cursor, next);
                  if (alive.current) setHistoryCursor(next);
                })
              }
            >
              Older retry actions
            </Button>
          </div>
        </section>
      )}
      {!admin && (
        <p className="text-sm">
          An active administrator may review eligible exhausted processing work
          after a repair.
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy || Boolean(pending)}
        onClick={close}
      >
        Close processing review
      </Button>
    </main>
  );
}
