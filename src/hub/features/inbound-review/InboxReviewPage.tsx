import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  assignmentIntent,
  assignmentOutcome,
  type AssignmentIntent,
  type Inbound,
  type Recovery,
} from "./InboundReviewState";
import {
  assignInbound,
  households,
  householdConversations,
  listUnassigned,
  readAssignment,
  type Cursor,
} from "./InboundReviewApi";
interface Household {
  id: string;
  full_name: string;
  primary_email: string | null;
  primary_phone: string | null;
}
interface Conversation {
  id: string;
  client_id: string;
  status: string;
  last_message_at: string;
}
const date = (v: string) =>
  new Date(v).toLocaleString("en-US", { timeZone: "America/Denver" });
export default function InboxReviewPage() {
  const { session, profile } = useAuth();
  return session && profile?.is_active ? (
    <InboundReview key={session.user.id} actor={session.user.id} />
  ) : null;
}
function InboundReview({ actor }: { actor: string }) {
  const cache = useQueryClient(),
    [rows, setRows] = useState<Inbound[]>([]),
    [more, setMore] = useState(false),
    [cursor, setCursor] = useState<Cursor | null>(null),
    [selected, setSelected] = useState<Inbound | null>(null),
    [receipt, setReceipt] = useState<Recovery | null>(null);
  const [search, setSearch] = useState(""),
    [clients, setClients] = useState<Household[]>([]),
    [client, setClient] = useState<Household | null>(null),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [conversation, setConversation] = useState(""),
    [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [draft, setDraft] = useState(false);
  const [pending, setPending] = useState<AssignmentIntent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [outcome, setOutcome] = useState<ReturnType<
      typeof assignmentOutcome
    > | null>(null);
  const alive = useRef(true),
    lock = useRef(false),
    initialized = useRef(false),
    pendingRef = useRef<AssignmentIntent | null>(null),
    key = `inbound-assignment-intent:${actor}:pending`;
  const dirty = busy || draft || Boolean(pending) || checked,
    blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch {
      if (alive.current)
        setError(
          "Review is unavailable or unconfirmed. Your exact assignment request is retained when submitted. Recover the original message before retrying.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const load = async (next = cursor) => {
    const result = await listUnassigned(next);
    if (alive.current) {
      setRows(result.rows);
      setMore(result.more);
    }
  };
  const clearPending = () => {
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
  };
  const recover = async () => {
    const p = pendingRef.current,
      id = p?.p_id ?? selected?.id;
    if (!id) {
      await load();
      return;
    }
    const r = await readAssignment(id);
    if (!alive.current) return;
    setReceipt(r);
    setChecked(false);
    if (r.inbound) setSelected(r.inbound);
    if (p) {
      const status = assignmentOutcome(r, p);
      setOutcome(status);
      if (status === "assigned") {
        clearPending();
        setDraft(false);
        setNotice(
          "The original incoming message is assigned. No new message or reply was sent.",
        );
        await Promise.all([
          cache.invalidateQueries({ queryKey: ["conversations"] }),
          cache.invalidateQueries({ queryKey: ["unread-count"] }),
        ]);
      } else if (status === "unassigned")
        setNotice(
          "The original message is still unassigned at the reviewed version. Retry the same assignment or discard the uncreated request.",
        );
      else if (status === "conflict")
        setNotice(
          "Another assignment or version change is recorded. This request did not match the saved review; no additional assignment will be submitted.",
        );
      else
        setNotice(
          "The original incoming message is unavailable. Keep this request for recovery.",
        );
    }
    await load();
  };
  useEffect(() => {
    alive.current = true;
    const auth = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.user.id !== actor) {
        alive.current = false;
        sessionStorage.removeItem(key);
      }
    });
    if (!initialized.current) {
      initialized.current = true;
      void run(async () => {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const p = assignmentIntent(JSON.parse(raw), actor);
          pendingRef.current = p;
          setPending(p);
          await recover();
        } else await load();
      });
    }
    return () => {
      alive.current = false;
      auth.data.subscription.unsubscribe();
    };
    // One immutable assignment intent belongs to this authenticated operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (row: Inbound) =>
    void run(async () => {
      const r = await readAssignment(row.id);
      if (!alive.current) return;
      if (!r.inbound) throw new Error("Message unavailable");
      setSelected(r.inbound);
      setReceipt(r);
      setOutcome(null);
      setClient(null);
      setConversation("");
      setConversations([]);
      setReason("");
      setSearch("");
      setClients([]);
      setChecked(false);
    });
  const submit = () =>
    void run(async () => {
      if (
        !selected ||
        !client ||
        !checked ||
        pendingRef.current ||
        !conversations.some(
          (c) => c.id === conversation && c.client_id === client.id,
        )
      )
        throw new Error("Review required");
      const p = assignmentIntent(
        {
          p_actor_id: actor,
          p_id: selected.id,
          p_expected_version: selected.version,
          p_client_id: client.id,
          p_conversation_id: conversation,
          p_reason: reason.trim(),
        },
        actor,
      );
      sessionStorage.setItem(key, JSON.stringify(p));
      pendingRef.current = p;
      setPending(p);
      setChecked(false);
      setOutcome(null);
      try {
        const row = await assignInbound(p);
        if (row.id !== p.p_id) throw new Error("Original message differs");
      } catch {
        /* Both rejection and lost replies require authoritative original-message recovery. */
      }
      await recover();
    });
  const retry = () =>
    void run(async () => {
      await recover();
      const p = pendingRef.current;
      if (!p || !alive.current) return;
      const r = await readAssignment(p.p_id);
      if (!alive.current) return;
      if (assignmentOutcome(r, p) !== "unassigned")
        throw new Error("Assignment changed");
      try {
        await assignInbound(p);
      } catch {
        /* Recover before any future attempt. */
      }
      await recover();
    });
  const frozen = busy || Boolean(pending),
    assigned = Boolean(selected?.message_id);
  return (
    <main className="space-y-5 overflow-y-auto p-4 md:p-6">
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave unfinished inbox review?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved household selections will be discarded. A submitted
              assignment remains recoverable from its original incoming message.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              Keep reviewing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              Leave and recover later
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Link className="text-primary underline" to="/hub/chats">
        Back to inbox
      </Link>
      <h1 className="text-xl font-semibold">
        Review unmatched incoming messages
      </h1>
      <p className="text-sm text-muted-foreground">
        Choose an existing household and its conversation after reviewing the
        sender and plain-text message. Assignment does not change contact
        information, consent, or send a reply.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void run(recover)}
      >
        Recover incoming message review
      </Button>
      {pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Original assignment retained for message version{" "}
            {pending.p_expected_version}. Household and conversation choices
            cannot change while its outcome is uncertain.
          </p>
          <Button
            disabled={
              busy || outcome === "conflict" || outcome === "unavailable"
            }
            onClick={retry}
          >
            Retry original assignment
          </Button>
          {(outcome === "unassigned" || outcome === "conflict") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const p = pendingRef.current;
                  if (!p) return;
                  const r = await readAssignment(p.p_id),
                    status = assignmentOutcome(r, p);
                  if (!alive.current) return;
                  if (status !== "unassigned" && status !== "conflict")
                    throw new Error("Recover changed assignment");
                  clearPending();
                  setReceipt(r);
                  setSelected(r.inbound);
                  setOutcome(status);
                  setDraft(false);
                  setChecked(false);
                  setNotice(
                    status === "conflict"
                      ? "Conflicting local request cleared; the saved assignment remains unchanged."
                      : "Uncreated local request discarded. Review the original message again before assigning.",
                  );
                })
              }
            >
              {outcome === "conflict"
                ? "Clear conflicting local request"
                : "Discard uncreated assignment request"}
            </Button>
          )}
        </div>
      )}
      <section aria-label="Unmatched message queue" className="space-y-3">
        <h2 className="font-semibold">Unassigned incoming messages</h2>
        {!rows.length && !busy && !error && (
          <p>No unassigned messages on this page.</p>
        )}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border p-3">
              <p>
                {r.channel} · {r.sender} · {date(r.received_at)} Denver
              </p>
              <p>{r.subject || "No subject"}</p>
              <Button
                variant="outline"
                disabled={dirty}
                onClick={() => choose(r)}
              >
                Review {r.sender}
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={dirty || !cursor}
            onClick={() =>
              void run(async () => {
                await load(null);
                if (alive.current) setCursor(null);
              })
            }
          >
            Newest unmatched messages
          </Button>
          <Button
            variant="outline"
            disabled={dirty || !more}
            onClick={() =>
              void run(async () => {
                const last = rows.at(-1);
                if (!last) return;
                const next = { at: last.received_at, id: last.id };
                await load(next);
                if (alive.current) setCursor(next);
              })
            }
          >
            Older unmatched messages
          </Button>
        </div>
      </section>
      {selected && (
        <section
          aria-label="Original incoming message review"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 className="font-semibold">Review original incoming message</h2>
          <dl className="grid gap-2 md:grid-cols-2">
            <div>
              <dt>From</dt>
              <dd>{selected.sender}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{selected.recipient}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{selected.subject || "No subject"}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>
                {date(selected.received_at)} Denver · version {selected.version}
              </dd>
            </div>
          </dl>
          <p className="text-sm">
            Review reason:{" "}
            {selected.review_reason ||
              (assigned ? "Assigned" : "Needs household review")}
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
            {selected.body}
          </pre>
          {assigned ? (
            <div className="space-y-2">
              <p>Saved incoming message assigned to a conversation.</p>
              {receipt?.assignments.map((a) => (
                <p key={a.id}>
                  Reviewed by {a.assigned_by} · {date(a.created_at)} Denver ·{" "}
                  {a.reason}
                </p>
              ))}
              <Link
                className="text-primary underline"
                to={`/hub/conversation/${selected.conversation_id}`}
              >
                Open assigned conversation
              </Link>
            </div>
          ) : (
            <fieldset disabled={frozen} className="space-y-3">
              <legend className="font-medium">
                Reviewed household assignment
              </legend>
              <Label htmlFor="inbound-household-search">
                Find existing household
              </Label>
              <Input
                id="inbound-household-search"
                value={search}
                maxLength={200}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setDraft(true);
                  setChecked(false);
                }}
              />
              <Button
                variant="outline"
                disabled={!search.trim()}
                onClick={() =>
                  void run(async () => {
                    const rows = await households(search.trim());
                    if (alive.current) setClients(rows);
                  })
                }
              >
                Search households for assignment
              </Button>
              <ul className="space-y-2">
                {clients.map((c) => (
                  <li key={c.id}>
                    <Button
                      variant={client?.id === c.id ? "secondary" : "outline"}
                      onClick={() =>
                        void run(async () => {
                          const rows = await householdConversations(c.id);
                          if (alive.current) {
                            setClient(c);
                            setConversations(rows);
                            setConversation("");
                            setDraft(true);
                            setChecked(false);
                          }
                        })
                      }
                    >
                      {c.full_name} ·{" "}
                      {c.primary_email ||
                        c.primary_phone ||
                        "Contact not recorded"}
                    </Button>
                  </li>
                ))}
              </ul>
              {clients.length === 30 && (
                <p className="text-sm">
                  Showing the first 30 matches. Narrow the household search.
                </p>
              )}
              {client && (
                <>
                  <p className="font-medium">
                    Selected household: {client.full_name}
                  </p>
                  <Label htmlFor="inbound-conversation">
                    This household’s conversation
                  </Label>
                  <select
                    id="inbound-conversation"
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                    value={conversation}
                    onChange={(e) => {
                      setConversation(e.target.value);
                      setDraft(true);
                      setChecked(false);
                    }}
                  >
                    <option value="">Select an existing conversation</option>
                    {conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.status} · last message {date(c.last_message_at)}{" "}
                        Denver · {c.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  {!conversations.length && (
                    <p>
                      No conversation exists for this household. Create one
                      through the inbox, then return to this original message.
                    </p>
                  )}
                  {conversations.length === 100 && (
                    <p className="text-sm">
                      Showing the latest 100 household conversations.
                    </p>
                  )}
                </>
              )}
              <Label htmlFor="inbound-assignment-reason">
                Household matching reason
              </Label>
              <Textarea
                id="inbound-assignment-reason"
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setDraft(true);
                  setChecked(false);
                }}
              />
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I reviewed the original sender and message, the selected
                household, and its conversation. This assignment does not
                establish consent.
              </label>
              <Button
                disabled={
                  !checked ||
                  !client ||
                  !conversation ||
                  reason.trim().length < 5
                }
                onClick={submit}
              >
                Assign original incoming message
              </Button>
            </fieldset>
          )}
          <Button
            variant="outline"
            disabled={frozen}
            onClick={() => {
              setSelected(null);
              setReceipt(null);
              setDraft(false);
              setChecked(false);
              setOutcome(null);
              setReason("");
              setClient(null);
              setConversation("");
            }}
          >
            Close incoming message review
          </Button>
        </section>
      )}
    </main>
  );
}
