import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  fetchPayment,
  paymentMoney,
  validPaymentAccess,
  type PaymentAccess,
  type PaymentStatus,
} from "./payment-client";
interface Props {
  access: PaymentAccess;
}
const statusLabels: Record<PaymentStatus["state"], string> = {
  ready: "Payment details",
  confirmation_pending: "Payment confirmation pending",
  paid: "Payment confirmed",
  partially_refunded: "Partial refund confirmed",
  refunded: "Full refund confirmed",
  reconciliation: "Payment needs review",
  checkout_ready: "Ready for secure payment",
};
export default function PaymentPage({ access }: Props) {
  const [status, setStatus] = useState<PaymentStatus | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [closed, setClosed] = useState(false);
  const request = useRef<AbortController | null>(null),
    locked = useRef(false),
    retired = useRef(false);
  const valid = validPaymentAccess(access);
  const clear = () => {
    retired.current = true;
    request.current?.abort();
    access.token = "";
    setStatus(null);
    setClosed(true);
    setBusy(false);
  };
  useEffect(() => {
    const onHide = () => clear();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      retired.current = true;
      request.current?.abort();
      access.token = "";
    }; // The isolated bootstrap owns this mutable capability; no token remains in immutable props after close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const load = async (action: "inspect" | "activate" | "status") => {
    if (locked.current || retired.current || !valid) return;
    locked.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    setStatus(null);
    try {
      const result = await fetchPayment(access, action, controller.signal);
      if (!controller.signal.aborted && !retired.current) setStatus(result);
    } catch {
      if (!controller.signal.aborted && !retired.current) {
        setStatus(null);
        setFailed(true);
      }
    } finally {
      locked.current = false;
      if (!controller.signal.aborted && !retired.current) setBusy(false);
    }
  };
  const inspect = () =>
    void load(access.kind === "collection" ? "inspect" : "status");
  const canActivate =
    status?.collection_available === true &&
    ["ready", "confirmation_pending"].includes(status.state);
  return (
    <main className="min-h-screen bg-background px-4 py-8 font-sans text-foreground md:px-8 md:py-12">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-sm font-medium text-muted-foreground">
            The Living Room Vet
          </p>
          <h1 className="mt-2 font-serif text-3xl">
            {access.kind === "collection" ? "Your payment" : "Payment status"}
          </h1>
        </header>
        <section
          aria-label="Private payment access"
          aria-busy={busy}
          className="space-y-4 rounded-lg border border-border bg-card p-5 md:p-6"
        >
          {access.kind === "neutral" ? (
            <>
              <h2 className="text-lg font-semibold">
                Check your original payment link
              </h2>
              <p>
                Returning from or leaving Checkout does not confirm whether a
                payment completed. Open the original payment link from the
                practice to check its confirmed status, or contact the practice.
              </p>
            </>
          ) : closed || !valid ? (
            <>
              <h2 className="text-lg font-semibold">
                Open the original link from your message
              </h2>
              <p className="text-sm text-muted-foreground">
                This page does not save access details. Reopen the link from the
                practice to view payment information.
              </p>
            </>
          ) : (
            <>
              {!status && !busy && !failed && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Open this private link to view the requested amount and
                    confirmed payment status. Opening it does not start a
                    payment.
                  </p>
                  <Button onClick={inspect}>
                    {access.kind === "collection"
                      ? "Open payment"
                      : "Check payment status"}
                  </Button>
                </>
              )}
              {busy && (
                <p role="status" className="text-sm">
                  Checking secure payment information…
                </p>
              )}
              {failed && (
                <>
                  <p role="alert" className="text-destructive">
                    Payment information is unavailable. Access may have expired
                    or changed. Try the original link again or contact the
                    practice if this continues.
                  </p>
                  <Button disabled={busy} onClick={inspect}>
                    Check again
                  </Button>
                </>
              )}
              {status && (
                <>
                  <h2 className="text-lg font-semibold" aria-live="polite">
                    {statusLabels[status.state]}
                  </h2>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <dt>Requested amount</dt>
                    <dd className="text-right font-medium">
                      {paymentMoney(status.amount_cents)} USD
                    </dd>
                    <dt>Confirmed paid</dt>
                    <dd className="text-right">
                      {paymentMoney(status.confirmed_paid_cents)}
                    </dd>
                    <dt>Confirmed refunded</dt>
                    <dd className="text-right">
                      {paymentMoney(status.confirmed_refunded_cents)}
                    </dd>
                  </dl>
                  {status.state === "confirmation_pending" && (
                    <p className="text-sm">
                      Confirmation is still pending. Check status again before
                      starting another payment. This page will show money
                      received only after server confirmation.
                    </p>
                  )}
                  {status.state === "reconciliation" && (
                    <p className="text-sm">
                      The practice needs to review this payment. Please contact
                      the practice before making another payment.
                    </p>
                  )}
                  {status.state === "partially_refunded" && (
                    <p className="text-sm">
                      Part of the confirmed payment has been refunded. The paid
                      and refunded amounts are shown separately above.
                    </p>
                  )}
                  {status.state === "refunded" && (
                    <p className="text-sm">
                      The full confirmed payment has been refunded.
                    </p>
                  )}
                  {access.kind === "collection" && (
                    <p className="text-sm text-muted-foreground">
                      Payment link deadline:{" "}
                      <time dateTime={status.expires_at}>
                        {new Date(status.expires_at).toLocaleString()}
                      </time>{" "}
                      (your local time).
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Status available until{" "}
                    <time dateTime={status.status_expires_at}>
                      {new Date(status.status_expires_at).toLocaleString()}
                    </time>{" "}
                    (your local time).
                  </p>
                  {access.kind === "collection" &&
                    status.collection_available === false &&
                    ![
                      "paid",
                      "partially_refunded",
                      "refunded",
                      "reconciliation",
                    ].includes(status.state) && (
                      <p className="text-sm">
                        This link can no longer start a payment. Confirmed
                        status remains available here; contact the practice if
                        you need a new payment link.
                      </p>
                    )}
                  {canActivate && (
                    <Button
                      disabled={busy}
                      onClick={() => void load("activate")}
                    >
                      Continue to secure payment
                    </Button>
                  )}
                  {status.state === "checkout_ready" && status.checkout_url && (
                    <>
                      <p className="text-sm">
                        Your secure Stripe payment page is ready. Opening
                        Checkout does not confirm payment.
                      </p>
                      <Button asChild>
                        <a
                          href={status.checkout_url}
                          rel="noreferrer"
                          referrerPolicy="no-referrer"
                        >
                          Open Stripe Checkout
                        </a>
                      </Button>
                    </>
                  )}
                  <Button variant="outline" disabled={busy} onClick={inspect}>
                    Refresh confirmed status
                  </Button>
                </>
              )}
              {access.returnKind === "cancel" && (
                <p className="text-sm text-muted-foreground">
                  Leaving Checkout does not cancel a payment that already
                  completed. Only the confirmed status above establishes what
                  was received.
                </p>
              )}
              {access.returnKind === "return" && (
                <p className="text-sm text-muted-foreground">
                  Returning from Checkout is not proof of payment. Check the
                  confirmed status here.
                </p>
              )}
              <Button variant="ghost" onClick={clear}>
                Close payment details
              </Button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
