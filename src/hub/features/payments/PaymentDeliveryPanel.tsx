import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { collectionDb } from "./PaymentCollectionApi";
import {
  parseCollection,
  type CollectionGrant,
} from "./PaymentCollectionState";
import { formatCents } from "./state";
import { invoiceEmailDb } from "../billing/invoice-email-api";
import { parseInvoiceEmail } from "../billing/invoice-email-state";
import { deliveryDb, paymentDeliveryAction } from "./PaymentDeliveryApi";
import {
  deliveryIntent,
  deliveryArgs,
  parsePaymentDelivery,
  sameDeliveryIntent,
  verifyDeliveryPreview,
  type DeliveryIntent,
  type PaymentDelivery,
  type DeliveryPreview,
} from "./PaymentDeliveryState";
interface Props {
  invoiceId: string;
  clientId: string;
  canPrepare: boolean;
  disabled?: boolean;
  attachmentRequestId: string | null;
  onDirtyChange: (dirty: boolean) => void;
}
const bodyDefault =
  "Please review your invoice and pay securely: {{payment_link}}";
const protectedHtml = (html: string) =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">${html}`;
export function PaymentDeliveryPanel(props: Props) {
  const { session, profile } = useAuth();
  return session && profile?.is_active ? (
    <DeliverySession
      key={`${session.user.id}:${props.invoiceId}:${props.clientId}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
function DeliverySession({
  invoiceId,
  clientId,
  canPrepare,
  disabled,
  attachmentRequestId,
  onDirtyChange,
  actor,
}: Props & { actor: string }) {
  const [grants, setGrants] = useState<CollectionGrant[]>([]),
    [history, setHistory] = useState<PaymentDelivery[]>([]),
    [hasMore, setHasMore] = useState(false),
    [grantId, setGrantId] = useState(""),
    [conversations, setConversations] = useState<
      Array<{ id: string; status: string }>
    >([]),
    [conversation, setConversation] = useState(""),
    [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL"),
    [subject, setSubject] = useState(
      "Your invoice from The Living Room Veterinary Care",
    ),
    [body, setBody] = useState(bodyDefault),
    [contact, setContact] = useState({ EMAIL: "", SMS: "" }),
    [attachment, setAttachment] = useState<{
      id: string;
      hash: string;
      recipient: string;
    } | null>(null),
    [saved, setSaved] = useState<PaymentDelivery | null>(null),
    [preview, setPreview] = useState<DeliveryPreview | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [hasPending, setHasPending] = useState(false),
    [ready, setReady] = useState(false),
    [absent, setAbsent] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(true),
    lock = useRef(false),
    initialized = useRef(false),
    pending = useRef<DeliveryIntent | null>(null),
    previewGeneration = useRef(0);
  const key = `invoice-payment-intent:${actor}:${invoiceId}:${clientId}:delivery`;
  const selectionKey = `${key}:current`;
  const currentSaved = useRef<PaymentDelivery | null>(null);
  const loadedHistory = useRef<PaymentDelivery[]>([]);
  const dirty =
    busy || draft || uncertain || hasPending || Boolean(preview) || checked;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const clearPreview = () => {
    previewGeneration.current++;
    setPreview(null);
    setChecked(false);
  };
  const parse = (v: unknown, id?: string) =>
    parsePaymentDelivery(v, actor, invoiceId, clientId, id);
  const accept = (v: unknown, id?: string) => {
    const row = parse(v, id);
    if (!active.current) return row;
    if (row && pending.current && !sameDeliveryIntent(row, pending.current))
      throw new Error("Original request differs");
    clearPreview();
    setUncertain(false);
    setAbsent(!row);
    if (row) {
      currentSaved.current = row;
      sessionStorage.setItem(selectionKey, row.request.id);
      setSaved(row);
      setDraft(false);
      setHistory((rows) => [
        row,
        ...rows.filter((x) => x.request.id !== row.request.id),
      ]);
      if (pending.current) {
        sessionStorage.removeItem(key);
        pending.current = null;
        setHasPending(false);
      }
    }
    return row;
  };
  const recover = async (id: string) => {
    const response = (await paymentDeliveryAction("recover", {
      p_request_id: id,
    })) as { delivery: unknown };
    return accept(response.delivery, id);
  };
  const load = async () => {
    const grantResult = await collectionDb.rpc("list_payment_collections", {
      p_invoice_id: invoiceId,
      p_client_id: clientId,
    });
    if (grantResult.error) throw grantResult.error;
    if (!Array.isArray(grantResult.data))
      throw new Error("Grant history unavailable");
    const rows = await Promise.all(
      grantResult.data.map((row) =>
        parseCollection(row, actor, invoiceId, clientId),
      ),
    );
    const deliveries = await deliveryDb.rpc("list_payment_deliveries", {
      p_invoice_id: invoiceId,
    });
    if (deliveries.error) throw deliveries.error;
    const data = deliveries.data as {
      invoice_id: string;
      client_id: string;
      deliveries: unknown[];
      has_more: boolean;
    };
    if (
      data?.invoice_id !== invoiceId ||
      data.client_id !== clientId ||
      !Array.isArray(data.deliveries) ||
      typeof data.has_more !== "boolean"
    )
      throw new Error("Delivery history unavailable");
    const histories = data.deliveries.map((row) => parse(row));
    if (histories.some((row) => !row))
      throw new Error("Invalid delivery history");
    const client = await supabase
      .from("clients")
      .select("primary_email,primary_phone")
      .eq("id", clientId)
      .single();
    if (client.error) throw client.error;
    const conv = await supabase
      .from("conversations")
      .select("id,status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (conv.error) throw conv.error;
    if (active.current) {
      setGrants(rows.filter(Boolean) as CollectionGrant[]);
      loadedHistory.current = histories as PaymentDelivery[];
      setHistory(histories as PaymentDelivery[]);
      setHasMore(data.has_more);
      setContact({
        EMAIL: (client.data.primary_email ?? "").trim().toLowerCase(),
        SMS: /^\+[0-9 ().-]+$/.test((client.data.primary_phone ?? "").trim())
          ? (client.data.primary_phone ?? "").trim().replace(/[ ().-]/g, "")
          : "",
      });
      setConversations(conv.data);
      setReady(true);
    }
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
          "Payment message unavailable or unconfirmed. Recover the same request. Current consent, primary contact, invoice and payment access must still be eligible.",
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
        const raw = sessionStorage.getItem(key);
        if (raw) {
          pending.current = deliveryIntent(JSON.parse(raw));
          setHasPending(true);
          setUncertain(true);
          await recover(pending.current.p_request_id);
        } else {
          const selectedId = sessionStorage.getItem(selectionKey);
          if (selectedId) await recover(selectedId);
        }
        await load();
      });
    }
    const generationRef = previewGeneration;
    const retire = () => {
      generationRef.current++;
      setPreview(null);
      setChecked(false);
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next?.user.id !== actor) {
        active.current = false;
        retire();
      }
    });
    window.addEventListener("pagehide", retire);
    return () => {
      active.current = false;
      generationRef.current++;
      subscription.unsubscribe();
      window.removeEventListener("pagehide", retire);
    };
    // Keyed actor/invoice session; never restore transient preview content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!attachmentRequestId || !ready) return;
    if (currentSaved.current) return;
    const previous = loadedHistory.current.find(
      (row) => row.request.invoice_email_request_id === attachmentRequestId,
    );
    if (previous) {
      currentSaved.current = previous;
      setSaved(previous);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { data, error } = await invoiceEmailDb.rpc(
          "recover_invoice_email",
          { p_invoice_id: invoiceId, p_request_id: attachmentRequestId },
        );
        if (error) throw error;
        const row = parseInvoiceEmail(data, invoiceId, clientId, actor);
        if (
          !row ||
          row.request.state !== "ready" ||
          !row.payload_hash ||
          row.receipt ||
          row.request.body.split("{{payment_link}}").length !== 2
        )
          throw new Error("Reviewed attachment unavailable");
        if (
          alive &&
          active.current &&
          !pending.current &&
          !currentSaved.current
        ) {
          setChannel("EMAIL");
          setSubject(row.request.subject);
          setBody(row.request.body);
          setConversation(row.request.conversation_id);
          setAttachment({
            id: row.request.id,
            hash: row.payload_hash,
            recipient: row.request.recipient,
          });
          setDraft(true);
        }
      } catch {
        if (alive && active.current)
          setError(
            "The handed-off invoice attachment is unavailable. Resume its invoice email to review the original request.",
          );
      }
    })();
    return () => {
      alive = false;
    };
    // Explicit handoff owns initialization; an existing delivery is never overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentRequestId, ready]);
  const prepare = () =>
    void run(async () => {
      let intent = pending.current;
      if (!intent) {
        if (attachmentRequestId && !attachment)
          throw new Error(
            "Wait for the handed-off attachment or resume its invoice email",
          );
        if (
          !canPrepare ||
          !ready ||
          !grants.some(
            (g) =>
              g.id === grantId &&
              g.state === "reviewed" &&
              Date.parse(g.expires_at) > Date.now(),
          )
        )
          throw new Error("Reviewed grant required");
        intent = deliveryIntent({
          p_request_id: crypto.randomUUID(),
          p_grant_id: grantId,
          p_conversation_id: conversation,
          p_channel: channel,
          p_recipient: attachment?.recipient ?? contact[channel],
          p_subject: channel === "SMS" ? "" : subject,
          p_body_template: body,
          p_invoice_email_request_id: attachment?.id ?? null,
          p_invoice_payload_hash: attachment?.hash ?? null,
        });
        sessionStorage.setItem(key, JSON.stringify(intent));
        pending.current = intent;
        setHasPending(true);
      }
      if (!ready || !grants.some((grant) => grant.id === intent.p_grant_id))
        throw new Error("Saved grant does not belong to this invoice");
      clearPreview();
      setUncertain(true);
      setAbsent(false);
      try {
        const response = (await paymentDeliveryAction("prepare", intent)) as {
          delivery: unknown;
        };
        accept(response.delivery, intent.p_request_id);
      } catch {
        await recover(intent.p_request_id);
      }
    });
  const recovery = () =>
    void run(async () => {
      clearPreview();
      const id = pending.current?.p_request_id ?? saved?.request.id;
      if (id) await recover(id);
      await load();
    });
  const showReview = () =>
    void run(async () => {
      if (!saved) return;
      clearPreview();
      const id = saved.request.id;
      const found = await recover(id);
      if (!found || found.receipt) return;
      const generation = previewGeneration.current;
      const response = (await paymentDeliveryAction("review", {
        p_request_id: id,
      })) as { delivery: unknown; preview: unknown };
      const row = parse(response.delivery, id);
      if (!row) throw new Error("Review unavailable");
      if (row.receipt) {
        accept(response.delivery, id);
        return;
      }
      if (
        !sameDeliveryIntent(row, deliveryArgs(found)) ||
        !found.capture ||
        row.capture?.message_hash !== found.capture.message_hash ||
        row.capture?.payload_hash !== found.capture.payload_hash
      )
        throw new Error("Review differs");
      const verified = await verifyDeliveryPreview(response.preview, row);
      if (active.current && generation === previewGeneration.current) {
        setSaved(row);
        setPreview(verified);
        setChecked(false);
      }
    });
  const queue = () =>
    void run(async () => {
      if (
        !saved ||
        !preview ||
        !checked ||
        preview.requestId !== saved.request.id
      )
        throw new Error("Exact review required");
      const id = saved.request.id,
        messageHash = preview.messageHash,
        payloadHash = preview.payloadHash;
      clearPreview();
      setUncertain(true);
      const { error } = await deliveryDb.rpc("enqueue_payment_delivery", {
        p_request_id: id,
        p_reviewed_message_hash: messageHash,
        p_reviewed_payload_hash: payloadHash,
        p_attest: true,
      });
      const recovered = await recover(id);
      if (!recovered?.receipt) {
        setUncertain(true);
        if (error) throw error;
        throw new Error("Queue unconfirmed");
      }
    });
  const blocked = busy || Boolean(disabled),
    frozen = Boolean(saved || hasPending),
    chosen = grants.find((g) => g.id === grantId);
  return (
    <section
      aria-label="Payment message delivery"
      className="space-y-3 rounded-md border p-4"
    >
      <h4 className="font-semibold">Payment message delivery</h4>
      <p className="text-sm text-muted-foreground">
        Review an email or text with the exact payment link before queueing.
        Queueing does not confirm delivery or payment. Current primary contact
        and consent are rechecked by the server.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {uncertain && (
        <p role="status">
          The response is uncertain. Recover this same payment message before
          continuing.
        </p>
      )}
      <Button variant="outline" disabled={blocked} onClick={recovery}>
        Recover payment message and refresh history
      </Button>
      <label className="block text-sm">
        Payment message history
        <select
          aria-label="Payment message history"
          className="mt-1 w-full rounded-md border bg-background p-2"
          value={saved?.request.id ?? ""}
          disabled={blocked || dirty}
          onChange={(e) => {
            const id = e.target.value;
            if (id)
              void run(async () => {
                await recover(id);
              });
          }}
        >
          <option value="">Choose saved payment message</option>
          {history.map((row) => (
            <option key={row.request.id} value={row.request.id}>
              {row.request.channel} · {row.receipt?.state ?? "not queued"} ·{" "}
              {new Date(row.request.created_at).toLocaleString("en-US", {
                timeZone: "America/Denver",
              }) + " Mountain"}
            </option>
          ))}
        </select>
      </label>
      {hasMore && (
        <p>
          Showing the latest 100 messages. An outstanding saved request is still
          recovered directly.
        </p>
      )}
      {!saved && (
        <fieldset
          disabled={blocked || frozen || !canPrepare}
          className="space-y-3"
        >
          <label className="block text-sm">
            Reviewed payment access
            <select
              aria-label="Reviewed payment access"
              className="mt-1 w-full rounded-md border bg-background p-2"
              value={grantId}
              onChange={(e) => {
                setGrantId(e.target.value);
                setDraft(true);
              }}
            >
              <option value="">Choose reviewed access</option>
              {grants
                .filter((g) => g.state === "reviewed")
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {formatCents(g.amount_cents)} · expires{" "}
                    {new Date(g.expires_at).toLocaleString("en-US", {
                      timeZone: "America/Denver",
                    }) + " Mountain"}
                  </option>
                ))}
            </select>
          </label>
          {chosen && (
            <p>
              Authorized amount: {formatCents(chosen.amount_cents)}. Anyone
              receiving a forwarded link may use it.
            </p>
          )}
          <label className="block text-sm">
            Delivery channel
            <select
              aria-label="Delivery channel"
              className="ml-2 rounded-md border bg-background p-2"
              value={channel}
              disabled={Boolean(attachment)}
              onChange={(e) => {
                setChannel(e.target.value as "EMAIL" | "SMS");
                setDraft(true);
              }}
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">Text message</option>
            </select>
          </label>
          <p>
            Primary recipient:{" "}
            {(attachment?.recipient ?? contact[channel]) || "Unavailable"}
          </p>
          <label className="block text-sm">
            Payment conversation
            <select
              aria-label="Payment conversation"
              className="mt-1 w-full rounded-md border bg-background p-2"
              value={conversation}
              disabled={Boolean(attachment)}
              onChange={(e) => {
                setConversation(e.target.value);
                setDraft(true);
              }}
            >
              <option value="">Choose household conversation</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.status} · {c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {channel === "EMAIL" && (
            <label className="block text-sm">
              Payment email subject
              <Input
                value={subject}
                maxLength={500}
                disabled={Boolean(attachment)}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setDraft(true);
                }}
              />
            </label>
          )}
          <label className="block text-sm">
            Payment message template
            <Textarea
              value={body}
              maxLength={channel === "SMS" ? 1600 : 100000}
              disabled={Boolean(attachment)}
              onChange={(e) => {
                setBody(e.target.value);
                setDraft(true);
              }}
            />
          </label>
          <p className="text-sm">
            Include exactly one {"{{payment_link}}"} placeholder; the final link
            appears only during review.
          </p>
          {attachment && (
            <p>
              Includes the handed-off frozen invoice attachment; its subject,
              template, recipient and conversation are unchanged.
            </p>
          )}
        </fieldset>
      )}
      {!saved && (
        <Button
          disabled={
            blocked ||
            uncertain ||
            (!hasPending &&
              (!ready ||
                !canPrepare ||
                !grantId ||
                !conversation ||
                Boolean(attachmentRequestId && !attachment)))
          }
          onClick={prepare}
        >
          {hasPending
            ? "Retry same payment message preparation"
            : "Prepare exact payment message"}
        </Button>
      )}
      {saved && (
        <div className="space-y-3">
          <p>
            Saved {saved.request.channel} recipient: {saved.request.recipient}
          </p>
          {saved.receipt ? (
            <p role="status">
              Saved payment message receipt: {saved.receipt.state}.{" "}
              {saved.receipt.delivered
                ? "Provider reports delivered."
                : "Delivery is not confirmed."}{" "}
              Payment is tracked separately in the ledger.
            </p>
          ) : (
            <>
              <Button disabled={blocked || uncertain} onClick={showReview}>
                Open exact payment message review
              </Button>
              {!saved.capture && (
                <Button
                  disabled={blocked || uncertain}
                  onClick={() => {
                    pending.current = deliveryArgs(saved);
                    setHasPending(true);
                    prepare();
                  }}
                >
                  Retry capture for this same payment message
                </Button>
              )}
            </>
          )}
          {preview && (
            <div className="space-y-3 rounded-md border p-3">
              <p>
                From: {preview.sender}
                {preview.replyTo && ` · Reply to: ${preview.replyTo}`}
              </p>
              <p>To: {preview.recipient}</p>
              {preview.subject && <p>Subject: {preview.subject}</p>}
              <pre className="whitespace-pre-wrap break-all text-sm">
                {preview.message}
              </pre>
              {preview.attachment && (
                <>
                  <p>
                    {preview.attachment.filename} · {preview.attachment.size}{" "}
                    bytes
                  </p>
                  <iframe
                    title="Exact payment invoice attachment"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    tabIndex={-1}
                    srcDoc={protectedHtml(preview.attachment.html)}
                    className="pointer-events-none h-[28rem] w-full rounded-md border bg-background"
                  />
                </>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={blocked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I reviewed the exact message, recipient, sender and any attached
                invoice.
              </label>
              <Button disabled={blocked || !checked} onClick={queue}>
                Queue reviewed payment message
              </Button>
              <Button
                variant="outline"
                disabled={blocked}
                onClick={clearPreview}
              >
                Close private message preview
              </Button>
            </div>
          )}
        </div>
      )}
      {hasPending && absent && !uncertain && (
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() =>
            void run(async () => {
              if (
                !pending.current ||
                (await recover(pending.current.p_request_id))
              )
                return;
              sessionStorage.removeItem(key);
              pending.current = null;
              setHasPending(false);
              setDraft(false);
              setAbsent(false);
            })
          }
        >
          Discard uncreated message intent
        </Button>
      )}
      {!hasPending && !uncertain && (saved || draft) && (
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() => {
            clearPreview();
            setSaved(null);
            currentSaved.current = null;
            sessionStorage.removeItem(selectionKey);
            setDraft(false);
            setAttachment(null);
            setGrantId("");
            setBody(bodyDefault);
            setSubject("Your invoice from The Living Room Veterinary Care");
            setConversation("");
          }}
        >
          Close message and retain history
        </Button>
      )}
    </section>
  );
}
