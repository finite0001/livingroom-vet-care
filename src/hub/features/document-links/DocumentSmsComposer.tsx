import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { linkDb as db } from "./api";
import {
  parsePreparation,
  validateIntent,
  verifiedArtifact,
  type DocumentFamily,
  type LinkIntent,
  type LinkPreparation,
} from "./state";
interface Props {
  family: DocumentFamily;
  sourceId: string;
  clientId: string;
  canPrepare: boolean;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function DocumentSmsComposer(props: Props) {
  const { session } = useAuth();
  return session ? (
    <Composer
      key={`${session.user.id}:${props.family}:${props.sourceId}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
function Composer({
  family,
  sourceId,
  clientId,
  canPrepare,
  disabled,
  onDirtyChange,
  actor,
}: Props & { actor: string }) {
  const storageKey = `document-link-intent:${actor}:${family}:${sourceId}:${clientId}`;
  const [saved, setSaved] = useState<LinkPreparation | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [template, setTemplate] = useState(
      "Your documents from The Living Room Veterinary Care: {{document_link}}",
    ),
    [expiry, setExpiry] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [history, setHistory] = useState<
    Array<{
      id: string;
      created_at: string;
      expires_at: string;
      state: string;
      recipient: string;
      receipt_state: string | null;
    }>
  >([]);
  const [historyError, setHistoryError] = useState(false);
  const loadHistory = async () => {
    const result = await db.rpc("read_document_link_history", {
      p_family: family,
      p_source_id: sourceId,
    });
    if (!active.current) return;
    if (result.error || !Array.isArray(result.data)) {
      setHistoryError(true);
      return;
    }
    setHistory(result.data);
    setHistoryError(false);
  };
  const [checked, setChecked] = useState(false),
    [opened, setOpened] = useState<number[]>([]),
    [file, setFile] = useState<{
      url: string;
      name: string;
      mime: string;
    } | null>(null),
    [reason, setReason] = useState("");
  const pending = useRef<LinkIntent | null>(null),
    active = useRef(true),
    lock = useRef(false);
  const parse = (value: unknown) =>
    parsePreparation(value, family, sourceId, clientId, actor);
  const accept = (p: LinkPreparation) => {
    if (!active.current) return;
    setSaved(p);
    void loadHistory();
    setUncertain(false);
    setDraft(false);
    setChecked(false);
    setOpened([]);
    setFile(null);
    if (!pending.current && p.grant.state === "preparing")
      pending.current = {
        p_request_id: p.grant.id,
        p_family: p.grant.family,
        p_source_id: p.grant.source_id,
        p_client_id: p.grant.client_id,
        p_conversation_id: p.grant.conversation_id,
        p_recipient: p.grant.recipient,
        p_source_hash: p.grant.source_hash,
        p_expires_at: p.grant.expires_at,
        p_message_template: p.grant.message_template,
      };
    if (p.receipt || p.grant.state === "revoked") {
      pending.current = null;
      sessionStorage.removeItem(storageKey);
    }
  };
  const recover = async (requestId?: string) => {
    if (!pending.current) {
      const raw = sessionStorage.getItem(storageKey);
      if (raw)
        pending.current = validateIntent(
          JSON.parse(raw),
          family,
          sourceId,
          clientId,
        );
    }
    const args = {
      p_family: family,
      p_source_id: sourceId,
      ...(requestId || pending.current?.p_request_id || saved?.grant.id
        ? {
            p_request_id:
              requestId || pending.current?.p_request_id || saved?.grant.id,
          }
        : {}),
    };
    // Edge response contains capability material: local component memory only, never query cache.
    const response = await supabase.functions.invoke("recover-document-link", {
      body: args,
    });
    let result: LinkPreparation | null;
    if (response.error) {
      const fallback = await db.rpc("recover_document_link", args);
      if (fallback.error)
        throw new Error(
          "Saved link recovery failed. Retry before creating another request.",
        );
      result = parse(fallback.data);
    } else result = parse(response.data);
    if (result) accept(result);
    return result;
  };
  const initialized = useRef(false);
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
        const raw = sessionStorage.getItem(storageKey);
        if (raw)
          pending.current = validateIntent(
            JSON.parse(raw),
            family,
            sourceId,
            clientId,
          );
        const found = await recover();
        await loadHistory();
        if (active.current) {
          setReady(true);
          if (!found && pending.current) {
            setUncertain(true);
            setTemplate(pending.current.p_message_template);
            const date = new Date(pending.current.p_expires_at);
            setExpiry(
              new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16),
            );
          }
        }
      } catch {
        if (active.current)
          setError(
            "Saved link recovery failed. Retry recovery before preparing another link.",
          );
      } finally {
        lock.current = false;
        if (active.current) setBusy(false);
      }
    })();
    return () => {
      active.current = false;
    }; // identity-keyed mount performs initial recovery once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  const dirty =
    busy ||
    uncertain ||
    draft ||
    Boolean(saved && !saved.receipt && saved.grant.state !== "revoked");
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
    } catch {
      if (active.current)
        setError(
          "Action not confirmed. Recover this same request before retrying. Current consent, source, expiry or server configuration may prevent this action.",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const prepare = () =>
    run(async () => {
      if (!pending.current) {
        if (
          !expiry ||
          Date.parse(expiry) <= Date.now() ||
          Date.parse(expiry) > Date.now() + 7 * 86400000
        )
          throw new Error("Choose a future expiry within seven days.");
        const preview = await db.rpc("preview_document_link", {
          p_family: family,
          p_source_id: sourceId,
          p_client_id: clientId,
        });
        if (preview.error) throw preview.error;
        const conversation = await supabase.rpc("ensure_active_conversation", {
          p_client_id: clientId,
        });
        if (conversation.error) throw conversation.error;
        if (!conversation.data?.id)
          throw new Error("Conversation unavailable.");
        if (!active.current) return;
        pending.current = validateIntent(
          {
            p_request_id: crypto.randomUUID(),
            p_family: family,
            p_source_id: sourceId,
            p_client_id: clientId,
            p_conversation_id: conversation.data.id,
            p_recipient: preview.data.recipient,
            p_source_hash: preview.data.source_hash,
            p_expires_at: new Date(expiry).toISOString(),
            p_message_template: template,
          },
          family,
          sourceId,
          clientId,
        );
      }
      sessionStorage.setItem(storageKey, JSON.stringify(pending.current));
      setUncertain(true);
      const result = await supabase.functions.invoke("prepare-document-link", {
        body: pending.current,
      });
      if (!active.current) return;
      if (result.error) {
        const found = await recover();
        let rejected = false;
        try {
          const detail = await (result.error.context as Response)
            ?.clone()
            .json();
          rejected = ["23514", "23505", "42501"].includes(detail?.code);
        } catch {
          /* Keep uncertain transport intents for exact retry. */
        }
        if (!found && rejected) {
          pending.current = null;
          sessionStorage.removeItem(storageKey);
          setUncertain(false);
          setDraft(true);
        }
        throw new Error("Preparation unconfirmed.");
      }
      const p = parse(result.data);
      if (!p) throw new Error("Preparation unavailable.");
      accept(p);
    });
  const queue = () =>
    run(async () => {
      if (
        !saved?.artifact_hash ||
        !saved.message_hash ||
        !checked ||
        !saved.materialized_message ||
        opened.length !== saved.manifest?.length
      )
        throw new Error("Complete review first.");
      const exactHash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(saved.materialized_message),
          ),
        ),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (exactHash !== saved.message_hash) {
        setChecked(false);
        throw new Error("Reviewed message integrity failed.");
      }
      const args = {
        p_request_id: saved.grant.id,
        p_reviewed_artifact_hash: saved.artifact_hash,
        p_reviewed_message_hash: saved.message_hash,
        p_attest: true,
      };
      setUncertain(true);
      const attestation = await db.rpc("attest_document_link", args);
      if (attestation.error) {
        await recover();
        throw attestation.error;
      }
      const queued = await db.rpc("enqueue_document_link_sms", args);
      const found = await recover();
      if (queued.error && !found?.receipt) throw queued.error;
      if (!found?.receipt) throw new Error("Queue receipt unconfirmed.");
    });
  const openFile = (index: number) =>
    run(async () => {
      if (!saved?.manifest) return;
      const expected = saved.manifest[index];
      const result = await db.rpc("read_document_link_artifact", {
        p_request_id: saved.grant.id,
        p_index: index,
      });
      if (result.error) throw result.error;
      const blob = await verifiedArtifact(result.data, expected);
      if (!active.current) return;
      setFile({
        url: URL.createObjectURL(blob),
        name: expected.filename,
        mime: expected.mime_type,
      });
      setOpened((v) => (v.includes(index) ? v : [...v, index]));
      setChecked(false);
    });
  const clear = () => {
    pending.current = null;
    sessionStorage.removeItem(storageKey);
    setSaved(null);
    setUncertain(false);
    setDraft(false);
    setChecked(false);
    setOpened([]);
    setFile(null);
  };
  return (
    <section
      aria-label="Document text message"
      className="space-y-3 rounded-md border p-4"
    >
      <h4 className="font-semibold">Text documents securely</h4>
      <p className="text-sm text-muted-foreground">
        Review the saved documents and exact text before queueing. Anyone with
        the link can open it until it expires or is revoked. Revocation cannot
        erase downloaded copies.
      </p>
      {!canPrepare && (
        <p>
          New preparation is unavailable. Saved documents, receipts and
          revocation remain available.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!ready && <p role="status">Checking saved document link…</p>}
      <Button
        variant="outline"
        disabled={busy || (draft && !pending.current)}
        onClick={() =>
          void run(async () => {
            await recover();
            if (active.current) setReady(true);
          })
        }
      >
        Recover document text and receipt
      </Button>
      <details>
        <summary>Earlier document texts</summary>
        <p className="text-sm">
          The 50 most recent saved document texts are shown.
        </p>
        <label className="block">
          Saved document text
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={historyId}
            disabled={busy || dirty}
            onChange={(e) => setHistoryId(e.target.value)}
          >
            <option value="">Choose an earlier document text</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.created_at).toLocaleString("en-US", {
                  timeZone: "America/Denver",
                })}{" "}
                Mountain · {item.receipt_state ?? item.state} · {item.recipient}
              </option>
            ))}
          </select>
        </label>
        {historyError && (
          <p role="status">Earlier document texts could not be loaded.</p>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(loadHistory)}
        >
          Refresh document text history
        </Button>
        <Button
          variant="outline"
          disabled={
            busy || dirty || !history.some((item) => item.id === historyId)
          }
          onClick={() =>
            void run(async () => {
              const found = await recover(historyId);
              if (!found) throw new Error("Saved request not found.");
            })
          }
        >
          Review earlier document text
        </Button>
      </details>
      {!saved && (
        <>
          <fieldset
            disabled={busy || disabled || uncertain || !ready || !canPrepare}
            className="space-y-3"
          >
            <label
              className="block"
              htmlFor={`document-sms-message-${sourceId}`}
            >
              Document text message
              <Textarea
                id={`document-sms-message-${sourceId}`}
                value={template}
                maxLength={1200}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setDraft(true);
                }}
              />
            </label>
            <p className="text-xs">
              Keep exactly one {"{{document_link}}"} placeholder. The current
              household’s consented primary phone and active conversation are
              checked before capture.
            </p>
            <label className="block">
              Link expiry (your device’s local time)
              <Input
                type="datetime-local"
                value={expiry}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  setDraft(true);
                }}
              />
            </label>
          </fieldset>
          <Button
            disabled={
              busy ||
              disabled ||
              !ready ||
              !canPrepare ||
              (!pending.current && !expiry)
            }
            onClick={() => void prepare()}
          >
            {pending.current
              ? "Retry same document preparation"
              : "Prepare exact document text"}
          </Button>
          {draft && !pending.current && (
            <Button variant="outline" onClick={clear}>
              Discard document text draft
            </Button>
          )}
        </>
      )}
      {saved && (
        <>
          {saved.grant.state === "preparing" && (
            <Button
              disabled={busy || disabled || !canPrepare}
              onClick={() => void prepare()}
            >
              Retry same document preparation
            </Button>
          )}
          <p>Frozen recipient: {saved.grant.recipient}</p>
          <p>
            Expires:{" "}
            {new Date(saved.grant.expires_at).toLocaleString("en-US", {
              timeZone: "America/Denver",
            })}{" "}
            Mountain
          </p>
          <p className="whitespace-pre-wrap break-all">
            {saved.materialized_message ?? saved.grant.message_template}
          </p>
          {!saved.materialized_message && (
            <p role="status">
              The usable link could not be recovered. Historical files and
              revocation remain available; sending requires successful recovery.
            </p>
          )}
          {saved.receipt && (
            <p role="status">
              Saved queue receipt: {saved.receipt.outbox_id} ·{" "}
              {saved.receipt.state}.{" "}
              {saved.receipt.delivered
                ? "Provider reports delivered."
                : "Delivery is not confirmed. Check the outbox before any separate send."}
            </p>
          )}
          {saved.grant.state === "revoked" && (
            <p role="status">This link is revoked.</p>
          )}
          <ul className="space-y-2">
            {saved.manifest?.map((a) => (
              <li key={a.index}>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void openFile(a.index)}
                >
                  Review {a.filename}
                </Button>{" "}
                {opened.includes(a.index) ? "Opened for review" : ""}
              </li>
            ))}
          </ul>
          {file && (
            <>
              <p>{file.name}</p>
              {file.mime.startsWith("image/") ? (
                <img
                  src={file.url}
                  alt={`Frozen document ${file.name}`}
                  className="max-h-[32rem] max-w-full"
                />
              ) : (
                <iframe
                  title={`Frozen document ${file.name}`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  src={file.url}
                  className="h-[32rem] w-full border"
                />
              )}
              <a href={file.url} download={file.name} className="underline">
                Download exact file for review
              </a>
            </>
          )}
          {saved.artifact_hash &&
            !saved.receipt &&
            saved.grant.state !== "revoked" && (
              <>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      busy ||
                      !saved.materialized_message ||
                      opened.length !== saved.manifest?.length
                    }
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  <span>
                    I reviewed every frozen document, the exact message,
                    recipient and expiry, and understand the link can be
                    forwarded.
                  </span>
                </label>
                <Button
                  disabled={
                    busy ||
                    disabled ||
                    !canPrepare ||
                    !checked ||
                    !saved.materialized_message
                  }
                  onClick={() => void queue()}
                >
                  Queue reviewed document text
                </Button>
              </>
            )}
          {saved.grant.state !== "revoked" && (
            <>
              <label className="block">
                Revocation reason
                <Input
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(async () => {
                    setUncertain(true);
                    const r = await db.rpc("revoke_document_link", {
                      p_request_id: saved.grant.id,
                      p_reason: reason,
                    });
                    const found = await recover();
                    if (r.error && found?.grant.state !== "revoked")
                      throw r.error;
                  })
                }
              >
                Revoke document link
              </Button>
            </>
          )}
          {(saved.receipt || saved.grant.state === "revoked") && (
            <Button
              variant="outline"
              disabled={busy || !canPrepare}
              onClick={() => {
                clear();
                setDraft(true);
              }}
            >
              Compose a separate document text
            </Button>
          )}
        </>
      )}
    </section>
  );
}
