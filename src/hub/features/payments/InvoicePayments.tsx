import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dollarsToCents } from "../billing/money";
import { paymentDb as db } from "./api";
import {
  cents,
  checkoutUrl,
  formatCents,
  parsePaymentState,
  parseProfile,
  validateIntent,
  verifyPrepared,
  type PaymentState,
  type PendingIntent,
  type ProviderProfile,
} from "./state";
interface Props {
  invoiceId: string;
  clientId: string;
  invoiceTotalCents: number;
  canPrepare: boolean;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function InvoicePayments(props: Props) {
  const { session } = useAuth();
  return session ? (
    <PaymentSession
      key={`${session.user.id}:${props.invoiceId}:${props.clientId}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
function PaymentSession({
  invoiceId,
  clientId,
  invoiceTotalCents,
  canPrepare,
  disabled,
  onDirtyChange,
  actor,
}: Props & { actor: string }) {
  const [state, setState] = useState<PaymentState | null>(null),
    [profile, setProfile] = useState<ProviderProfile | null>(null),
    [configReady, setConfigReady] = useState(false),
    [readError, setReadError] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [draft, setDraft] = useState(false);
  const [selected, setSelected] = useState<{
      family: "checkout" | "refund";
      id: string;
    } | null>(null),
    [url, setUrl] = useState<{ id: string; value: string } | null>(null),
    [attest, setAttest] = useState(false),
    [refundPayment, setRefundPayment] = useState(""),
    [refundAmount, setRefundAmount] = useState(""),
    [refundReason, setRefundReason] = useState("");
  const pending = useRef<PendingIntent | null>(null),
    active = useRef(true),
    lock = useRef(false),
    initialized = useRef(false);
  const storageKey = `invoice-payment-intent:${actor}:${invoiceId}:${clientId}`;
  const clearPending = () => {
    pending.current = null;
    sessionStorage.removeItem(storageKey);
    setUncertain(false);
  };
  const hydratePending = () => {
    if (pending.current) return;
    const raw = sessionStorage.getItem(storageKey);
    if (raw)
      pending.current = validateIntent(JSON.parse(raw), invoiceId, clientId);
  };
  const read = async () => {
    const r = await db.rpc("read_invoice_payment_state", {
      p_invoice_id: invoiceId,
      p_client_id: clientId,
    });
    if (r.error) {
      if (active.current) setReadError(true);
      throw r.error;
    }
    let fresh: PaymentState;
    try {
      fresh = parsePaymentState(r.data, invoiceId, clientId);
    } catch (e) {
      if (active.current) setReadError(true);
      throw e;
    }
    if (!active.current) return fresh;
    setState(fresh);
    setReadError(false);
    if (pending.current) {
      const intent = pending.current;
      const row =
        intent.family === "checkout"
          ? fresh.attempts.find((a) => a.id === intent.args.p_request_id)
          : fresh.refund_requests.find(
              (a) => a.id === intent.args.p_request_id,
            );
      if (row) {
        if (
          row.actor_id !== actor ||
          cents(row.amount_cents) !== BigInt(intent.args.p_amount_cents)
        )
          throw new Error(
            "Saved payment history does not match the original request.",
          );
        setSelected({ family: intent.family, id: row.id });
        clearPending();
        setDraft(false);
        setAttest(false);
      }
    }
    return fresh;
  };
  const readProfile = async () => {
    const r = await db
      .from("payment_provider_profiles")
      .select("account_id,livemode,return_origin")
      .limit(2);
    if (r.error) {
      if (active.current) setConfigReady(false);
      throw r.error;
    }
    const p = parseProfile(r.data);
    if (active.current) {
      setProfile(p);
      setConfigReady(true);
    }
    return p;
  };
  useEffect(() => {
    active.current = true;
    if (initialized.current)
      return () => {
        active.current = false;
      };
    initialized.current = true;
    lock.current = true;
    setBusy(true);
    void (async () => {
      try {
        hydratePending();
        await read();
        await readProfile();
        if (active.current) {
          setReady(true);
          if (pending.current) setUncertain(true);
        }
      } catch {
        if (active.current)
          setError(
            "Payment records or configuration could not be loaded. Recover recorded payment state before preparing anything.",
          );
      } finally {
        lock.current = false;
        if (active.current) setBusy(false);
      }
    })();
    return () => {
      active.current = false;
    }; // Stable identity mount; no provider request is made on initial recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = busy || uncertain || draft;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "Action not confirmed. Recover recorded state and retry the same request; do not create a replacement payment or refund.",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const blocked = Boolean(
    state &&
      (state.reconciliation_observations.length ||
        state.attempts.some((a) => a.state === "reconciliation") ||
        state.refund_requests.some((a) => a.state === "reconciliation")),
  );
  const unresolved = Boolean(
    state &&
      (state.attempts.some((a) => !["paid", "expired"].includes(a.state)) ||
        cents(state.balance.pending_refund_cents) > 0n),
  );
  const selectedCheckout =
    selected?.family === "checkout"
      ? state?.attempts.find((a) => a.id === selected.id)
      : null;
  const selectedRefund =
    selected?.family === "refund"
      ? state?.refund_requests.find((a) => a.id === selected.id)
      : null;
  const selectedRow = selectedCheckout ?? selectedRefund;
  const select = (family: "checkout" | "refund", id: string) => {
    setSelected({ family, id });
    setUrl(null);
    setAttest(false);
    setNotice("");
  };
  const prepare = (family: "checkout" | "refund") =>
    run(async () => {
      if (!pending.current) {
        if (!state || !profile || !attest)
          throw new Error(
            "Review the current amount and payment request first.",
          );
        const snapshot = state;
        const fresh = await read();
        if (!active.current) return;
        if (snapshot.source_hash !== fresh.source_hash) {
          setAttest(false);
          throw new Error(
            "Invoice credits or cash changed. Review the refreshed balance before preparing a request.",
          );
        }
        if (family === "checkout") {
          const amount = cents(snapshot.balance.outstanding_cents);
          if (amount < 50n || amount > 99999999n)
            throw new Error(
              "Checkout requires an outstanding amount between $0.50 and $999,999.99.",
            );
          pending.current = {
            family,
            args: {
              p_request_id: crypto.randomUUID(),
              p_invoice_id: invoiceId,
              p_client_id: clientId,
              p_source_hash: snapshot.source_hash,
              p_amount_cents: Number(amount),
              p_account_id: profile.account_id,
              p_livemode: profile.livemode,
              p_success_url: profile.return_origin + "/payment/return",
              p_cancel_url: profile.return_origin + "/payment/cancel",
            },
          };
        } else {
          const amount = dollarsToCents(refundAmount),
            payment = snapshot.payments.find((p) => p.id === refundPayment);
          if (
            !payment ||
            !refundReason.trim() ||
            BigInt(amount) > cents(snapshot.balance.refundable_cents) ||
            BigInt(amount) > cents(payment.amount_cents)
          )
            throw new Error(
              "Choose a captured payment, enter a reason, and keep the refund within credited excess cash.",
            );
          pending.current = {
            family,
            args: {
              p_request_id: crypto.randomUUID(),
              p_invoice_id: invoiceId,
              p_payment_id: refundPayment,
              p_amount_cents: amount,
              p_reason: refundReason.trim(),
            },
          };
        }
        validateIntent(pending.current, invoiceId, clientId);
      }
      const intent = pending.current;
      sessionStorage.setItem(storageKey, JSON.stringify(intent));
      setUncertain(true);
      setUrl(null);
      const result =
        intent.family === "checkout"
          ? await db.rpc("prepare_invoice_checkout", intent.args)
          : await db.rpc("prepare_invoice_refund", intent.args);
      if (!active.current) return;
      if (result.error) {
        const fresh = await read();
        const found =
          intent.family === "checkout"
            ? fresh.attempts.some((a) => a.id === intent.args.p_request_id)
            : fresh.refund_requests.some(
                (a) => a.id === intent.args.p_request_id,
              );
        if (
          !found &&
          ["23514", "23505", "42501", "40001"].includes(result.error.code)
        ) {
          clearPending();
          setAttest(false);
          setDraft(true);
          throw new Error(
            "Preparation was rejected without a saved request. Review the current balance and request details.",
          );
        }
        if (!found) throw result.error;
      } else verifyPrepared(result.data, intent, actor);
      await read();
      if (pending.current)
        throw new Error(
          "Preparation receipt remains unconfirmed. Recover or retry this same saved intent.",
        );
      setNotice(
        "Request prepared. Review the saved amount below before contacting Stripe.",
      );
    });
  const provider = (action: "create" | "recover" | "expire") =>
    run(async () => {
      if (!selected || !selectedRow || selectedRow.actor_id !== actor)
        throw new Error(
          "Only the originating active staff member can retry this provider request.",
        );
      if (!attest)
        throw new Error(
          "Confirm the saved amount and the selected Stripe action first.",
        );
      const selection = selected;
      setUrl(null);
      setUncertain(true);
      setAttest(false);
      const response = await supabase.functions.invoke(
        selection.family === "checkout" ? "invoice-checkout" : "invoice-refund",
        { body: { p_request_id: selection.id, action } },
      );
      if (!active.current) return;
      let value = response.data as {
        state?: string;
        client_url?: unknown;
        error?: string;
      } | null;
      if (response.error) {
        try {
          value = await (response.error.context as Response).clone().json();
        } catch {
          value = null;
        }
      }
      await read();
      if (!active.current) return;
      if (value?.error === "payments_disabled") {
        setUncertain(false);
        throw new Error(
          "Stripe payments are not enabled. The saved request is retained; setup is required before provider operations.",
        );
      }
      if (
        value?.state === "collection_paused" ||
        value?.state === "refunds_paused"
      ) {
        setUncertain(false);
        throw new Error(
          "New Stripe operations are paused. The saved request remains available for recovery.",
        );
      }
      if (value?.state === "reconciliation") {
        setUncertain(false);
        throw new Error(
          "This request needs payment reconciliation. No automatic resolution or replacement request is available.",
        );
      }
      if (
        !value ||
        ![
          "session_open",
          "session_expired",
          "payment_succeeded",
          "paid",
          "expired",
          "pending",
          "succeeded",
          "failed",
        ].includes(value.state ?? "")
      )
        throw new Error(
          "Stripe response is uncertain. Recover or retry this same saved request before proceeding.",
        );
      if (
        selection.family === "checkout" &&
        value.state === "session_open" &&
        action !== "expire"
      ) {
        const safe = checkoutUrl(value.client_url);
        if (safe) setUrl({ id: selection.id, value: safe });
      }
      setUncertain(false);
      setNotice(
        "Recorded payment state refreshed from the server. Checkout completion in the browser alone does not prove payment.",
      );
    });
  const balance = state?.balance;
  const credits =
    balance &&
    Number.isSafeInteger(invoiceTotalCents) &&
    BigInt(invoiceTotalCents) >= cents(balance.obligation_cents)
      ? String(BigInt(invoiceTotalCents) - cents(balance.obligation_cents))
      : null;
  return (
    <section
      aria-label="Invoice payments"
      className="space-y-4 rounded-md border p-4"
    >
      <h4 className="font-semibold">Payments and refunds</h4>
      {!ready && <p role="status">Checking recorded payments…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {configReady && !profile && (
        <p role="status">
          Stripe setup is required. No practice payment account is configured.
        </p>
      )}
      {profile && (
        <p className="text-sm">
          {profile.livemode
            ? "Stripe live payments"
            : "Stripe test mode — simulated money"}
        </p>
      )}
      {readError && (
        <p role="alert">
          The current balance is unavailable. Retained history below may be out
          of date; payment actions are disabled.
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy || draft}
        onClick={() =>
          void run(async () => {
            hydratePending();
            await read();
            await readProfile();
            setReady(true);
            if (pending.current) setUncertain(true);
            else setUncertain(false);
            setUrl(null);
            setAttest(false);
          })
        }
      >
        Recover recorded payment state
      </Button>
      {balance && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt>Invoice credits</dt>
          <dd>
            {credits === null ? "Refresh invoice total" : formatCents(credits)}
          </dd>
          <dt>Amount owed after credits</dt>
          <dd>{formatCents(balance.obligation_cents)}</dd>
          <dt>Confirmed payments</dt>
          <dd>{formatCents(balance.paid_cents)}</dd>
          <dt>Confirmed refunds</dt>
          <dd>{formatCents(balance.refunded_cents)}</dd>
          <dt>Net cash received</dt>
          <dd>{formatCents(balance.net_cash_cents)}</dd>
          <dt>Outstanding</dt>
          <dd>{formatCents(balance.outstanding_cents)}</dd>
          <dt>Refunds reserved</dt>
          <dd>{formatCents(balance.pending_refund_cents)}</dd>
          <dt>Excess cash available to refund</dt>
          <dd>{formatCents(balance.refundable_cents)}</dd>
        </dl>
      )}
      {blocked && (
        <p role="alert">
          Payment reconciliation is required. Review provider evidence before
          collection, credit, void or refund actions can resume. This screen
          cannot clear that block.
        </p>
      )}
      {!!state?.reconciliation_observations.length && (
        <ul>
          {state.reconciliation_observations.map((o) => (
            <li key={o.id}>
              {o.family === "refund" ? "Refund" : "Checkout"} review required ·{" "}
              {new Date(o.created_at).toLocaleString("en-US", {
                timeZone: "America/Denver",
              })}{" "}
              Mountain
            </li>
          ))}
        </ul>
      )}
      {pending.current && (
        <Button
          disabled={busy || disabled}
          onClick={() => void prepare(pending.current!.family)}
        >
          Retry same payment preparation
        </Button>
      )}
      {!pending.current && state && (
        <>
          <div className="space-y-2">
            <h5 className="font-medium">Saved Checkout requests</h5>
            {!state.attempts.length && (
              <p className="text-sm">No Checkout requests recorded.</p>
            )}
            {[...state.attempts].reverse().map((a) => (
              <Button
                key={a.id}
                variant="outline"
                disabled={dirty}
                onClick={() => select("checkout", a.id)}
              >
                {formatCents(a.amount_cents)} · {a.state} ·{" "}
                {new Date(a.created_at).toLocaleString("en-US", {
                  timeZone: "America/Denver",
                })}{" "}
                Mountain
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <h5 className="font-medium">Saved refund requests</h5>
            {!state.refund_requests.length && (
              <p className="text-sm">No refund requests recorded.</p>
            )}
            {[...state.refund_requests].reverse().map((r) => (
              <Button
                key={r.id}
                variant="outline"
                disabled={dirty}
                onClick={() => select("refund", r.id)}
              >
                {formatCents(r.amount_cents)} refund · {r.state} ·{" "}
                {new Date(r.created_at).toLocaleString("en-US", {
                  timeZone: "America/Denver",
                })}{" "}
                Mountain
              </Button>
            ))}
          </div>
        </>
      )}
      {selectedRow && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Saved {selected?.family === "checkout" ? "Checkout" : "refund"}:{" "}
            {formatCents(selectedRow.amount_cents)} · {selectedRow.state}
          </p>
          {selectedRefund && <p>Refund reason: {selectedRefund.reason}</p>}
          {selectedRow.actor_id !== actor && (
            <p>
              Provider recovery is available to the staff member who prepared
              this request. Its recorded status remains visible here.
            </p>
          )}
          {selectedRow.actor_id === actor &&
            ![
              "paid",
              "expired",
              "succeeded",
              "failed",
              "reconciliation",
            ].includes(selectedRow.state) && (
              <>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={attest}
                    disabled={busy || disabled || readError}
                    onChange={(e) => setAttest(e.target.checked)}
                  />
                  <span>
                    I reviewed this saved{" "}
                    {formatCents(selectedRow.amount_cents)}{" "}
                    {selected?.family === "refund"
                      ? "refund and reason. The next action may return money through Stripe."
                      : "Checkout. The next action may create or recover its Stripe payment page."}
                  </span>
                </label>
                <Button
                  disabled={busy || disabled || readError || !attest}
                  onClick={() => void provider("recover")}
                >
                  {selected?.family === "refund"
                    ? "Submit or recover this same Stripe refund"
                    : "Create or recover this same Stripe Checkout"}
                </Button>
                {selected?.family === "checkout" && (
                  <Button
                    variant="outline"
                    disabled={busy || disabled || readError || !attest}
                    onClick={() => void provider("expire")}
                  >
                    Expire this Stripe Checkout
                  </Button>
                )}
              </>
            )}
          {url &&
            url.id === selectedRow.id &&
            selectedCheckout?.state === "open" &&
            !readError && (
              <Button asChild>
                <a
                  href={url.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Open Stripe Checkout
                </a>
              </Button>
            )}
          <Button
            variant="outline"
            disabled={busy || uncertain}
            onClick={() => {
              setSelected(null);
              setAttest(false);
              setUrl(null);
            }}
          >
            Close saved payment review
          </Button>
        </div>
      )}
      {!selected && !pending.current && state && (
        <fieldset
          disabled={
            busy ||
            disabled ||
            !ready ||
            readError ||
            !configReady ||
            !profile ||
            !canPrepare ||
            blocked ||
            unresolved
          }
          className="space-y-3"
        >
          <p className="text-sm">
            Creating Checkout collects only the outstanding amount. For a
            service adjustment, record an invoice credit first; refunds can
            return only excess captured cash. Preparing a request does not send
            it to Stripe.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => {
                setAttest(e.target.checked);
                setDraft(e.target.checked);
              }}
            />
            <span>
              I reviewed the current invoice, credits, cash and requested
              amount.
            </span>
          </label>
          <Button
            disabled={!attest || cents(state.balance.outstanding_cents) < 50n}
            onClick={() => void prepare("checkout")}
          >
            Prepare {formatCents(state.balance.outstanding_cents)} Checkout
          </Button>
          <label className="block">
            Captured payment for refund
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={refundPayment}
              onChange={(e) => {
                setRefundPayment(e.target.value);
                setDraft(true);
                setAttest(false);
              }}
            >
              <option value="">Choose a confirmed payment</option>
              {state.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatCents(p.amount_cents)} ·{" "}
                  {new Date(p.created_at).toLocaleString("en-US", {
                    timeZone: "America/Denver",
                  })}{" "}
                  Mountain
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Refund amount in dollars
            <Input
              inputMode="decimal"
              value={refundAmount}
              onChange={(e) => {
                setRefundAmount(e.target.value);
                setDraft(true);
                setAttest(false);
              }}
            />
          </label>
          <label className="block">
            Refund reason
            <Input
              maxLength={2000}
              value={refundReason}
              onChange={(e) => {
                setRefundReason(e.target.value);
                setDraft(true);
                setAttest(false);
              }}
            />
          </label>
          <Button
            disabled={
              !attest ||
              !refundPayment ||
              !refundReason.trim() ||
              cents(state.balance.refundable_cents) === 0n
            }
            onClick={() => void prepare("refund")}
          >
            Prepare reviewed refund reservation
          </Button>
        </fieldset>
      )}
      {draft && !pending.current && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setDraft(false);
            setAttest(false);
            setRefundAmount("");
            setRefundReason("");
            setRefundPayment("");
          }}
        >
          Discard unsent payment draft
        </Button>
      )}
    </section>
  );
}
