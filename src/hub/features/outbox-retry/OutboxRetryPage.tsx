import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
  displayTime,
  conversationLink,
  householdLink,
} from "@/hub/features/operations/OperationsState";
import {
  intentSchema,
  storedIntentSchema,
  labels,
  reasons,
  type Preview,
  type RetryIntent,
  type RetryAction,
  type ActionPage,
} from "./OutboxRetryState";
import * as api from "./OutboxRetryApi";
export default function OutboxRetryPage() {
  const { session, profile, hasRole } = useAuth(),
    { id } = useParams();
  return session && profile?.is_active && hasRole("ADMIN") ? (
    <ReviewSession
      key={`${session.user.id}:${id ?? "history"}`}
      actor={session.user.id}
      target={id ?? null}
    />
  ) : (
    <p className="p-4">Administrator access required.</p>
  );
}
interface SessionProps {
  actor: string;
  target: string | null;
}
function ReviewSession({ actor, target }: SessionProps) {
  const [review, setReview] = useState<Preview | null>(null),
    [receipt, setReceipt] = useState<RetryAction | null>(null),
    [pending, setPending] = useState<RetryIntent | null>(null),
    [reason, setReason] = useState<keyof typeof reasons | "">(""),
    [attest, setAttest] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [absent, setAbsent] = useState(false),
    [history, setHistory] = useState<ActionPage | null>(null),
    [cursor, setCursor] = useState<api.Cursor | null>(null);
  const alive = useRef(true),
    lock = useRef(false),
    initialized = useRef(false),
    pendingRef = useRef<RetryIntent | null>(null),
    reviewedRevision = useRef<number | null>(null),
    key = `outbox-retry-intent:${actor}:pending`;
  const dirty = busy || !!review || !!pending || !!reason || attest,
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
          "Outgoing retry review is unavailable or unconfirmed. Keep the original request and recover its receipt before trying again.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const loadHistory = async (next = cursor) => {
    const h = await api.history(actor, next);
    if (alive.current) {
      setHistory(h);
      setCursor(next);
    }
  };
  const clearPending = () => {
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    reviewedRevision.current = null;
    setPending(null);
    setAbsent(false);
  };
  const accept = (r: RetryAction) => {
    setReceipt(r);
    setReview(null);
    setReason("");
    setAttest(false);
    clearPending();
    setNotice(
      "Retry recorded for the original outgoing work. Worker processing and delivery are not confirmed.",
    );
  };
  const recoverPending = async () => {
    const p = pendingRef.current;
    if (!p) return;
    const r = await api.recover(p.p_id, actor, p);
    if (!alive.current) return;
    if (r) accept(r);
    else {
      setAbsent(true);
      setNotice(
        "No action receipt found. The original request is retained because it could still complete.",
      );
    }
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
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const stored = storedIntentSchema.parse(JSON.parse(raw));
          const p = stored.intent as RetryIntent;
          reviewedRevision.current = stored.reviewed_revision;
          pendingRef.current = p;
          setPending(p);
          await recoverPending();
        } else if (target) {
          const p = await api.readPreview(target, actor);
          if (alive.current) {
            setReview(p);
            if (!p) setNotice("This outgoing work is unavailable.");
          }
        }
        if (alive.current) await loadHistory();
      });
    }
    return () => {
      alive.current = false;
      auth.data.subscription.unsubscribe();
    };
    // Actor and target changes remount; explicit handlers own subsequent reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = () =>
    void run(async () => {
      if (!review?.eligible || !reason || !attest || pendingRef.current)
        throw new Error("Review required");
      const p = intentSchema.parse({
        p_id: crypto.randomUUID(),
        p_outbox_id: review.outbox.id,
        p_expected_work_hash: review.expected_work_hash,
        p_reason: reason,
        p_attest: true,
      }) as RetryIntent;
      sessionStorage.setItem(
        key,
        JSON.stringify({
          intent: p,
          reviewed_revision: review.outbox.revision,
        }),
      );
      reviewedRevision.current = review.outbox.revision;
      pendingRef.current = p;
      setPending(p);
      setAttest(false);
      try {
        const r = await api.requeue(p, actor);
        if (alive.current) accept(r);
      } catch {
        if (alive.current) await recoverPending();
      }
      if (alive.current) await loadHistory();
    });
  const retry = () =>
    void run(async () => {
      await recoverPending();
      const p = pendingRef.current;
      if (!p || !alive.current) return;
      try {
        const r = await api.requeue(p, actor);
        if (alive.current) accept(r);
      } catch {
        if (alive.current) await recoverPending();
      }
      if (alive.current) await loadHistory();
    });
  const clearChanged = () =>
    void run(async () => {
      const p = pendingRef.current;
      if (!p) return;
      await recoverPending();
      if (!alive.current || !pendingRef.current) return;
      const current = await api.readPreview(p.p_outbox_id, actor);
      if (!alive.current) return;
      if (
        !current ||
        reviewedRevision.current === null ||
        current.outbox.revision <= reviewedRevision.current ||
        current.expected_work_hash === p.p_expected_work_hash
      ) {
        setNotice(
          "The original request could still complete. Keep its exact request until its outgoing revision advances or a receipt is recovered.",
        );
        return;
      }
      const r = await api.recover(p.p_id, actor, p);
      if (!alive.current) return;
      if (r) {
        accept(r);
        return;
      }
      clearPending();
      setReview(null);
      setReason("");
      setAttest(false);
      setNotice(
        "The work changed and no original action receipt was found. Local draft cleared; no server operation was canceled.",
      );
    });
  const close = () => {
    setReview(null);
    setReceipt(null);
    setReason("");
    setAttest(false);
  };
  return (
    <div className="space-y-5 p-4 md:p-6">
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave outgoing retry review?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsubmitted review choices will be lost. An uncertain submitted
              request retains its original recovery reference for this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              Keep reviewing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              Leave and recover later
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Outgoing retry review</h1>
        <p>
          Review failed work that has no prior provider execution evidence. This
          workflow returns eligible original work to pending; it does not send a
          message or reconcile an uncertain provider outcome.
        </p>
        <Link className="text-primary underline" to="/hub/admin/operations">
          Back to Operations
        </Link>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <section
          aria-label="Original outgoing retry"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 className="font-semibold">
            Original request awaiting confirmation
          </h2>
          <p className="break-all">Outgoing reference: {pending.p_outbox_id}</p>
          <p>
            {reasons[pending.p_reason]}. Target, work snapshot and reason remain
            fixed.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await recoverPending();
                if (alive.current) await loadHistory();
              })
            }
          >
            Recover original outgoing retry
          </Button>
          <Button variant="outline" disabled={busy} onClick={retry}>
            Retry exact outgoing request
          </Button>
          {absent && (
            <Button variant="outline" disabled={busy} onClick={clearChanged}>
              Check changed work before clearing draft
            </Button>
          )}
        </section>
      )}
      {receipt && (
        <section
          aria-label="Outgoing retry receipt"
          className="space-y-2 rounded-md border p-4"
        >
          <h2 className="font-semibold">Recorded retry action</h2>
          <p className="break-all">Action reference: {receipt.id}</p>
          <p className="break-all">Outgoing reference: {receipt.outbox_id}</p>
          <p>
            {reasons[receipt.reason]} · recorded{" "}
            {displayTime(receipt.created_at)}
          </p>
          <p>
            Work revision {receipt.previous_revision} →{" "}
            {receipt.queued_revision}. This records a return to pending, not
            successful transmission.
          </p>
        </section>
      )}
      {review && (
        <section
          aria-label="Outgoing work snapshot"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 className="font-semibold">Original outgoing work</h2>
          <p className="break-all">Outgoing reference: {review.outbox.id}</p>
          <p>
            {review.outbox.channel} via {review.outbox.provider} ·{" "}
            {review.outbox.state} · revision {review.outbox.revision} ·{" "}
            {review.outbox.attempt_count} attempts
          </p>
          <p>
            Created {displayTime(review.outbox.created_at)} · updated{" "}
            {displayTime(review.outbox.updated_at)}
          </p>
          <p>
            {review.outbox.reason?.split("_").join(" ") ??
              "No failure reason recorded"}
          </p>
          <p>
            Source: {review.source.family.split("_").join(" ")} ·{" "}
            {review.source.eligible
              ? "eligible for this review"
              : "currently ineligible"}
          </p>
          {review.source.source_id && (
            <p className="break-all text-sm">
              Source reference: {review.source.source_id}
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-primary underline">
            <Link to={conversationLink(review.outbox.conversation_id)}>
              Open original conversation
            </Link>
            {review.outbox.client_id && (
              <Link to={householdLink(review.outbox.client_id)}>
                Open original household
              </Link>
            )}
          </div>
          <p>{labels[review.reason]}</p>
          <p className="text-sm text-muted-foreground">
            Final source materialization, recipient consent, deployment and
            provider configuration are still checked by the worker. Eligible for
            requeue does not mean deliverable or delivered.
          </p>
          {!pending && review.eligible && (
            <>
              <label className="grid gap-1">
                Repair completed
                <select
                  aria-label="Repair completed"
                  disabled={busy}
                  className="rounded-md border bg-background p-2"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value as keyof typeof reasons | "");
                    setAttest(false);
                  }}
                >
                  <option value="">Choose the repair completed</option>
                  {Object.entries(reasons).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={attest}
                  disabled={busy || !reason}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                I reviewed this exact outgoing work and confirm the selected
                repair has been completed.
              </label>
              <Button disabled={busy || !reason || !attest} onClick={submit}>
                Request reviewed outgoing retry
              </Button>
            </>
          )}
          {review.history.length > 0 && (
            <p>
              {review.history.length} of your recorded actions are present for
              this outgoing work. Use the history picker below to recover an
              original receipt.
            </p>
          )}
          {review.history_has_more && (
            <p>Additional actions remain in paginated history.</p>
          )}
        </section>
      )}
      {!pending && (review || receipt) && (
        <Button variant="outline" disabled={busy} onClick={close}>
          Close outgoing review
        </Button>
      )}
      {!pending && !review && target && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const p = await api.readPreview(target, actor);
              if (alive.current) {
                setReview(p);
                setReceipt(null);
                if (!p) setNotice("This outgoing work is unavailable.");
              }
            })
          }
        >
          Review current outgoing work
        </Button>
      )}
      <section
        aria-label="Recorded outgoing retries"
        className="space-y-3 rounded-md border p-4"
      >
        <h2 className="font-semibold">Your recorded outgoing retries</h2>
        <p>
          Recover a durable receipt even after losing the browser's pending
          reference. History belongs to the signed-in administrator.
        </p>
        <label className="grid gap-1">
          Recorded action
          <select
            aria-label="Recorded action"
            className="rounded-md border bg-background p-2"
            disabled={busy || !!pending || !!review}
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id)
                void run(async () => {
                  const r = await api.recover(id, actor);
                  if (!alive.current) return;
                  if (r) accept(r);
                  else setNotice("The selected action receipt is unavailable.");
                });
            }}
          >
            <option value="">Choose an original action</option>
            {history?.items.map((r) => (
              <option value={r.id} key={r.id}>
                {displayTime(r.created_at)} · {reasons[r.reason]} ·{" "}
                {r.outbox_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {history && !history.items.length && (
          <p>No recorded actions on this page.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !!pending || !!review}
            onClick={() => void run(() => loadHistory(null))}
          >
            Refresh outgoing action history
          </Button>
          <Button
            variant="outline"
            disabled={busy || !!pending || !!review || !cursor}
            onClick={() => void run(() => loadHistory(null))}
          >
            Newest outgoing actions
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              !!pending ||
              !!review ||
              !history?.has_more ||
              !history.items.length
            }
            onClick={() => {
              const last = history?.items.at(-1);
              if (last)
                void run(() =>
                  loadHistory({ at: last.created_at, id: last.id }),
                );
            }}
          >
            Older outgoing actions
          </Button>
        </div>
      </section>
    </div>
  );
}
