import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { captureInvoiceEmail, invoiceEmailDb as db } from "./invoice-email-api";
import {
  invoiceEmailArgs,
  parseInvoiceEmail,
  type InvoiceEmailArgs,
  type InvoiceEmailPreparation,
} from "./invoice-email-state";
interface InvoiceEmailComposerProps {
  invoiceId: string;
  clientId: string;
  disabled?: boolean;
  canPrepare: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
const defaultBody =
  "Attached is your invoice from The Living Room Veterinary Care. Please contact the practice with any questions.";
const messageOf = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String(e.message)
    : "Request unconfirmed. Recover the saved invoice email before continuing.";
export function InvoiceEmailComposer(props: InvoiceEmailComposerProps) {
  const { session } = useAuth();
  return session ? (
    <InvoiceEmailSession
      key={`${session.user.id}:${props.invoiceId}:${props.clientId}`}
      {...props}
      actorId={session.user.id}
    />
  ) : null;
}
function InvoiceEmailSession({
  invoiceId,
  clientId,
  actorId,
  disabled,
  canPrepare,
  onDirtyChange,
}: InvoiceEmailComposerProps & { actorId: string }) {
  const storageKey = `invoice-email-intent:${actorId}:${invoiceId}:${clientId}`;
  const [subject, setSubject] = useState(
    "Your invoice from The Living Room Veterinary Care",
  );
  const [body, setBody] = useState(defaultBody);
  const [conversation, setConversation] = useState("");
  const [prepared, setPrepared] = useState<InvoiceEmailPreparation | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [attest, setAttest] = useState(false);
  const pending = useRef<InvoiceEmailArgs | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const hydrated = useRef(false);
  const [recoveredOnce, setRecoveredOnce] = useState(false);
  const parse = (value: unknown) =>
    parseInvoiceEmail(value, invoiceId, clientId, actorId);
  const accept = (value: InvoiceEmailPreparation) => {
    if (!active.current) return;
    setPrepared(value);
    setAttest(false);
    setUncertain(false);
    setComposing(false);
    pending.current =
      value.request.state === "abandoned" ? null : invoiceEmailArgs(value);
    // Captured requests are server-durable; never recreate local text after an auth transition.
    if (value.receipt || value.request.state === "abandoned") {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage may have been disabled. */
      }
    }
  };
  const recovery = useQuery({
    queryKey: ["invoice-email-recovery", actorId, clientId, invoiceId],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const raw = sessionStorage.getItem(storageKey);
      if (!pending.current && raw) {
        const args = JSON.parse(raw) as InvoiceEmailArgs;
        if (
          !args ||
          Object.values(args).some((v) => typeof v !== "string") ||
          args.p_invoice_id !== invoiceId ||
          args.p_client_id !== clientId ||
          !args.p_request_id ||
          !args.p_conversation_id ||
          !args.p_recipient ||
          !args.p_subject ||
          !args.p_body ||
          !/^[a-f0-9]{64}$/.test(args.p_invoice_hash)
        )
          throw new Error(
            "Saved request cannot be read. Keep this tab open and reconcile invoice email history before proceeding.",
          );
        pending.current = args;
      }
      const { data, error } = await db.rpc("recover_invoice_email", {
        p_invoice_id: invoiceId,
        ...(pending.current
          ? { p_request_id: pending.current.p_request_id }
          : {}),
      });
      if (error) throw error;
      return parse(data);
    },
  });
  useEffect(() => {
    if (
      hydrated.current ||
      !recovery.isSuccess ||
      !recovery.isFetchedAfterMount
    )
      return;
    hydrated.current = true;
    setRecoveredOnce(true);
    if (recovery.data) accept(recovery.data);
    else if (pending.current) {
      setUncertain(true);
      setSubject(pending.current.p_subject);
      setBody(pending.current.p_body);
      setConversation(pending.current.p_conversation_id);
    }
    // Initial recovery alone hydrates the form; later cached receipts never replace a fresh intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovery.isSuccess, recovery.isFetchedAfterMount, recovery.data]);
  const preview = useQuery({
    queryKey: ["invoice-email-preview", actorId, clientId, invoiceId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.rpc("read_invoice_email_preview", {
        p_invoice_id: invoiceId,
        p_client_id: clientId,
      });
      if (error) throw error;
      if (
        !data ||
        data.client_id !== clientId ||
        !/^[a-f0-9]{64}$/.test(data.source_hash) ||
        !data.recipient
      )
        throw new Error("Current invoice recipient could not be verified.");
      return data;
    },
  });
  const conversations = useQuery({
    queryKey: ["invoice-email-conversations", actorId, clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id,status,created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(101);
      if (error) throw error;
      return data;
    },
  });
  const dirty =
    busy ||
    uncertain ||
    composing ||
    Boolean(
      pending.current &&
      !prepared?.receipt &&
      prepared?.request.state !== "abandoned",
    );
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const recover = async () => {
    const { data, error } = await db.rpc("recover_invoice_email", {
      p_invoice_id: invoiceId,
      ...(pending.current
        ? { p_request_id: pending.current.p_request_id }
        : {}),
    });
    if (error) throw error;
    const result = parse(data);
    if (result) accept(result);
    return result;
  };
  const prepare = () =>
    run(async () => {
      const isNewIntent = !pending.current;
      if (!pending.current) {
        if (
          !subject.trim() ||
          subject.length > 500 ||
          !body.trim() ||
          body.length > 100000 ||
          !conversation
        )
          throw new Error(
            "Choose a household conversation and enter a subject and message.",
          );
        const current = await preview.refetch();
        if (!active.current) return;
        if (current.error) throw current.error;
        if (!current.data)
          throw new Error("Current invoice preview unavailable.");
        pending.current = {
          p_request_id: crypto.randomUUID(),
          p_invoice_id: invoiceId,
          p_client_id: clientId,
          p_conversation_id: conversation,
          p_recipient: current.data.recipient,
          p_subject: subject,
          p_body: body,
          p_invoice_hash: current.data.source_hash,
        };
      }
      // Retain the exact intent before the network request, including across a tab reload.
      if (!active.current) return;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(pending.current));
      } catch {
        if (isNewIntent) {
          pending.current = null;
          setComposing(true);
        }
        throw new Error(
          "Browser session storage is unavailable. No new preparation request was sent. Restore storage and retry.",
        );
      }
      setUncertain(true);
      setAttest(false);
      const { data, error } = await captureInvoiceEmail(pending.current);
      if (!active.current) return;
      if (error) {
        const found = await recover();
        let definitive = false;
        try {
          const detail = await (error.context as Response)?.clone().json();
          definitive = ["23514", "23505", "42501"].includes(detail?.code);
        } catch {
          /* Transport failures retain the immutable intent. */
        }
        if (!found && definitive) {
          pending.current = null;
          sessionStorage.removeItem(storageKey);
          setUncertain(false);
          setComposing(true);
          throw new Error(
            "Preparation was rejected before saving. Review the current invoice, recipient and message, then retry.",
          );
        }
        throw new Error(
          "Preparation response was not confirmed. Recover or retry this same invoice email.",
        );
      }
      const result = parse(data);
      if (!result)
        throw new Error(
          "Preparation was not confirmed. Recover the saved request.",
        );
      accept(result);
    });
  const queue = () =>
    run(async () => {
      if (!prepared?.payload_hash || !attest)
        throw new Error(
          "Review the frozen invoice, recipient and message first.",
        );
      const current = await preview.refetch();
      if (!active.current) return;
      if (current.error) throw current.error;
      if (
        current.data?.source_hash !== prepared.request.invoice_hash ||
        current.data.recipient !== prepared.request.recipient
      ) {
        setAttest(false);
        throw new Error(
          "Invoice, credits or household details changed. Abandon this unqueued email and prepare a current copy.",
        );
      }
      setUncertain(true);
      const { error } = await db.rpc("enqueue_invoice_email", {
        p_request_id: prepared.request.id,
        p_reviewed_payload_hash: prepared.payload_hash,
        p_attest: true,
      });
      const result = await recover();
      if (error && !result?.receipt) throw error;
      if (!result?.receipt)
        throw new Error(
          "Queue receipt not confirmed. Recover or retry the same request; do not create another email.",
        );
    });
  const clear = () => {
    pending.current = null;
    setPrepared(null);
    setUncertain(false);
    setComposing(false);
    setAttest(false);
    sessionStorage.removeItem(storageKey);
  };
  const abandon = () =>
    run(async () => {
      if (!prepared)
        throw new Error("Recover this request before abandoning it.");
      setUncertain(true);
      const { error } = await db.rpc("abandon_invoice_email", {
        p_request_id: prepared.request.id,
      });
      if (error) {
        const found = await recover();
        if (found?.request.state !== "abandoned") throw error;
      }
      clear();
      await preview.refetch();
    });
  const frozen =
    prepared && prepared.request.state !== "abandoned" ? prepared : null;
  const stale = Boolean(
    frozen &&
    preview.data &&
    (frozen.request.invoice_hash !== preview.data.source_hash ||
      frozen.request.recipient !== preview.data.recipient),
  );
  const locked = Boolean(
    disabled ||
    busy ||
    uncertain ||
    frozen ||
    !recoveredOnce ||
    recovery.isError,
  );
  const selectedConversation = frozen?.request.conversation_id ?? conversation;
  return (
    <section
      aria-label="Invoice email"
      className="space-y-3 rounded-md border p-4"
    >
      <h4 className="font-semibold">Invoice email and delivery history</h4>
      {!canPrepare && (
        <p role="status">
          This invoice is not issued. New email preparation is unavailable;
          saved requests and receipts remain available for review.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Prepare and review an exact HTML invoice attachment before queueing.
        Queueing does not mean delivered. Payment collection is not connected.
      </p>
      {recovery.isFetching && !hydrated.current && (
        <p role="status">Checking for a saved invoice email…</p>
      )}
      {(error || recovery.isError) && (
        <p role="alert" className="text-destructive">
          {error ||
            "Saved email recovery failed. Retry recovery before creating another request."}
        </p>
      )}
      {preview.isError && (
        <p role="alert">
          Current invoice or household recipient is unavailable.{" "}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void preview.refetch()}
          >
            Retry current invoice recipient
          </Button>
        </p>
      )}
      {stale && (
        <p role="alert">
          The invoice, credits or household details changed. Review the retained
          copy, then abandon it and prepare a current email.
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy || (composing && !pending.current)}
        onClick={() =>
          void run(async () => {
            if (composing && !pending.current)
              throw new Error(
                "Discard the unsent draft before recovering an older email.",
              );
            if (!hydrated.current) {
              await recovery.refetch();
            } else await recover();
            await preview.refetch();
          })
        }
      >
        Recover saved invoice email and receipt
      </Button>
      {frozen?.receipt ? (
        <>
          <p role="status">
            Saved queue receipt: {frozen.receipt.outbox_id} ·{" "}
            {frozen.receipt.state}.{" "}
            {frozen.receipt.delivered
              ? "Provider reports delivered."
              : "Delivery is not confirmed."}
          </p>
          {frozen.report_html && (
            <iframe
              title="Previously queued invoice attachment"
              sandbox=""
              srcDoc={frozen.report_html}
              className="h-[24rem] w-full rounded-md border bg-background"
            />
          )}
          <Button
            variant="outline"
            disabled={busy || preview.isError || !canPrepare}
            onClick={() => {
              clear();
              setComposing(true);
            }}
          >
            Compose a separate new invoice email
          </Button>
        </>
      ) : (
        <>
          <fieldset disabled={locked} className="space-y-3">
            <p>
              Household recipient:{" "}
              {frozen?.request.recipient ??
                preview.data?.recipient ??
                "Checking current recipient…"}
            </p>
            <div>
              <Label htmlFor={`invoice-email-conversation-${invoiceId}`}>
                Invoice email conversation
              </Label>
              <select
                id={`invoice-email-conversation-${invoiceId}`}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedConversation}
                onChange={(e) => {
                  setConversation(e.target.value);
                  setComposing(true);
                }}
              >
                <option value="">Choose household conversation</option>
                {selectedConversation &&
                  !conversations.data?.some(
                    (c) => c.id === selectedConversation,
                  ) && (
                    <option value={selectedConversation}>
                      Saved household conversation
                    </option>
                  )}
                {conversations.data?.slice(0, 100).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.status} ·{" "}
                    {new Date(c.created_at).toLocaleDateString("en-US", {
                      timeZone: "America/Denver",
                    })}{" "}
                    · {c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void run(async () => {
                  const { data, error } = await supabase.rpc(
                    "ensure_active_conversation",
                    { p_client_id: clientId },
                  );
                  if (error) throw error;
                  if (!data)
                    throw new Error(
                      "Conversation not confirmed. Retry to use the same active household conversation.",
                    );
                  setConversation(data.id);
                  setComposing(true);
                  await conversations.refetch();
                })
              }
            >
              Create or use active invoice conversation
            </Button>
            <div>
              <Label htmlFor={`invoice-email-subject-${invoiceId}`}>
                Invoice email subject
              </Label>
              <Input
                id={`invoice-email-subject-${invoiceId}`}
                maxLength={500}
                value={frozen?.request.subject ?? subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setComposing(true);
                }}
              />
            </div>
            <div>
              <Label htmlFor={`invoice-email-body-${invoiceId}`}>
                Invoice email message
              </Label>
              <Textarea
                id={`invoice-email-body-${invoiceId}`}
                maxLength={100000}
                value={frozen?.request.body ?? body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setComposing(true);
                }}
              />
            </div>
          </fieldset>
          {conversations.isError && (
            <p role="alert">
              Household conversations unavailable.{" "}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void conversations.refetch()}
              >
                Retry invoice conversations
              </Button>
            </p>
          )}
          {conversations.data?.length === 101 && (
            <p className="text-xs">
              The 100 most recent household conversations are shown.
            </p>
          )}
          {!frozen?.payload_hash && (
            <Button
              disabled={
                busy ||
                !canPrepare ||
                disabled ||
                !recoveredOnce ||
                recovery.isError ||
                preview.isError ||
                (!pending.current && !conversation)
              }
              onClick={() => void prepare()}
            >
              {pending.current
                ? "Retry same invoice email preparation"
                : "Prepare exact invoice email"}
            </Button>
          )}
          {frozen?.payload_hash && (
            <>
              <p>Frozen recipient: {frozen.request.recipient}</p>
              <iframe
                title="Frozen invoice email attachment"
                sandbox=""
                srcDoc={frozen.report_html ?? ""}
                className="h-[32rem] w-full rounded-md border bg-background"
              />
              <ul>
                {frozen.manifest?.map((file) => (
                  <li key={file.filename}>
                    {file.filename} · {file.mime_type} · {file.file_size} bytes
                  </li>
                ))}
              </ul>
              <details className="text-xs">
                <summary>Technical integrity details</summary>
                <p className="break-all">
                  Payload SHA-256: {frozen.payload_hash}
                </p>
              </details>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={attest}
                  disabled={busy || stale}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                <span>
                  I reviewed the exact frozen invoice attachment, email message
                  and household recipient.
                </span>
              </label>
              <Button
                disabled={
                  busy ||
                  !canPrepare ||
                  disabled ||
                  !attest ||
                  stale ||
                  preview.isError ||
                  Boolean(frozen.purged_at)
                }
                onClick={() => void queue()}
              >
                {uncertain
                  ? "Recover or retry same invoice email queue"
                  : "Queue reviewed invoice email"}
              </Button>
            </>
          )}
          {frozen && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void abandon()}
            >
              Abandon this unqueued invoice email
            </Button>
          )}
          {!pending.current && !frozen && composing && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSubject("Your invoice from The Living Room Veterinary Care");
                setBody(defaultBody);
                setConversation("");
                clear();
              }}
            >
              Discard invoice email draft
            </Button>
          )}
        </>
      )}
    </section>
  );
}
