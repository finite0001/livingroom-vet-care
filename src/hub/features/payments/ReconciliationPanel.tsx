import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { formatCents } from "./state";
import {
  previewReconciliation,
  prepareReconciliation,
  recoverReconciliation,
  reconciliationDb,
  readReconciliationWorkspace,
} from "./ReconciliationApi";
import {
  reconciliationIntent,
  reconciliationReview,
  reconciliationTarget,
  matchesReconciliationIntent,
  freshReconciliationProof,
  type ReconciliationIntent,
  type ReconciliationReview,
  type ReconciliationTarget,
  type ReconciliationWorkspace,
} from "./ReconciliationState";
interface Props {
  invoiceId: string;
  clientId: string;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
const time = (value: string) =>
  new Date(value).toLocaleString("en-US", { timeZone: "America/Denver" }) +
  " Mountain";
const reasonLabel = (reason: string) =>
  reason === "provider_object_unavailable"
    ? "The previously attributed provider object could not be retrieved."
    : reason === "provider_reconciliation_required"
      ? "The provider result requires evidence review."
      : "Conflicting financial evidence requires separate review.";
const statusLabel = (status: string) =>
  ({
    session_open: "Checkout remains open; its collection reservation remains.",
    session_expired: "Checkout expired without payment.",
    payment_succeeded: "Provider confirms payment succeeded.",
    pending: "Refund remains pending; its reservation remains.",
    failed: "Provider confirms refund failed.",
    succeeded: "Provider confirms refund succeeded.",
  })[status] ?? "Unsupported provider status";
export function ReconciliationPanel(props: Props) {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active && hasRole("ADMIN") ? (
    <ReconciliationSession
      key={`${session.user.id}:${props.invoiceId}:${props.clientId}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
function ReconciliationSession({
  invoiceId,
  clientId,
  disabled,
  onDirtyChange,
  actor,
}: Props & { actor: string }) {
  const [workspace, setWorkspace] = useState<ReconciliationWorkspace>({
      targets: [],
      cases: [],
      hasMoreCases: false,
    }),
    [choice, setChoice] = useState(""),
    [preview, setPreview] = useState<ReconciliationTarget | null>(null),
    [review, setReview] = useState<ReconciliationReview | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [hasPending, setHasPending] = useState(false),
    [absentConfirmed, setAbsentConfirmed] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef<ReconciliationIntent | null>(null),
    lock = useRef(false),
    active = useRef(true),
    initialized = useRef(false);
  const storageKey = `invoice-payment-intent:${actor}:${invoiceId}:${clientId}:reconciliation`;
  const dirty = busy || uncertain || hasPending || Boolean(preview) || checked;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const load = async () => {
    const next = await readReconciliationWorkspace(invoiceId, clientId, actor);
    if (active.current) setWorkspace(next);
  };
  const accept = (value: unknown, id?: string) => {
    const next = reconciliationReview(value, invoiceId, id);
    if (!active.current) return next;
    if (
      next &&
      pending.current &&
      !matchesReconciliationIntent(next, pending.current, actor)
    )
      throw new Error("Original review differs");
    if (next) {
      setReview(next);
      setPreview(null);
      setWorkspace((w) => ({
        ...w,
        cases: [next, ...w.cases.filter((c) => c.case.id !== next.case.id)],
      }));
      if (pending.current) {
        sessionStorage.removeItem(storageKey);
        pending.current = null;
        setHasPending(false);
      }
    }
    setChecked(false);
    setUncertain(false);
    return next;
  };
  const recover = async (id: string) => {
    const next = accept(await recoverReconciliation(id), id);
    if (active.current) setAbsentConfirmed(next === null);
    return next;
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch {
      if (active.current)
        setError(
          "Review unavailable or unconfirmed. Recover the same case. Missing objects, context mismatches and contradictory terminal evidence require separate review; they cannot be cleared here.",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    if (!initialized.current) {
      initialized.current = true;
      void run(async () => {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          pending.current = reconciliationIntent(JSON.parse(raw), invoiceId);
          setHasPending(true);
          setUncertain(true);
        }
        await load();
        if (pending.current) await recover(pending.current.p_case_id);
      });
    }
    return () => {
      active.current = false;
    };
    // The keyed invoice/administrator session owns async responses and durable nonsecret intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected = workspace.targets.find(
    (t) => `${t.family}:${t.request_id}` === choice,
  );
  const showPreview = () =>
    void run(async () => {
      if (!selected?.provider_object_id || !selected.reviewable)
        throw new Error("Known object required");
      const next = reconciliationTarget(
        await previewReconciliation(
          invoiceId,
          selected.family,
          selected.request_id,
          selected.provider_object_id,
        ),
        invoiceId,
      );
      if (
        next.family !== selected.family ||
        next.request_id !== selected.request_id ||
        next.provider_object_id !== selected.provider_object_id
      )
        throw new Error("Target differs");
      if (active.current) {
        setPreview(next);
        setReview(null);
        setChecked(false);
      }
    });
  const prepare = () =>
    void run(async () => {
      let intent = pending.current;
      if (!intent) {
        if (preview && checked)
          intent = {
            p_case_id: crypto.randomUUID(),
            p_invoice_id: invoiceId,
            p_family: preview.family,
            p_request_id: preview.request_id,
            p_provider_object_id: preview.provider_object_id,
            p_blocker_refs: preview.blocker_refs,
            p_expected_case_hash: preview.snapshot_hash,
          };
        else if (
          review &&
          !review.capture &&
          !review.resolution &&
          review.case.actor_id === actor
        ) {
          const c = review.case;
          intent = {
            p_case_id: c.id,
            p_invoice_id: invoiceId,
            p_family: c.family,
            p_request_id: c.request_id,
            p_provider_object_id: c.provider_object_id,
            p_blocker_refs: c.blocker_refs,
            p_expected_case_hash: c.snapshot_hash,
          };
        } else throw new Error("Explicit review required");
        sessionStorage.setItem(storageKey, JSON.stringify(intent));
        pending.current = intent;
        setHasPending(true);
      }
      setUncertain(true);
      setAbsentConfirmed(false);
      setChecked(false);
      try {
        accept(await prepareReconciliation(intent), intent.p_case_id);
      } catch {
        await recover(intent.p_case_id);
      }
    });
  const recovery = () =>
    void run(async () => {
      const id = pending.current?.p_case_id ?? review?.case.id;
      if (id) await recover(id);
      await load();
      if (active.current)
        setNotice(
          "Recorded review recovered. No fresh provider request was made.",
        );
    });
  const complete = () =>
    void run(async () => {
      const saved = review;
      if (
        !saved?.capture ||
        saved.case.actor_id !== actor ||
        !checked ||
        !freshReconciliationProof(saved.capture)
      )
        throw new Error("Fresh explicit review required");
      setUncertain(true);
      setChecked(false);
      const { data, error } = await reconciliationDb.rpc(
        "complete_payment_reconciliation",
        {
          p_case_id: saved.case.id,
          p_reviewed_proof_hash: saved.capture.proof_hash,
          p_expected_case_hash: saved.case.snapshot_hash,
          p_attest: true,
        },
      );
      if (error) throw error;
      const next = accept(data, saved.case.id);
      if (!next?.resolution) {
        if (active.current) setUncertain(true);
        throw new Error("Resolution unconfirmed");
      }
      await load();
      if (active.current)
        setNotice(
          "Resolution recorded against the reviewed blockers. Refresh the invoice payment ledger to see confirmed financial evidence.",
        );
    });
  const blocked = busy || Boolean(disabled);
  const proof = review?.capture;
  return (
    <section
      aria-label="Administrator payment reconciliation"
      className="space-y-3 rounded-md border p-4"
    >
      <h4 className="font-semibold">Administrator payment reconciliation</h4>
      <p className="text-sm text-muted-foreground">
        Review fresh evidence for an existing provider object. Resolution
        records verified financial facts; it does not itself charge a card or
        issue a refund.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {uncertain && (
        <p role="status">
          The response is uncertain. Recover the same case before continuing.
        </p>
      )}
      <Button variant="outline" disabled={blocked} onClick={recovery}>
        Recover reconciliation and refresh history
      </Button>
      <label className="block text-sm">
        Existing payment request
        <select
          aria-label="Existing payment request"
          className="mt-1 w-full rounded-md border bg-background p-2"
          disabled={blocked || dirty}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">Choose an existing request</option>
          {workspace.targets.map((t) => (
            <option
              key={`${t.family}:${t.request_id}`}
              value={`${t.family}:${t.request_id}`}
            >
              {t.family === "checkout" ? "Checkout" : "Refund"} ·{" "}
              {formatCents(t.amount_cents)} · {t.request_id.slice(0, 8)}
              {t.provider_object_id ? "" : " · known provider object missing"}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <ul className="text-sm">
          {selected.reasons.map((reason, i) => (
            <li key={i}>{reasonLabel(reason)}</li>
          ))}
        </ul>
      )}
      {selected && !selected.provider_object_id && (
        <p role="status">
          No securely attributed provider object is available. Absence cannot
          prove that payment or refund did not happen.
        </p>
      )}
      {selected?.provider_object_id && !selected.reviewable && (
        <p role="status">
          This request has no eligible matching-object blockers, or contains a
          conflict requiring separate review. It cannot be resolved here.
        </p>
      )}
      <Button
        disabled={
          blocked ||
          dirty ||
          !selected?.provider_object_id ||
          !selected.reviewable
        }
        onClick={showPreview}
      >
        Preview exact reconciliation blockers
      </Button>
      <label className="block text-sm">
        Reconciliation history
        <select
          aria-label="Reconciliation history"
          className="mt-1 w-full rounded-md border bg-background p-2"
          disabled={blocked || dirty}
          value={review?.case.id ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id)
              void run(async () => {
                await recover(id);
              });
            else setReview(null);
          }}
        >
          <option value="">Choose a saved case</option>
          {workspace.cases.map((row) => (
            <option key={row.case.id} value={row.case.id}>
              {row.case.family === "checkout" ? "Checkout" : "Refund"} ·{" "}
              {row.resolution
                ? "resolved"
                : row.capture
                  ? "proof captured"
                  : "awaiting proof"}{" "}
              · {time(row.case.created_at)}
            </option>
          ))}
        </select>
      </label>
      {workspace.hasMoreCases && (
        <p className="text-sm">
          Showing the latest 100 cases. An outstanding saved request is still
          recovered by its original identifier.
        </p>
      )}
      {preview && (
        <div className="space-y-2 rounded-md border p-3">
          <h5 className="font-medium">Review the frozen blocker set</h5>
          <p className="text-sm break-all">
            Provider object: {preview.provider_object_id}
          </p>
          <p>
            {preview.family === "checkout" ? "Checkout" : "Refund"} ·{" "}
            {formatCents(preview.amount_cents)} ·{" "}
            {preview.livemode ? "Live account" : "Test account"}
          </p>
          <p>
            {preview.blocker_refs.length} specific existing blockers will be
            reviewed. Later or different evidence is not included.
          </p>
          <ul>
            {preview.blocker_refs.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`}>
                {ref.kind === "observation"
                  ? "Provider observation"
                  : ref.kind === "checkout_evidence"
                    ? "Quarantined Checkout evidence"
                    : "Quarantined refund evidence"}{" "}
                · {ref.id.slice(0, 8)}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              disabled={blocked || uncertain}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I reviewed this request, amount and exact existing blockers.
          </label>
        </div>
      )}
      {(preview ||
        hasPending ||
        (review && !review.capture && !review.resolution)) && (
        <Button
          disabled={
            blocked ||
            uncertain ||
            (!hasPending && !preview && review?.case.actor_id !== actor) ||
            (!hasPending && Boolean(preview) && !checked)
          }
          onClick={prepare}
        >
          {hasPending
            ? "Retry same case and fetch fresh proof"
            : "Prepare review and fetch fresh provider proof"}
        </Button>
      )}
      {hasPending && absentConfirmed && !uncertain && (
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() =>
            void run(async () => {
              const id = pending.current?.p_case_id;
              if (!id || (await recover(id))) return;
              sessionStorage.removeItem(storageKey);
              pending.current = null;
              if (active.current) {
                setHasPending(false);
                setPreview(null);
                setReview(null);
                setChecked(false);
                setAbsentConfirmed(false);
              }
              await load();
            })
          }
        >
          Discard uncreated case and review current evidence
        </Button>
      )}
      {review && (
        <div className="space-y-2 rounded-md border p-3">
          <h5 className="font-medium">Saved reconciliation case</h5>
          <p className="text-sm break-all">
            Provider object: {review.case.provider_object_id}
          </p>
          <ul className="text-sm">
            {workspace.targets
              .find(
                (t) =>
                  t.family === review.case.family &&
                  t.request_id === review.case.request_id,
              )
              ?.reasons.map((reason, i) => (
                <li key={i}>{reasonLabel(reason)}</li>
              ))}
          </ul>
          <p>
            {review.case.family === "checkout" ? "Checkout" : "Refund"} ·{" "}
            {time(review.case.created_at)} · {review.case.blocker_refs.length}{" "}
            reviewed blockers
          </p>
          {!proof && !review.resolution && (
            <p role="status">
              No verified provider proof has been captured. This request remains
              unresolved; retrying this same case requests fresh proof.
            </p>
          )}
          {proof && (
            <>
              <p>{statusLabel(proof.status)}</p>
              <p>
                Verified amount: {formatCents(proof.amount_cents)} ·{" "}
                {proof.livemode ? "Live account" : "Test account"}
              </p>
              <p>Provider observed: {time(proof.provider_observed_at)}</p>
            </>
          )}
          {review.resolution ? (
            <p role="status">
              Resolution recorded {time(review.resolution.created_at)}. Original
              blocker history is retained.
            </p>
          ) : (
            proof && (
              <>
                <p className="text-sm">
                  This proof applies only to the saved case and blocker
                  snapshot. Completion rechecks the invoice and evidence.
                </p>
                {!freshReconciliationProof(proof) && (
                  <p role="status">
                    The five-minute proof window has expired. Start a new
                    explicit review; this captured proof cannot be renewed.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      blocked ||
                      uncertain ||
                      review.case.actor_id !== actor ||
                      !freshReconciliationProof(proof)
                    }
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  I reviewed this exact captured provider proof and its
                  financial effect.
                </label>
                <Button
                  disabled={
                    blocked ||
                    uncertain ||
                    !checked ||
                    review.case.actor_id !== actor ||
                    !freshReconciliationProof(proof)
                  }
                  onClick={complete}
                >
                  Record reviewed reconciliation
                </Button>
              </>
            )
          )}
          {review.case.actor_id !== actor && (
            <p>
              Only the administrator who prepared this case can complete it.
            </p>
          )}
        </div>
      )}
      {!hasPending && !uncertain && (preview || checked || review) && (
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() => {
            setPreview(null);
            setReview(null);
            setChecked(false);
          }}
        >
          Close review and retain history
        </Button>
      )}
    </section>
  );
}
