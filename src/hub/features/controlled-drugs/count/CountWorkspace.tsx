import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { CountClient } from "./count-client.ts";
import type { CountOperationController } from "./count-operation-controller.ts";
import type { CountDiscoveryCursor, CountDiscoveryReply } from "./count-discovery.ts";
import type { CountReadData } from "./count-read-wire.ts";
import { parseCountRequest, type CountMutationAction, type CountStatementRequest } from "./count-request-schema.ts";
import { CountRecord } from "./CountRecord";
import { CountStatementForm } from "./CountStatementForm";

export interface CountWorkspaceProps {
  readonly sessions: ReviewStaffSessionSource; readonly client: CountClient; readonly operations: CountOperationController;
  /** Selected through authenticated configuration discovery, never typed IDs. */
  readonly scope: { readonly product_id: string; readonly site_id: string; readonly product_name: string; readonly site_label: string };
}
interface SignedInProps extends CountWorkspaceProps { readonly identity: Readonly<ReviewIdentity> }
const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

interface ObservationEditorProps {
  readonly actorId: string; readonly data: CountReadData; readonly busy: boolean; readonly pending: boolean;
  readonly dirty: (value: boolean) => void; readonly submit: (request: CountStatementRequest) => Promise<void>;
}
function ObservationEditor({ actorId, data, busy, pending, dirty, submit }: ObservationEditorProps) {
  // UUIDs belong to this opened snapshot, never to a React render or keystroke.
  const [identity] = useState(() => ({ actor_id: actorId, count_id: data.count_id, snapshot_id: data.snapshot_id,
    operation_id: crypto.randomUUID(), statement_id: crypto.randomUUID() }));
  return <CountStatementForm identity={identity} data={data} busy={busy} pendingRecovery={pending} onDirtyChange={dirty} onSubmit={submit} />;
}

function SignedInCountWorkspace({ sessions, client, operations, scope, identity }: SignedInProps) {
  const [page, setPage] = useState<CountDiscoveryReply | null>(null), [data, setData] = useState<CountReadData | null>(null);
  const [busy, setBusy] = useState(false), [observationDirty, setDirty] = useState(false), [message, setMessage] = useState("");
  const [actorB, setActorB] = useState(""), [cancelReason, setCancelReason] = useState("");
  const [reviewed, setReviewed] = useState(false), [discard, setDiscard] = useState(false), [, setRevision] = useState(0);
  const dirty = observationDirty || cancelReason !== "" || reviewed;
  const alive = useRef(true), inflight = useRef(false);
  const attemptedOperation = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const changed = () => { if (alive.current) setRevision(value => value + 1); };
    window.addEventListener("storage", changed); window.addEventListener("focus", changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", changed); };
  }, []);
  const guard = useUnsavedChanges(dirty, "Your physical count entries have not been recorded. Leaving will discard them. A pending save can still be recovered after you return.");
  let pending: ReturnType<CountOperationController["pending"]> = null, recoveryBlocked = false;
  try { pending = operations.pending(identity.actorId); } catch { recoveryBlocked = true; }
  const active = () => alive.current && sessions.isCurrent(identity);
  const supports = (action: CountDiscoveryReply["available_actions"][number]) => page?.available_actions.includes(action) === true;
  async function run(task: () => Promise<void>, propagate = false): Promise<void> {
    if (inflight.current || !active()) {
      if (propagate) throw new ControlledOperationNotSentError();
      return;
    }
    inflight.current = true; setBusy(true); setMessage("");
    try { await task(); }
    catch (error) {
      if (active()) setMessage(error instanceof ControlledOperationNotSentError ? "This action was not sent. Wait for the other action, then submit deliberately." : "The result could not be confirmed. Check pending-save recovery before recording anything else.");
      if (propagate) { if (error instanceof ControlledOperationNotSentError) throw error; throw new Error("The count result is unconfirmed."); }
    } finally {
      inflight.current = false;
      if (active()) { setBusy(false); setRevision(value => value + 1); }
    }
  }
  async function load(cursor: CountDiscoveryCursor | null = null) {
    if (dirty) return;
    const result = await client.discover({ schema_version: 1, actor_id: identity.actorId, product_id: scope.product_id, site_id: scope.site_id, cursor, page_size: 25 }, identity);
    if (active()) { setPage(result); setActorB(""); setData(null); setReviewed(false); setCancelReason(""); }
  }
  async function open(countId: string) {
    if (dirty) return;
    const result = await client.read({ schema_version: 1, actor_id: identity.actorId, count_id: countId }, identity);
    if (result.data.product.id !== scope.product_id || result.data.site.id !== scope.site_id) throw new Error("Count scope changed.");
    if (active()) { setData(result.data); setReviewed(false); setCancelReason(""); }
  }
  async function mutate(action: CountMutationAction, request: unknown) {
    const parsed = parseCountRequest(action, request);
    attemptedOperation.current = parsed.operation_id;
    const result = await operations.mutate(action, parsed, scope, identity);
    if (!active()) return;
    setDirty(false); setReviewed(false); setCancelReason(""); setData(null); setMessage("Your count action is recorded.");
    try {
      const current = await client.read({ schema_version: 1, actor_id: identity.actorId, count_id: result.data.receipt.count_id }, identity);
      if (current.data.product.id !== scope.product_id || current.data.site.id !== scope.site_id) throw new Error("Count scope changed.");
      if (active()) { setData(current.data); setReviewed(false); setCancelReason(""); }
    } catch {
      // A later display failure cannot revoke the independently verified save.
      if (active()) setMessage("Your action is recorded. Reload the count list to view it.");
    }
  }
  async function start() {
    if (!page?.capabilities.observe || !supports("start") || pending || recoveryBlocked || dirty || !page.observers.some(person => person.id === actorB && person.id !== identity.actorId)) return;
    await mutate("start", { schema_version: 1, actor_id: identity.actorId, operation_id: crypto.randomUUID(), count_id: crypto.randomUUID(),
      product_id: scope.product_id, site_id: scope.site_id, actor_b_id: actorB });
  }
  const locked = busy || !!pending || recoveryBlocked;
  const participant = data?.participants.some(person => person.id === identity.actorId && !person.submitted);
  const canManage = page?.capabilities.manage === true && data?.history_state === "collecting";
  function clearRecoveredDraft(operationId: string) {
    // Another tab's recovery must never discard this tab's unrelated draft.
    if (attemptedOperation.current !== operationId) return;
    setDirty(false); setReviewed(false); setCancelReason(""); setData(null);
    attemptedOperation.current = null;
  }
  return <section className="min-w-0 space-y-5" aria-label="Controlled-drug physical counts">
    {guard}
    <header className="space-y-1"><h2 className="font-display text-xl">Physical stock counts</h2>
      <p className="break-words text-sm text-muted-foreground">{scope.product_name} · {scope.site_label}. Two people record independent observations.</p></header>
    {message && <p role="status" className="text-sm">{message}</p>}
    {recoveryBlocked && <p role="alert" className="text-destructive">The saved-operation record cannot be read. Keep this browser’s data and ask an administrator to help recover it.</p>}
    {pending && <section className="space-y-3 rounded-xl border p-4" aria-label="Pending count save">
      <h3 className="font-medium">Check the previous save</h3>
      <p className="text-sm">A previous attempt needs a confirmed outcome. You can check it after signing in again, even if it belongs to another medication or site.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(async () => {
        const result = await operations.recover("read", identity);
        if (active()) { if (result.state !== "pending") clearRecoveredDraft(result.operation_id); setMessage(result.state === "pending" ? "No saved receipt yet. Check again, or close this attempt before starting over." : result.state === "saved" ? "The original action was recorded." : "The original attempt is closed without a save."); }
      })}>Check original save</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(async () => {
          const result = await operations.recover("close", identity);
          if (active()) { clearRecoveredDraft(result.operation_id); setMessage(result.state === "saved" ? "The original action was already recorded." : "The attempt is closed. Reload counts before entering a new observation."); }
        })}>Close pending attempt</Button></div>
      <p className="text-xs text-muted-foreground">Closing preserves an action that already saved. Otherwise it prevents that attempt from saving later. It does not submit your entries again.</p>
    </section>}
    {!data && <>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(() => load())}>{page ? "Refresh count list" : "Load counts"}</Button>
      {page?.capabilities.observe && supports("start") && <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-1"><Label htmlFor="count-second-observer">Second observer</Label><select id="count-second-observer" className={selectClass} disabled={locked} value={actorB} onChange={event => setActorB(event.target.value)}>
          <option value="">Choose another eligible staff member</option>{page.observers.filter(person => person.id !== identity.actorId).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></div><Button type="button" className="min-h-11" disabled={locked || !actorB} onClick={() => void run(start)}>Start independent count</Button>
      </div>}
      {page && <div className="space-y-3"><h3 className="font-medium">Recorded counts</h3>
        {!page.counts.length && <p className="text-sm text-muted-foreground">No counts found for this medication and site.</p>}
        <ul className="space-y-2">{page.counts.map(count => <li key={count.count_id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0"><p className="text-sm">{new Date(count.captured_at).toLocaleString()} · {count.history_state === "open" ? "Observations in progress" : count.history_state}</p>
            <p className="break-words text-sm text-muted-foreground">{count.participants.map(person => `${person.name}: ${person.submitted ? "recorded" : "needed"}`).join(" · ")}</p></div>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy || !supports("read")} onClick={() => void run(() => open(count.count_id))}>Open count</Button>
        </li>)}</ul>
        {page.has_more && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(() => load(page.next_cursor))}>Older counts</Button>}
      </div>}
    </>}
    {data && <>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => dirty ? setDiscard(true) : setData(null)}>Back to count list</Button>
      <CountRecord data={data} refreshing={busy} locked={dirty} onRefresh={() => void run(() => open(data.count_id))} />
      {participant && page?.capabilities.observe && supports("statement") && <ObservationEditor key={`${data.count_id}:${data.snapshot_id}:${data.read_at}`}
        actorId={identity.actorId} data={data} busy={busy || cancelReason !== "" || reviewed} pending={!!pending || recoveryBlocked} dirty={setDirty}
        submit={(request: CountStatementRequest) => run(() => mutate("statement", request), true)} />}
      {canManage && <section className="space-y-3 rounded-xl border p-4" aria-label="Finish or cancel count">
        <h3 className="font-medium">Complete the count review</h3>
        <p className="text-sm">Finalizing records whether the observations agree. It does not adjust stock.</p>
        {supports("finalize") && data.current_boundary_state === "changed" && <div className="grid gap-2 justify-items-start"><p className="text-sm">Stock, source records, or count policy changed. Close this count as stale and repeat it; no missing observation is supplied for either person.</p>
          <Button type="button" className="min-h-11" disabled={locked || dirty} onClick={() => void run(() => mutate("finalize", { schema_version: 1, actor_id: identity.actorId, count_id: data.count_id, operation_id: crypto.randomUUID(), outcome_id: crypto.randomUUID() }))}>Close stale count and repeat</Button></div>}
        {supports("finalize") && data.current_boundary_state === "unchanged" && <div className="grid gap-2 justify-items-start"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={reviewed} disabled={locked || observationDirty || cancelReason !== "" || !data.participants.every(person => person.submitted)} onChange={event => setReviewed(event.target.checked)} />I reviewed both recorded observations.</label>
          <Button type="button" className="min-h-11" disabled={locked || observationDirty || cancelReason !== "" || !reviewed} onClick={() => void run(() => mutate("finalize", { schema_version: 1, actor_id: identity.actorId, count_id: data.count_id, operation_id: crypto.randomUUID(), outcome_id: crypto.randomUUID() }))}>Finalize count</Button></div>}
        {supports("cancel") && <div className="grid gap-2"><Label htmlFor="count-cancel-reason">Reason for cancelling this count</Label><Textarea id="count-cancel-reason" disabled={locked || observationDirty || reviewed} maxLength={512} value={cancelReason} onChange={event => setCancelReason(event.target.value)} />
          <Button type="button" variant="outline" className="min-h-11 justify-self-start" disabled={locked || observationDirty || reviewed || !cancelReason.trim()} onClick={() => void run(() => mutate("cancel", { schema_version: 1, actor_id: identity.actorId, count_id: data.count_id, operation_id: crypto.randomUUID(), cancellation_id: crypto.randomUUID(), reason: cancelReason }))}>Cancel count with reason</Button></div>}
      </section>}
    </>}
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard your unrecorded entries?</AlertDialogTitle><AlertDialogDescription>Your entered observations or cancellation reason will be lost. Recorded observations and pending-save recovery remain available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { setDirty(false); setReviewed(false); setCancelReason(""); setData(null); setDiscard(false); }}>Discard entries</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

/** Auth generation changes unmount all prior actor data before the next render. */
export function CountWorkspace(props: CountWorkspaceProps) {
  const identity = useSyncExternalStore(props.sessions.subscribe, props.sessions.getSnapshot, props.sessions.getSnapshot);
  if (!identity) return <p role="status">Sign in with an active staff account to open physical counts.</p>;
  return <SignedInCountWorkspace key={`${identity.actorId}:${identity.sessionId}:${identity.generation}:${props.scope.product_id}:${props.scope.site_id}`} {...props} identity={identity} />;
}
