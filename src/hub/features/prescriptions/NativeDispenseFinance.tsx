import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NativeDispense } from "./fulfillment-api";
import type { PrescriptionRpc } from "./prescription-api";
import {
  createNativeDispenseFinanceApi,
  financeDollarsToCents,
  formatFinanceCents,
  type FinanceRead,
  type FinancePreview,
  type FinanceIntent,
} from "./dispense-finance-api";
import { useDispenseFinanceOperation } from "./useDispenseFinanceOperation";
interface Props {
  actor: string;
  dispense: NativeDispense;
  medicationName: string;
  evidenceRevision: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}
const labels: Record<string, string> = {
  invoice_not_issued: "The invoice must be issued.",
  checkout_unresolved: "An existing checkout needs resolution.",
  payment_reconciliation: "A payment needs reconciliation.",
  credit_capacity_exceeded:
    "The amount exceeds the available credit allowance.",
  refund_capacity_exceeded:
    "The amount exceeds the linked credit or refundable payment allowance.",
};
export function NativeDispenseFinance(p: Props) {
  return <Workspace key={`${p.actor}:${p.dispense.id}`} {...p} />;
}
function Workspace({
  actor,
  dispense,
  medicationName,
  evidenceRevision,
  disabled,
  onDirtyChange,
  onClose,
}: Props) {
  const cache = useQueryClient(),
    target = useMemo(
      () => ({
        authorization_id: dispense.authorization_id,
        pet_id: dispense.pet_id,
        dispense_id: dispense.id,
      }),
      [dispense],
    );
  const api = useMemo(
    () =>
      createNativeDispenseFinanceApi(
        supabase as unknown as PrescriptionRpc,
        actor,
        target,
      ),
    [actor, target],
  );
  const [data, setData] = useState<FinanceRead | null>(null),
    [preview, setPreview] = useState<FinancePreview | null>(null),
    [action, setAction] = useState<"credit" | "refund">("credit"),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [credit, setCredit] = useState(""),
    [payment, setPayment] = useState(""),
    [attest, setAttest] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const alive = useRef(true),
    generation = useRef(0),
    draft = amount !== "" || reason !== "" || credit !== "" || payment !== "";
  const load = useCallback(async () => {
    const n = ++generation.current;
    setBusy(true);
    try {
      const next = await api.read();
      if (alive.current && n === generation.current) {
        if (next.snapshot.authorization_hash !== dispense.authorization_hash)
          throw new Error(
            "Authorization evidence does not match this dispense.",
          );
        setData(next);
        setStale(false);
        setError("");
      }
    } catch (e) {
      if (alive.current && n === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "Financial history could not be loaded.",
        );
    } finally {
      if (alive.current && n === generation.current) setBusy(false);
    }
  }, [api, dispense.authorization_hash]);
  const op = useDispenseFinanceOperation({
    actor,
    target,
    parseOperation: api.parseOperation,
    execute: api.execute,
    recover: api.recover,
    close: api.close,
    onClosed: () => {
      setAttest(false);
      setPreview(null);
      void load();
    },
    onConfirmed: (receipt) => {
      setAmount("");
      setReason("");
      setCredit("");
      setPayment("");
      setAttest(false);
      setPreview(null);
      void load();
      void cache.invalidateQueries({
        queryKey: ["invoice", receipt.result.invoice_id],
      });
      void cache.invalidateQueries({
        queryKey: ["invoice-details", receipt.result.invoice_id],
      });
      void cache.invalidateQueries({ queryKey: ["household-invoices"] });
      void cache.invalidateQueries({
        queryKey: ["native-dispense-finance", receipt.result.invoice_id],
      });
    },
  });
  useEffect(() => {
    if (op.state.phase === "editing" && op.error) {
      setPreview(null);
      setAttest(false);
    }
  }, [op.state.phase, op.error]);
  const dirty = draft || op.dirty;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]); // API is target scoped.
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (dirtyRef.current) setStale(true);
    else void load();
  }, [evidenceRevision, load]);
  const invoiceId = data?.snapshot.invoice.id;
  useEffect(
    () =>
      cache.getQueryCache().subscribe((event) => {
        if (
          event.type !== "updated" ||
          event.action.type !== "invalidate" ||
          !invoiceId
        )
          return;
        const key = event.query.queryKey;
        if (
          !["invoice", "invoice-details", "native-dispense-finance"].includes(
            String(key[0]),
          ) ||
          key[1] !== invoiceId
        )
          return;
        if (dirtyRef.current) setStale(true);
        else void load();
      }),
    [cache, invoiceId, load],
  );
  async function review() {
    if (busy || disabled || op.locked) return;
    setBusy(true);
    setError("");
    try {
      const intent: FinanceIntent = {
        target,
        action,
        amount_cents: financeDollarsToCents(amount),
        reason: reason.trim(),
        credit_id: action === "refund" ? credit : null,
        payment_id: action === "refund" ? payment : null,
      };
      const p = await api.preview(intent);
      if (!alive.current) return;
      setPreview(p);
      setStale(false);
      setAttest(false);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Financial review failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function confirm() {
    if (!preview?.allowed || !attest || stale || disabled) return;
    op.review({
      id: crypto.randomUUID(),
      kind: "record_native_dispense_finance",
      payload: {
        intent: preview.context.intent,
        expected_context_hash: preview.context_hash,
        attest_review: true,
      },
    });
  }
  const pending = op.state.operation?.payload as
    | { intent?: FinanceIntent }
    | undefined;
  const frozen = op.locked || op.state.phase === "review";
  const editable = !disabled && !busy && !frozen;
  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-label="Dispense financial review"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            Credit and refund review · {medicationName}
          </h3>
          <p className="text-sm text-muted-foreground">
            Credits reduce the invoice amount owed. Refund reservations do not
            confirm money has been returned. Physical stock and prescription
            allowance remain separate.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || op.dirty}
          onClick={() => {
            if (
              !draft ||
              window.confirm("Discard this unsent financial draft?")
            )
              onClose();
          }}
        >
          Close financial review
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {op.error && (
        <p role="alert" className="text-destructive">
          {op.error}
        </p>
      )}
      {op.notice && <p role="status">{op.notice}</p>}
      {stale && (
        <p role="status">
          Related evidence changed. Your draft is retained; review current
          evidence before a new submission.
        </p>
      )}
      {data && (
        <>
          <dl className="grid gap-2 text-sm md:grid-cols-3">
            <div>
              <dt>Invoice status</dt>
              <dd>{data.snapshot.invoice.status}</dd>
            </div>
            <div>
              <dt>Available dispense credit</dt>
              <dd>
                {formatFinanceCents(
                  data.snapshot.capacity.credit_capacity_cents,
                )}
              </dd>
            </div>
            <div>
              <dt>Currently refundable</dt>
              <dd>
                {data.snapshot.balance
                  ? formatFinanceCents(data.snapshot.balance.refundable_cents)
                  : "Invoice is not issued"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Reviewed source revisions: annotations{" "}
            {data.snapshot.source_heads.correction.version}, returns{" "}
            {data.snapshot.source_heads.returns.version}, discrepancies{" "}
            {data.snapshot.source_heads.discrepancy.version}. Financial review
            does not resolve a physical discrepancy.
          </p>
        </>
      )}
      {!frozen && (
        <fieldset disabled={!editable} className="space-y-3">
          <label className="block text-sm">
            Financial action
            <select
              className="mt-1 block w-full rounded-md border bg-background p-2"
              value={action}
              onChange={(e) => {
                setAction(e.target.value as typeof action);
                setPreview(null);
              }}
            >
              <option value="credit">Record invoice credit</option>
              <option value="refund">
                Reserve refund against a recorded credit
              </option>
            </select>
          </label>
          {action === "refund" && (
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                Recorded dispense credit
                <select
                  aria-label="Recorded dispense credit"
                  className="block w-full rounded-md border bg-background p-2"
                  value={credit}
                  onChange={(e) => {
                    setCredit(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">Choose credit</option>
                  {data?.snapshot.credits
                    .filter((c) => c.dispense_id === dispense.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatFinanceCents(c.amount_cents)} · {c.reason} ·{" "}
                        {c.id}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Captured payment
                <select
                  aria-label="Captured payment"
                  className="block w-full rounded-md border bg-background p-2"
                  value={payment}
                  onChange={(e) => {
                    setPayment(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">Choose payment</option>
                  {data?.snapshot.payments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatFinanceCents(p.remaining_cents)} remaining · {p.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="block">
            Amount in dollars
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label className="block">
            Financial reason
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <Button disabled={!data} onClick={() => void review()}>
            Review financial evidence
          </Button>
        </fieldset>
      )}
      {preview && !frozen && (
        <div className="space-y-3 rounded-md border p-3">
          <p>
            Reviewed{" "}
            {preview.context.intent.action === "credit"
              ? "credit"
              : "refund reservation"}
            : {formatFinanceCents(preview.context.intent.amount_cents)}.
            Eligible now:{" "}
            {formatFinanceCents(preview.context.eligible_amount_cents)}.
          </p>
          <p>{preview.context.intent.reason}</p>
          {preview.blockers.map((b) => (
            <p key={b} role="alert">
              {labels[b] ?? b}
            </p>
          ))}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
            />
            I reviewed this exact dispense, invoice, amount and reason
            {action === "refund"
              ? " and the linked credit and captured payment"
              : ""}
            .
          </label>
          <Button
            disabled={!preview.allowed || !attest || stale || disabled || busy}
            onClick={confirm}
          >
            Lock reviewed request
          </Button>
        </div>
      )}
      {pending?.intent && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Original request: {pending.intent.action} ·{" "}
            {formatFinanceCents(pending.intent.amount_cents)} ·{" "}
            {pending.intent.reason}
          </p>
          <p className="break-all text-xs">Request {op.state.operation?.id}</p>
        </div>
      )}
      {op.state.phase === "review" && (
        <div className="flex gap-2">
          <Button disabled={disabled || stale} onClick={() => void op.commit()}>
            Record reviewed financial operation
          </Button>
          <Button variant="outline" onClick={op.discard}>
            Edit review
          </Button>
        </div>
      )}
      {["uncertain", "retryable"].includes(op.state.phase) && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void op.recoverOriginal()}>
            Recover original financial request
          </Button>
          <Button variant="outline" onClick={() => void op.closeOriginal()}>
            Resolve or close original request
          </Button>
          {op.state.phase === "retryable" && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void op.commit()}
            >
              Retry identical financial request
            </Button>
          )}
        </div>
      )}
      {["uncertain", "retryable"].includes(op.state.phase) && (
        <p className="text-sm text-muted-foreground">
          Resolve returns the recorded result if this request completed. Otherwise,
          it permanently closes this request so you can review current evidence
          and start again. It does not reverse a recorded credit or refund.
        </p>
      )}
      {["committing", "recovering"].includes(op.state.phase) && (
        <p role="status">Checking the original financial request…</p>
      )}
      <div className="space-y-2">
        <h4 className="font-medium">Dispense financial history</h4>
        <Button
          variant="outline"
          disabled={busy || op.dirty}
          onClick={() => {
            setPreview(null);
            setAttest(false);
            void load();
          }}
        >
          Refresh financial history
        </Button>
        {data?.results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No financial operations recorded for this dispense.
          </p>
        )}
        {data?.results.map((r) => {
          const refund = data.snapshot.refunds.find(
            (f) => f.id === r.refund_request_id,
          );
          return (
            <article key={r.id} className="rounded-md border p-3 text-sm">
              <p>
                {r.action === "credit"
                  ? "Invoice credit"
                  : "Refund reservation"}{" "}
                · {formatFinanceCents(r.amount_cents)}
              </p>
              <p>{r.reason}</p>
              <p>
                {new Date(r.created_at).toLocaleString()} · recorded by{" "}
                {r.actor_id}
              </p>
              {refund && (
                <p>
                  Current refund outcome:{" "}
                  {refund.settled
                    ? "Settled in the payment ledger"
                    : refund.state}
                  .{" "}
                  {refund.settled
                    ? ""
                    : "A reservation is not proof of payment to the client."}
                </p>
              )}
              <p className="break-all text-xs text-muted-foreground">
                Operation {r.id}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
