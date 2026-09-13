import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReleaseBundle } from "./print";
import {
  parseEmailPreparation,
  type EmailArgs,
  type EmailPreparation,
} from "./email-state";
interface DeliveryDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      recover_release_email: {
        Args: { p_release_id: string; p_request_id?: string };
        Returns: EmailPreparation | null;
      };
      prepare_release_email: {
        Args: { [K in keyof EmailArgs]: EmailArgs[K] };
        Returns: EmailPreparation;
      };
      enqueue_release_email: {
        Args: {
          p_request_id: string;
          p_reviewed_payload_hash: string;
          p_attest: boolean;
        };
        Returns: { id: string; state: string };
      };
      abandon_release_email: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      read_release_email_attachment: {
        Args: { p_request_id: string; p_index: number };
        Returns: { filename: string; content_type: string; content: string };
      };
    };
  };
}
const db = supabase as unknown as SupabaseClient<DeliveryDatabase>;
function argsFrom(p: EmailPreparation): EmailArgs {
  return {
    p_request_id: p.request.id,
    p_release_id: p.request.release_id,
    p_conversation_id: p.request.conversation_id,
    p_subject: p.request.subject,
    p_body: p.request.body,
    p_release_hash: p.request.release_hash,
  };
}
interface ReleaseEmailComposerProps {
  bundle: ReleaseBundle;
  onDirtyChange?: (dirty: boolean) => void;
}
export function ReleaseEmailComposer({
  bundle,
  onDirtyChange,
}: ReleaseEmailComposerProps) {
  const release = bundle.release;
  const [conversation, setConversation] = useState("");
  const [subject, setSubject] = useState(
    `Medical records for ${release.snapshot.patient.name}`,
  );
  const [body, setBody] = useState(
    "Attached are the reviewed medical records. Please contact the practice with any questions.",
  );
  const [prepared, setPrepared] = useState<EmailPreparation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attest, setAttest] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [composing, setComposing] = useState(false);
  const pending = useRef<EmailArgs | null>(null);
  const hydrated = useRef(false);
  const recovery = useQuery({
    queryKey: ["release-email-recovery", release.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("recover_release_email", {
        p_release_id: release.id,
      });
      if (error) throw error;
      return parseEmailPreparation(data, release.id);
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  useEffect(() => {
    if (!hydrated.current && recovery.isSuccess) {
      hydrated.current = true;
      if (recovery.data) {
        setPrepared(recovery.data);
        pending.current = argsFrom(recovery.data);
      }
    }
  }, [recovery.data, recovery.isSuccess]);
  const conversations = useQuery({
    queryKey: ["release-email-conversations", release.client_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id,status,created_at")
        .eq("client_id", release.client_id)
        .order("created_at", { ascending: false })
        .limit(101);
      if (error) throw error;
      return data || [];
    },
  });
  const dirty =
    busy ||
    uncertain ||
    !!(
      prepared &&
      !prepared.receipt &&
      prepared.request.state !== "abandoned"
    ) ||
    composing;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        (e as { message?: string })?.message ||
          "Request unconfirmed. Recover the saved email before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const recover = async () => {
    const { data, error } = await db.rpc("recover_release_email", {
      p_release_id: release.id,
      ...(pending.current
        ? { p_request_id: pending.current.p_request_id }
        : {}),
    });
    if (error) throw error;
    const recovered = parseEmailPreparation(data, release.id);
    if (recovered) {
      setPrepared(recovered);
      pending.current = argsFrom(recovered);
      setUncertain(false);
      setComposing(false);
    }
    return recovered;
  };
  const prepare = () =>
    run(async () => {
      if (
        !pending.current &&
        (!subject.trim() ||
          subject.length > 500 ||
          !body.trim() ||
          body.length > 100000 ||
          !conversation)
      )
        throw new Error(
          "Choose a household conversation and enter an email subject and message.",
        );
      const args = pending.current || {
        p_request_id: crypto.randomUUID(),
        p_release_id: release.id,
        p_conversation_id: conversation,
        p_subject: subject,
        p_body: body,
        p_release_hash: release.source_hash,
      };
      pending.current = args;
      setUncertain(true);
      setAttest(false);
      const { data, error } = await supabase.functions.invoke<EmailPreparation>(
        "prepare-release-email",
        { body: args },
      );
      if (error) {
        const found = await recover();
        let definitive = false;
        try {
          const detail = await (error.context as Response)?.clone().json();
          definitive = ["23514", "42501"].includes(detail?.code);
        } catch {
          /* Ambiguous transport: retain the exact request. */
        }
        if (!found && definitive) {
          pending.current = null;
          setUncertain(false);
          setComposing(true);
          throw new Error(
            "Preparation was rejected before saving. Review the message, conversation and current release, then try again.",
          );
        }
        throw new Error(
          "Preparation response was not confirmed. Recover or retry the same saved email.",
        );
      }
      const captured = parseEmailPreparation(data, release.id);
      if (!captured)
        throw new Error(
          "Preparation response was incomplete. Recover the saved email.",
        );
      setPrepared(captured);
      setUncertain(false);
      setComposing(false);
    });
  const queue = () =>
    run(async () => {
      if (!prepared?.payload_hash || !attest)
        throw new Error(
          "Review the exact report, originals, recipient and message first.",
        );
      setUncertain(true);
      const { error } = await db.rpc("enqueue_release_email", {
        p_request_id: prepared.request.id,
        p_reviewed_payload_hash: prepared.payload_hash,
        p_attest: true,
      });
      const recovered = await recover();
      if (error && !recovered?.receipt) throw error;
      if (!recovered?.receipt)
        throw new Error(
          "Queue receipt not confirmed. Recover the saved request; do not create another email.",
        );
    });
  const download = (index: number) =>
    run(async () => {
      if (!prepared) throw new Error("Prepare the attachments first.");
      const { data, error } = await db.rpc("read_release_email_attachment", {
        p_request_id: prepared.request.id,
        p_index: index,
      });
      if (error) throw error;
      if (!data) throw new Error("Frozen attachment unavailable.");
      const raw = atob(data.content),
        bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: data.content_type }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.rel = "noopener noreferrer";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const abandon = () =>
    run(async () => {
      if (!prepared) throw new Error("Recover the request before abandoning.");
      const { error } = await db.rpc("abandon_release_email", {
        p_request_id: prepared.request.id,
      });
      if (error) throw error;
      pending.current = null;
      setPrepared(null);
      setUncertain(false);
      setComposing(true);
      setAttest(false);
    });
  const locked =
    !!prepared || uncertain || busy || recovery.isLoading || recovery.isError;
  if (release.channel !== "EMAIL")
    return (
      <p className="text-sm">
        Email attachments require a release reviewed for the household email
        address. Use the secure document text review below for this SMS release.
      </p>
    );
  return (
    <section
      aria-label="Reviewed release email"
      className="space-y-3 rounded-md border p-4"
    >
      <h4 className="font-semibold">Email this reviewed release</h4>
      <p className="text-sm">
        Preparation creates a frozen HTML report and original-file attachments.
        Review the exact report and files before queueing. Queueing does not
        mean delivered.
      </p>
      {recovery.isLoading && (
        <p role="status">Checking for a saved email request…</p>
      )}
      {(error || recovery.isError) && (
        <p role="alert" className="text-destructive">
          {error ||
            "Saved-email recovery failed. Retry recovery before creating another request."}
        </p>
      )}
      {!bundle.eligible && (
        <p role="alert">
          This release is invalidated; create a newly reviewed release before
          sending.
        </p>
      )}
      {prepared?.receipt ? (
        <>
          <p role="status">
            Saved queue receipt: {prepared.receipt.outbox_id} ·{" "}
            {prepared.receipt.state}.{" "}
            {prepared.receipt.delivered
              ? "Provider reports delivered."
              : "Delivery is not confirmed."}
          </p>
          <Button
            variant="outline"
            disabled={busy || !bundle.eligible}
            onClick={() => {
              pending.current = null;
              setPrepared(null);
              setComposing(true);
              setAttest(false);
            }}
          >
            Compose a separate new email
          </Button>
        </>
      ) : null}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await recover();
            await recovery.refetch();
          })
        }
      >
        Recover saved email and receipt
      </Button>
      {!prepared?.receipt && (
        <>
          <fieldset disabled={locked} className="space-y-3">
            <div>
              <Label htmlFor={`release-email-conversation-${release.id}`}>
                Household conversation
              </Label>
              <select
                id={`release-email-conversation-${release.id}`}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={prepared?.request.conversation_id ?? conversation}
                onChange={(e) => {
                  setConversation(e.target.value);
                  setComposing(true);
                }}
              >
                <option value="">Choose conversation</option>
                {conversations.data?.slice(0, 100).map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.status} · {c.created_at.slice(0, 10)} · {c.id}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    const { data, error } = await supabase.rpc(
                      "ensure_active_conversation",
                      { p_client_id: release.client_id },
                    );
                    if (error) throw error;
                    if (!data) throw new Error("Conversation was not created.");
                    await conversations.refetch();
                    setConversation(data.id);
                    setComposing(true);
                  })
                }
              >
                Create or use active household conversation
              </Button>
              {conversations.isError && (
                <p role="alert">Conversations could not be loaded.</p>
              )}
              {conversations.data?.length === 101 && (
                <p>
                  Only the 100 most recent household conversations are shown.
                </p>
              )}
            </div>
            <p>Recipient: {release.recipient}</p>
            <div>
              <Label htmlFor={`release-email-subject-${release.id}`}>
                Email subject
              </Label>
              <Input
                id={`release-email-subject-${release.id}`}
                value={prepared?.request.subject ?? subject}
                maxLength={500}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setComposing(true);
                }}
              />
            </div>
            <div>
              <Label htmlFor={`release-email-body-${release.id}`}>
                Email message
              </Label>
              <Textarea
                id={`release-email-body-${release.id}`}
                value={prepared?.request.body ?? body}
                maxLength={100000}
                onChange={(e) => {
                  setBody(e.target.value);
                  setComposing(true);
                }}
              />
            </div>
          </fieldset>
          {!prepared?.payload_hash && (
            <Button
              disabled={
                busy ||
                recovery.isLoading ||
                recovery.isError ||
                !bundle.eligible ||
                (!pending.current && !conversation)
              }
              onClick={() => void prepare()}
            >
              {prepared || uncertain
                ? "Retry same attachment preparation"
                : "Prepare exact email attachments"}
            </Button>
          )}
          {prepared?.payload_hash && (
            <>
              <p>Frozen recipient: {prepared.request.recipient}</p>
              <details className="text-xs">
                <summary>Technical integrity details</summary>
                <p className="break-all">
                  Email payload SHA-256: {prepared.payload_hash}
                </p>
              </details>
              {prepared.report_html && (
                <iframe
                  title="Frozen email record report"
                  sandbox=""
                  srcDoc={prepared.report_html}
                  className="h-[32rem] w-full rounded-md border bg-background"
                />
              )}
              <ul className="space-y-2">
                {prepared.manifest?.map((a, i) => (
                  <li key={a.filename} className="rounded-md border p-2">
                    <p>
                      {a.filename} · {a.mime_type} · {a.file_size} bytes
                    </p>
                    <details className="text-xs">
                      <summary>File integrity details</summary>
                      <p className="break-all">SHA-256: {a.sha256}</p>
                    </details>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !!prepared.purged_at}
                      onClick={() => void download(i)}
                    >
                      Review frozen attachment: {a.filename}
                    </Button>
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={attest}
                  disabled={busy}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                <span>
                  I reviewed the exact frozen report, original attachments,
                  email message and household recipient.
                </span>
              </label>
              <Button
                disabled={busy || !attest || !bundle.eligible}
                onClick={() => void queue()}
              >
                {uncertain
                  ? "Recover or retry same email queue request"
                  : "Queue reviewed record email"}
              </Button>
            </>
          )}
          {prepared && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void abandon()}
            >
              Abandon this unqueued email
            </Button>
          )}
        </>
      )}
    </section>
  );
}
