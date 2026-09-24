import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageRecoveryPanel } from "@/hub/components/conversations/MessageRecoveryPanel";
import { useMessageQueue } from "@/hub/hooks/use-message-queue";
import type { MessageIntent } from "@/hub/features/communications/queue-intent";
import type { Tables } from "@/integrations/supabase/types";
import { z } from "zod";
function errorMessage(error: unknown, fallback: string) {
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : fallback;
}
const detailSchema = z.object({
  submission: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    subject: z.string(),
    message: z.string(),
    created_at: z.string(),
  }),
  triage: z.object({
    version: z.number(),
    status: z.string(),
    assigned_to_id: z.string().nullable(),
    client_id: z.string().nullable(),
    reply_channel: z.enum(["EMAIL", "SMS"]).nullable(),
    reply_recipient: z.string().nullable(),
  }),
  household_name: z.string().nullable(),
});
const handoffSchema = z.object({
  conversation_id: z.string(),
  client_id: z.string(),
  channel: z.enum(["EMAIL", "SMS"]),
  recipient: z.string(),
});
function useInquiryCount() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["website-inquiries", session?.user.id, "count"],
    enabled: !!session,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("website_inquiry_open_count");
      if (error) throw error;
      return data;
    },
  });
}
export function InquiryNavigationLink() {
  const count = useInquiryCount();
  return (
    <Link to="/hub/inquiries" className="text-sm underline">
      Website inquiries{" "}
      {count.isError
        ? "(count unavailable)"
        : count.data !== undefined
          ? `(${count.data} open)`
          : ""}
    </Link>
  );
}
export default function WebsiteInquiriesPage() {
  const { session } = useAuth();
  return session ? (
    <InquiryWorkspace key={session.user.id} actor={session.user.id} />
  ) : (
    <p>Sign in to review inquiries.</p>
  );
}
interface WorkspaceProps {
  actor: string;
}
interface DetailProps extends WorkspaceProps {
  id: string;
}
function InquiryWorkspace({ actor }: WorkspaceProps) {
  const [status, setStatus] = useState("open"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["website-inquiries", actor, status, search],
    initialPageParam: null as { at: string; id: string } | null,
    refetchInterval: 15000,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("list_website_inquiries", {
        p_status: status,
        p_search: search,
        p_limit: 25,
        p_before_at: pageParam?.at,
        p_before_id: pageParam?.id,
      });
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last) =>
      last.length === 25
        ? { at: last.at(-1)!.submitted_at, id: last.at(-1)!.inquiry_id }
        : undefined,
  });
  return (
    <main className="space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Website inquiries</h1>
      <p className="text-sm text-muted-foreground">
        These are requests, not confirmed appointments. Submitted identities and
        contact details are unverified.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          Find inquiry
          <Input
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Status
          <select
            className="block rounded border bg-background p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {["open", "all", "new", "in_progress", "resolved", "spam"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_2fr]">
        <section aria-label="Inquiry list">
          {list.isError && (
            <p role="alert">
              Inquiry list could not refresh.{" "}
              <Button onClick={() => void list.refetch()}>Retry</Button>
            </p>
          )}
          {list.isPending && <p>Loading inquiries…</p>}
          {list.data?.pages.flat().map((item) => (
            <button
              key={item.inquiry_id}
              className="mb-2 block w-full rounded border p-3 text-left"
              onClick={() => setSelected(item.inquiry_id)}
            >
              <strong>{item.subject}</strong>
              <span className="block">
                {item.claimed_name} · {item.status}
              </span>
              <time className="text-sm text-muted-foreground">
                {new Date(item.submitted_at).toLocaleString()}
              </time>
            </button>
          ))}
          {list.data?.pages.flat().length === 0 && (
            <p>No matching inquiries.</p>
          )}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more inquiries
            </Button>
          )}
        </section>
        {selected ? (
          <InquiryDetail key={selected} id={selected} actor={actor} />
        ) : (
          <p>Select an inquiry to review.</p>
        )}
      </div>
    </main>
  );
}
function InquiryDetail({ id, actor }: DetailProps) {
  const cache = useQueryClient(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [assignee, setAssignee] = useState<string | undefined>(),
    [reason, setReason] = useState(""),
    [search, setSearch] = useState(""),
    [client, setClient] = useState<Tables<"clients"> | null>(null),
    [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL"),
    [confirmed, setConfirmed] = useState(false),
    [evidence, setEvidence] = useState("");
  const detail = useQuery({
    queryKey: ["website-inquiries", actor, id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_website_inquiry", {
        p_id: id,
      });
      if (error) throw error;
      return detailSchema.parse(data);
    },
  });
  const profiles = useQuery({
    queryKey: ["website-inquiries", actor, "staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const clients = useQuery({
    queryKey: ["website-inquiries", actor, "households", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_clients", {
        p_search: search,
        p_limit: 8,
      });
      if (error) throw error;
      return data;
    },
  });
  const history = useInfiniteQuery({
    queryKey: ["website-inquiries", actor, id, "history"],
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from("website_inquiry_history")
        .select("*")
        .eq("inquiry_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(25);
      if (pageParam)
        q = q.or(
          `created_at.lt.${pageParam.at},and(created_at.eq.${pageParam.at},id.lt.${pageParam.id})`,
        );
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last) =>
      last.length === 25
        ? { at: last.at(-1)!.created_at, id: last.at(-1)!.id }
        : undefined,
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["website-inquiries", actor] });
    } catch (e) {
      setError(
        errorMessage(e, "Change was not confirmed. Reload before retrying."),
      );
    } finally {
      setBusy(false);
    }
  };
  if (detail.isPending) return <p>Loading original submission…</p>;
  if (detail.isError || !detail.data)
    return (
      <p role="alert">
        Inquiry unavailable.{" "}
        <Button onClick={() => void detail.refetch()}>Retry</Button>
      </p>
    );
  const { submission: s, triage: t } = detail.data,
    recipient = client
      ? channel === "EMAIL"
        ? client.primary_email
        : client.primary_phone
      : null;
  return (
    <section className="space-y-5" aria-label="Inquiry detail">
      <article className="rounded border p-4">
        <h2 className="text-xl font-semibold">{s.subject}</h2>
        <p>Unverified submission from {s.name}</p>
        <p>
          {s.email} · {s.phone || "No phone provided"}
        </p>
        <p className="mt-3 whitespace-pre-wrap break-words">{s.message}</p>
      </article>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button onClick={() => void detail.refetch()}>Reload inquiry</Button>
        </p>
      )}
      <fieldset disabled={busy} className="space-y-2 rounded border p-4">
        <legend>Triage</legend>
        <label>
          Status
          <select
            className="block border bg-background p-2"
            value={status || t.status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {["new", "in_progress", "resolved", "spam"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Assigned staff
          <select
            className="block border bg-background p-2"
            value={assignee ?? t.assigned_to_id ?? ""}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Unassigned</option>
            {profiles.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        {profiles.isError && <p role="alert">Staff list unavailable.</p>}
        <label>
          Change reason
          <Input
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button
          disabled={reason.trim().length < 5}
          onClick={() =>
            void run(async () => {
              const { error } = await supabase.rpc("update_website_inquiry", {
                p_actor_id: actor,
                p_id: id,
                p_expected_version: t.version,
                p_status: status || t.status,
                p_assigned_to_id: (assignee ?? t.assigned_to_id) || null,
                p_reason: reason,
              });
              if (error) throw error;
              setReason("");
            })
          }
        >
          Save triage
        </Button>
      </fieldset>
      <fieldset disabled={busy} className="space-y-2 rounded border p-4">
        <legend>Review household and reply destination</legend>
        <p className="text-sm">
          Confirm independently who should receive a reply. Linking does not
          verify the original sender or grant SMS consent.
        </p>
        {t.client_id && (
          <p>
            Reviewed household: {detail.data.household_name} · {t.reply_channel}{" "}
            · {t.reply_recipient}
          </p>
        )}
        <label>
          Search existing households
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={200}
          />
        </label>
        {clients.isError && <p role="alert">Household search unavailable.</p>}
        {search.trim().length >= 2 &&
          clients.data?.map((c) => (
            <Button
              variant="outline"
              key={c.id}
              onClick={() => {
                setClient(c);
                setConfirmed(false);
              }}
            >
              {c.full_name}
            </Button>
          ))}
        {client && (
          <>
            <p>Selected: {client.full_name}</p>
            <label>
              Reply channel
              <select
                value={channel}
                className="block border bg-background p-2"
                onChange={(e) => {
                  setChannel(e.target.value as "EMAIL" | "SMS");
                  setConfirmed(false);
                }}
              >
                <option>EMAIL</option>
                <option>SMS</option>
              </select>
            </label>
            <p>
              Current household destination:{" "}
              {recipient || "Missing — update household first"}
            </p>
            <label className="block">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I independently confirmed this household and destination for the
              reply.
            </label>
            <label>
              Review evidence
              <Textarea
                value={evidence}
                maxLength={1000}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
            <Button
              disabled={!confirmed || !recipient || evidence.trim().length < 5}
              onClick={() =>
                void run(async () => {
                  const { error } = await supabase.rpc(
                    "review_website_inquiry_household",
                    {
                      p_actor_id: actor,
                      p_id: id,
                      p_expected_version: t.version,
                      p_client_id: client.id,
                      p_channel: channel,
                      p_recipient: recipient!,
                      p_confirmed: confirmed,
                      p_evidence: evidence,
                    },
                  );
                  if (error) throw error;
                  setConfirmed(false);
                  setEvidence("");
                })
              }
            >
              Confirm reply destination
            </Button>
          </>
        )}
      </fieldset>
      {t.client_id && t.reply_channel && t.reply_recipient && (
        <InquiryReply
          id={id}
          actor={actor}
          version={t.version}
          channel={t.reply_channel}
          recipient={t.reply_recipient}
          enabled={t.status === "in_progress"}
        />
      )}
      <section>
        <h3 className="font-semibold">Review history</h3>
        {history.isError && <p role="alert">History unavailable.</p>}
        {history.data?.pages.flat().map((h) => (
          <article className="border-b py-2 text-sm" key={h.id}>
            <p>
              {h.action} · {new Date(h.created_at).toLocaleString()}
            </p>
            <p>{h.reason}</p>
            <p className="text-muted-foreground">
              Staff:{" "}
              {profiles.data?.find((p) => p.id === h.actor_id)?.full_name ||
                h.actor_id}
            </p>
          </article>
        ))}
        {history.hasNextPage && (
          <Button
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Load older history
          </Button>
        )}
      </section>
    </section>
  );
}
interface ReplyProps extends DetailProps {
  version: number;
  channel: "EMAIL" | "SMS";
  recipient: string;
  enabled: boolean;
}
function InquiryReply({
  id,
  actor,
  version,
  channel,
  recipient,
  enabled,
}: ReplyProps) {
  const queue = useMessageQueue(`website-inquiry:${id}`),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [restored, setRestored] = useState<MessageIntent | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [queued, setQueued] = useState(false);
  const send = async () => {
    setWorking(true);
    setError("");
    try {
      const { data, error } = await supabase.rpc(
        "authorize_website_inquiry_reply",
        { p_actor_id: actor, p_id: id, p_expected_version: version },
      );
      if (error) throw error;
      const handoff = handoffSchema.parse(data);
      const intent: MessageIntent = {
        conversation_id: handoff.conversation_id,
        channel: handoff.channel,
        to: handoff.recipient,
        subject: channel === "EMAIL" ? subject : "",
        body,
        attachment_ids: [],
      };
      if (
        restored &&
        (restored.conversation_id !== intent.conversation_id ||
          restored.channel !== intent.channel ||
          restored.to !== intent.to ||
          restored.subject !== intent.subject ||
          restored.body !== intent.body ||
          restored.attachment_ids.length !== 0)
      )
        throw new Error(
          "The saved request differs from the reviewed destination or draft. Restore it exactly or explicitly discard it.",
        );
      await queue.send(intent);
      setBody("");
      setSubject("");
      setRestored(null);
      setQueued(true);
    } catch (e) {
      setError(
        errorMessage(
          e,
          "Queueing was not confirmed. Use saved request recovery before retrying.",
        ),
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <fieldset
      disabled={working || queue.pending}
      className="space-y-2 rounded border p-4"
    >
      <h3 className="font-semibold">Reply through unified inbox</h3>
      <p>
        {channel} to reviewed destination: {recipient}
      </p>
      <p className="text-sm">
        Current contact details and channel permission are checked again before
        queueing. Queueing does not confirm delivery.
      </p>
      <MessageRecoveryPanel
        queue={queue}
        hasDraft={!!body || !!subject}
        onRestore={(p) => {
          setBody(p.body);
          setSubject(p.subject);
          setRestored(p);
          setQueued(false);
        }}
      />
      {!enabled && (
        <p>
          Set status to in progress and review the destination before replying.
        </p>
      )}
      {channel === "EMAIL" && (
        <label>
          Reply subject
          <Input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setQueued(false);
            }}
            maxLength={998}
          />
        </label>
      )}
      <label>
        Reply message
        <Textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setQueued(false);
          }}
          maxLength={50000}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {queued && (
        <p role="status">
          Reply queued. Delivery is tracked in the unified inbox.
        </p>
      )}
      <Button
        disabled={
          !enabled ||
          working ||
          queue.pending ||
          !body.trim() ||
          (channel === "EMAIL" && !subject.trim())
        }
        onClick={() => void send()}
      >
        Queue reviewed reply
      </Button>
    </fieldset>
  );
}
