import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { paymentDb } from "./api";
import { collectionDb } from "./PaymentCollectionApi";
import {
  collectionIntent,
  collectionCurrent,
  matchesCollectionIntent,
  parseCollection,
  type CollectionGrant,
  type CollectionIntent,
} from "./PaymentCollectionState";
import {
  formatCents,
  parsePaymentState,
  requiresReconciliation,
  type PaymentState,
} from "./state";
interface Props {
  invoiceId: string;
  clientId: string;
  canPrepare: boolean;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function PaymentCollectionPanel(props: Props) {
  const { session } = useAuth();
  return session ? (
    <CollectionSession
      key={`${session.user.id}:${props.invoiceId}:${props.clientId}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
function CollectionSession({
  invoiceId,
  clientId,
  canPrepare,
  disabled,
  onDirtyChange,
  actor,
}: Props & { actor: string }) {
  const [balance, setBalance] = useState<PaymentState | null>(null),
    [history, setHistory] = useState<CollectionGrant[]>([]),
    [selected, setSelected] = useState<CollectionGrant | null>(null),
    [clientName, setClientName] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [attest, setAttest] = useState(false),
    [reason, setReason] = useState(""),
    [days, setDays] = useState("7"),
    [uncertain, setUncertain] = useState(false),
    [hasPending, setHasPending] = useState(false);
  const active = useRef(true),
    lock = useRef(false),
    pending = useRef<CollectionIntent | null>(null),
    initialized = useRef(false);
  const storageKey = `invoice-payment-intent:${actor}:${invoiceId}:${clientId}:collection`;
  const dirty =
    busy ||
    uncertain ||
    hasPending ||
    attest ||
    Boolean(reason) ||
    days !== "7";
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const parse = (value: unknown, id?: string) =>
    parseCollection(value, actor, invoiceId, clientId, id);
  const accept = (grant: CollectionGrant | null) => {
    if (!active.current) return;
    if (
      grant &&
      pending.current &&
      !matchesCollectionIntent(grant, pending.current)
    )
      throw new Error("Original preparation does not match recovered access.");
    setSelected(grant);
    setAttest(false);
    setUncertain(false);
    if (grant) {
      setHistory((rows) => [
        grant,
        ...rows.filter((row) => row.id !== grant.id),
      ]);
      if (pending.current && (grant.contextHash || grant.state === "revoked")) {
        sessionStorage.removeItem(storageKey);
        pending.current = null;
        setHasPending(false);
        setDays("7");
      }
    }
  };
  const recover = async (id?: string) => {
    const requestId = pending.current?.p_request_id ?? id;
    const { data, error } = await supabase.functions.invoke(
      "recover-payment-collection",
      {
        body: {
          p_invoice_id: invoiceId,
          ...(requestId ? { p_request_id: requestId } : {}),
        },
      },
    );
    if (error) throw error;
    const grant = await parse(data, requestId);
    accept(grant);
    return grant;
  };
  const read = async () => {
    const { data, error } = await paymentDb.rpc("read_invoice_payment_state", {
      p_invoice_id: invoiceId,
      p_client_id: clientId,
    });
    if (error) {
      if (active.current) setBalance(null);
      throw error;
    }
    let fresh: PaymentState;
    try {
      fresh = parsePaymentState(data, invoiceId, clientId);
    } catch (error) {
      if (active.current) setBalance(null);
      throw error;
    }
    if (active.current) setBalance(fresh);
    return fresh;
  };
  const readClient = async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("first_name,last_name")
      .eq("id", clientId)
      .single();
    if (error) throw error;
    if (active.current)
      setClientName(`${data.first_name} ${data.last_name}`.trim());
  };
  const list = async () => {
    const { data, error } = await collectionDb.rpc("list_payment_collections", {
      p_invoice_id: invoiceId,
      p_client_id: clientId,
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("History unavailable");
    const rows = await Promise.all(data.map((value) => parse(value)));
    if (rows.some((row) => !row)) throw new Error("History unavailable");
    if (active.current) setHistory(rows as CollectionGrant[]);
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
          "Payment access could not be confirmed. Recover the same access before continuing. Setup may still be needed.",
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
          pending.current = collectionIntent(
            JSON.parse(raw),
            invoiceId,
            clientId,
          );
          setHasPending(true);
          setUncertain(true);
        }
        await readClient();
        await read();
        await list();
        if (pending.current) await recover();
        if (active.current) setReady(true);
      });
    }
    return () => {
      active.current = false;
    };
    // Identity keyed session owns these requests; responses after unmount are ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recovery = () =>
    void run(async () => {
      const recovered = await recover(selected?.id);
      await readClient();
      await read();
      await list();
      if (active.current) {
        setReady(true);
        if (recovered?.state === "revoked") setReason("");
        setNotice(
          pending.current
            ? "Original request retained. Retry its same preparation or revoke the recovered draft."
            : "Recovered recorded payment access.",
        );
      }
    });
  const prepare = () =>
    void run(async () => {
      let intent = pending.current;
      if (!intent) {
        const fresh = await read();
        if (!active.current) return;
        if (
          !balance ||
          balance.source_hash !== fresh.source_hash ||
          balance.balance.outstanding_cents !== fresh.balance.outstanding_cents
        ) {
          setAttest(false);
          throw new Error("Source changed");
        }
        const amount = BigInt(fresh.balance.outstanding_cents);
        if (
          !canPrepare ||
          requiresReconciliation(fresh) ||
          !clientName ||
          amount < 50n ||
          amount > 99999999n ||
          !["1", "2", "3", "4", "5", "6", "7"].includes(days)
        )
          throw new Error("Unavailable");
        intent = {
          p_request_id: crypto.randomUUID(),
          p_invoice_id: invoiceId,
          p_client_id: clientId,
          p_source_hash: fresh.source_hash,
          p_amount_cents: Number(amount),
          p_expires_at: new Date(
            Date.now() + Number(days) * 86400000,
          ).toISOString(),
        };
        sessionStorage.setItem(storageKey, JSON.stringify(intent));
        pending.current = intent;
        setHasPending(true);
      }
      setUncertain(true);
      const { data, error } = await supabase.functions.invoke(
        "prepare-payment-collection",
        { body: intent },
      );
      if (!error) {
        const grant = await parse(data, intent.p_request_id);
        if (grant) {
          accept(grant);
          return;
        }
      }
      await recover(intent.p_request_id);
    });
  const review = () =>
    void run(async () => {
      const grant = selected;
      if (!grant?.contextHash || !attest || !canPrepare)
        throw new Error("Review unavailable");
      const fresh = await read();
      if (!active.current) return;
      if (
        requiresReconciliation(fresh) ||
        !collectionCurrent(
          grant,
          fresh.source_hash,
          fresh.balance.outstanding_cents,
        )
      ) {
        setAttest(false);
        throw new Error("Source changed");
      }
      setUncertain(true);
      setAttest(false);
      const { data, error } = await collectionDb.rpc(
        "attest_payment_collection",
        {
          p_request_id: grant.id,
          p_reviewed_context_hash: grant.contextHash,
          p_attest: true,
        },
      );
      if (error) throw error;
      accept(await parse(data, grant.id));
      if (active.current)
        setNotice("Payment access reviewed. Nothing has been sent.");
    });
  const revoke = () =>
    void run(async () => {
      const grant = selected;
      if (!grant || !reason.trim()) throw new Error("Reason required");
      setUncertain(true);
      const { data, error } = await collectionDb.rpc(
        "revoke_payment_collection",
        { p_request_id: grant.id, p_reason: reason.trim() },
      );
      if (error) throw error;
      accept(await parse(data, grant.id));
      if (active.current) {
        setReason("");
        setNotice(
          "Payment access revoked. Previously disclosed Stripe Checkout sessions are unchanged.",
        );
      }
    });
  const current = Boolean(
    selected &&
      balance &&
      !requiresReconciliation(balance) &&
      collectionCurrent(
        selected,
        balance.source_hash,
        balance.balance.outstanding_cents,
      ),
  );
  const amount = balance ? BigInt(balance.balance.outstanding_cents) : 0n;
  const blocked = busy || Boolean(disabled);
  const canNew =
    ready &&
    canPrepare &&
    balance &&
    !requiresReconciliation(balance) &&
    Boolean(clientName) &&
    amount >= 50n &&
    amount <= 99999999n &&
    !history.some((g) => ["preparing", "captured"].includes(g.state));
  return (
    <section
      aria-label="Client payment access"
      className="space-y-3 rounded-md border p-4"
    >
      <h4 className="font-semibold">Client payment access</h4>
      <p className="text-sm text-muted-foreground">
        Prepare and review permission to pay this invoice. Delivery is a
        separate step; nothing here sends a payment link.
      </p>
      {clientName && (
        <p>
          {clientName} · Invoice {invoiceId.slice(0, 8)}
        </p>
      )}
      {balance && (
        <p>
          Current outstanding amount:{" "}
          {formatCents(balance.balance.outstanding_cents)}. Confirmed payments
          and refunds remain in the payment ledger above.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {uncertain && (
        <p role="status">
          The last response is uncertain. Recover this same access; its original
          amount and expiry are retained.
        </p>
      )}
      <Button variant="outline" disabled={blocked} onClick={recovery}>
        Recover payment access and refresh balance
      </Button>
      <label className="block text-sm">
        Your payment access history
        <select
          aria-label="Your payment access history"
          className="mt-1 w-full rounded-md border bg-background p-2"
          value={selected?.id ?? ""}
          disabled={blocked || dirty}
          onChange={(event) => {
            const id = event.target.value;
            if (id)
              void run(async () => {
                await recover(id);
              });
            else setSelected(null);
          }}
        >
          <option value="">Choose saved access</option>
          {history.map((g) => (
            <option key={g.id} value={g.id}>
              {formatCents(g.amount_cents)} · {g.state} ·{" "}
              {new Date(g.created_at).toLocaleString("en-US", {
                timeZone: "America/Denver",
              }) + " Mountain"}
            </option>
          ))}
        </select>
      </label>
      {!pending.current && (
        <label className="block text-sm">
          Access expires after
          <select
            aria-label="Access expires after"
            className="ml-2 rounded-md border bg-background p-2"
            value={days}
            disabled={blocked || uncertain}
            onChange={(event) => setDays(event.target.value)}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {day} {day === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        disabled={blocked || uncertain || (!pending.current && !canNew)}
        onClick={prepare}
      >
        {pending.current
          ? "Retry same payment access preparation"
          : "Prepare payment access"}
      </Button>
      {(attest || reason || days !== "7") && !uncertain && !hasPending && (
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() => {
            setAttest(false);
            setReason("");
            setDays("7");
          }}
        >
          Discard unsaved access edits
        </Button>
      )}
      {selected && (
        <div className="space-y-3 rounded-md border p-3">
          <h5 className="font-medium">Saved access: {selected.state}</h5>
          <dl className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
            <dt>Authorized amount</dt>
            <dd>{formatCents(selected.amount_cents)}</dd>
            <dt>Collection expires</dt>
            <dd>
              {new Date(selected.expires_at).toLocaleString("en-US", {
                timeZone: "America/Denver",
              }) + " Mountain"}
            </dd>
            <dt>Status remains available until</dt>
            <dd>
              {new Date(selected.status_expires_at).toLocaleString("en-US", {
                timeZone: "America/Denver",
              }) + " Mountain"}
            </dd>
          </dl>
          <p className="text-sm">
            Anyone with a forwarded link may use it. Revocation prevents new
            payment activation but does not cancel a Stripe Checkout URL already
            disclosed.
          </p>
          {(!canPrepare || !current) && selected.state !== "revoked" && (
            <p role="status">
              This access no longer matches the current payable invoice or has
              expired. Review is unavailable; recovery and revocation remain
              available.
            </p>
          )}
          {selected.state === "captured" && (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={attest}
                  disabled={blocked || uncertain || !canPrepare || !current}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                I reviewed this household, invoice, authorized amount, expiry
                and forwarding risk.
              </label>
              <Button
                disabled={
                  blocked || uncertain || !attest || !current || !canPrepare
                }
                onClick={review}
              >
                Confirm payment access review
              </Button>
            </>
          )}
          {selected.state === "reviewed" && (
            <p>Review recorded. No payment link has been sent by this panel.</p>
          )}
          {selected.state !== "revoked" && (
            <>
              <label className="block text-sm" htmlFor={`revoke-${invoiceId}`}>
                Reason for revoking access
              </label>
              <Input
                id={`revoke-${invoiceId}`}
                value={reason}
                maxLength={1000}
                disabled={blocked || uncertain}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={blocked || uncertain || !reason.trim()}
                onClick={revoke}
              >
                Revoke payment access
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
