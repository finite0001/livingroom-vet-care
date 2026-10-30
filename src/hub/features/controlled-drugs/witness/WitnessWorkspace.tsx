import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import { sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig } from "../record-review/raw-rpc.ts";
import { reviewEventLabels } from "../record-review/review-labels.ts";
import { browserEntryLock } from "../entry/service.ts";
import { createWitnessClient } from "./client.ts";
import { createWitnessService, witnessStorageKey } from "./service.ts";
import { PreparedWitnessDetails } from "./PreparedWitnessDetails";
import { createWitnessRequestScope } from "./request-scope.ts";
import { witnessBlockedLabels } from "./labels.ts";
import type { WitnessCursor, WitnessList, WitnessReceipt, WitnessReply, WitnessTask } from "./schema.ts";
export const witnessWorkspacePath = "/hub/inventory/narcotics/witness";
interface WitnessWorkspaceProps { readonly connection?: ReviewRpcConfig; readonly fetcher?: typeof fetch }
interface Display<T> { readonly identity: Readonly<ReviewIdentity>; readonly value: T }
const storage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value), removeItem: (key: string) => localStorage.removeItem(key) };
const configuration = () => ({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY });

/** Recovery IDs survive navigation; source/body/checkbox values never persist. */
export function WitnessRecoveryNotice() {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, () => null);
  const [, refresh] = useState(0);
  useEffect(() => { const changed = () => refresh(n => n + 1); window.addEventListener("storage", changed); window.addEventListener("focus", changed); window.addEventListener("stock-witness-operation", changed); return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", changed); window.removeEventListener("stock-witness-operation", changed); }; }, []);
  let pending = false;
  try { pending = !!identity && localStorage.getItem(witnessStorageKey(identity.actorId)) !== null; } catch { pending = !!identity; }
  return pending ? <aside className="m-3 rounded-lg border bg-background p-3 text-sm" aria-label="Independent witness recovery"><p>An independent witness operation needs checking. Its original IDs are retained.</p><Link className="mt-2 inline-flex min-h-11 items-center font-medium underline" to={witnessWorkspacePath}>Open witness recovery</Link></aside> : null;
}

export function WitnessWorkspace({ connection, fetcher }: WitnessWorkspaceProps) {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, () => null);
  const [page, setPage] = useState<Display<WitnessList> | null>(null), [detail, setDetail] = useState<Display<WitnessReply> | null>(null), [receipt, setReceipt] = useState<Display<WitnessReceipt> | null>(null);
  const [cursor, setCursor] = useState<WitnessCursor | null>(null), [history, setHistory] = useState<readonly (WitnessCursor | null)[]>([]), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<Display<string> | null>(null), [, refresh] = useState(0);
  const requests = useMemo(createWitnessRequestScope, []), live = useRef(true);
  const parts = useMemo(() => {
    try { const client = createWitnessClient(connection ?? configuration(), sessions, fetcher); return { client, service: createWitnessService(client, sessions, storage, browserEntryLock()) }; } catch { return null; }
  }, [connection, fetcher, sessions]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = <T,>(value: Display<T> | null) => value && identity && sameReviewIdentity(value.identity, identity) ? value.value : null;
  const shownPage = current(page), shownDetail = current(detail), shownReceipt = current(receipt), shownError = current(error);
  let pending = null, corrupt = false;
  try { pending = identity && parts ? parts.service.pending(identity.actorId) : null; } catch { corrupt = true; }
  const notify = () => { refresh(n => n + 1); window.dispatchEvent(new Event("stock-witness-operation")); };
  async function perform<T>(expected: Readonly<ReviewIdentity>, work: () => Promise<T>, done: (result: T) => void) {
    if (!parts || !sessions.isCurrent(expected)) return;
    const job = requests.begin(expected); if (!job) return;
    setBusy(true); setError(null);
    try { const result = await work(); if (live.current && sessions.isCurrent(expected)) done(result); }
    catch { if (live.current && sessions.isCurrent(expected)) setError({ identity: expected, value: "The witness result could not be confirmed. Keep the original operation and check it; do not create another attempt." }); }
    finally { const latest = requests.finish(job); if (live.current) { if (latest) setBusy(false); notify(); } }
  }
  useEffect(() => {
    setAcknowledged(false); setDetail(null); setReceipt(null); setPage(null); setError(null); setCursor(null); setHistory([]);
    if (!identity || !parts) return;
    const expected = identity;
    void perform(expected, () => parts.client.list({ schema_version: 1, actor_id: expected.actorId, cursor: null, page_size: 25 }, expected), value => setPage({ identity: expected, value }));
    // All actions use this render's captured session. A new login never inherits a displayed attestation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, parts]);
  const load = (next: WitnessCursor | null, past: readonly (WitnessCursor | null)[]) => {
    if (!identity || !parts) return; const expected = identity;
    void perform(expected, () => parts.client.list({ schema_version: 1, actor_id: expected.actorId, cursor: next, page_size: 25 }, expected), value => { setPage({ identity: expected, value }); setCursor(next); setHistory(past); });
  };
  const open = (task: WitnessTask) => {
    if (!identity || !parts) return; const expected = identity; setAcknowledged(false); setReceipt(null);
    void perform(expected, () => parts.service.open(task, expected), value => setDetail({ identity: expected, value }));
  };
  const recover = (mode: "read" | "close" | "inspect") => {
    if (!identity || !parts) return; const expected = identity; setAcknowledged(false);
    void perform(expected, () => mode === "inspect" ? parts.service.inspect(expected) : parts.service.recover(mode, expected), value => { setDetail({ identity: expected, value }); setReceipt(null); });
  };
  const attest = () => {
    if (!identity || !parts || !shownDetail || !acknowledged) return; const expected = identity, displayed = shownDetail;
    void perform(expected, () => parts.service.attest(displayed, expected, true), value => { setReceipt({ identity: expected, value }); setDetail(null); setAcknowledged(false); });
  };
  if (!identity) return <p className="p-4">Sign in with your own staff account to review independent witness tasks.</p>;
  return <section className="mx-auto max-w-4xl space-y-5 p-4 md:p-6" aria-label="Independent controlled-stock witness">
    <header><h1 className="font-display text-2xl">Independent stock witness</h1><p className="mt-2 text-sm text-muted-foreground">Use your own staff login. Attest only if you independently witnessed the exact action and basis shown. This is separate from later independent record review.</p></header>
    {!parts && <p role="alert">The witness interface is unavailable. No action has been sent.</p>}
    {corrupt && <p role="alert" className="text-destructive">The stored witness operation cannot be read. Preserve this browser’s data and request recovery help.</p>}
    {shownError && <p role="alert" className="text-destructive">{shownError}</p>}
    {busy && <p role="status">Checking the original source. Do not submit again.</p>}
    {pending && <aside className="space-y-2 rounded-xl border p-4" aria-label="Owned witness operation"><p className="break-all text-sm">Original witness operation {pending.operation_id}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => recover("read")}>Check saved result</Button><Button variant="outline" disabled={busy} onClick={() => recover("inspect")}>Read current prepared action</Button><Button variant="outline" disabled={busy} onClick={() => recover("close")}>Close witness attempt</Button></div><p className="text-xs text-muted-foreground">Closing retains a saved attestation; otherwise it prevents this witness operation from saving later. It does not cancel the recorder’s action.</p></aside>}
    {shownReceipt && <p role="status" className="rounded-lg border p-4">Witness attestation recorded at {shownReceipt.recorded_at}. The recorder must separately execute their original preparation.</p>}
    {shownDetail && <section className="space-y-4 rounded-xl border p-4 md:p-5" aria-label="Witness action detail">
      {shownDetail.state === "not_found" && <p>No result is confirmed. The IDs remain because a delayed save could still arrive. Read the current prepared action or explicitly close this witness attempt.</p>}
      {shownDetail.state === "abandoned" && <p>This witness attempt is closed without an attestation.</p>}
      {shownDetail.state === "saved" && <p role="status">Your original attestation is recorded at {shownDetail.data.receipt!.recorded_at}. Recovery is confirmed; no save was resent.</p>}
      {shownDetail.state === "blocked" && <p role="alert">{witnessBlockedLabels[shownDetail.data.blocked_reason!]}. The recorder may need to close the unexecuted preparation and start a fresh original action.</p>}
      <PreparedWitnessDetails reply={shownDetail}/>
      {shownDetail.state === "available" && <><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)}/><span>I independently witnessed this exact action and basis, including the displayed quantities and the recorder’s original observation time where applicable. I am not the recorder.</span></label><Button className="min-h-11 w-full md:w-auto" disabled={busy || !acknowledged} onClick={attest}>Attest as independent witness</Button></>}
      <Button variant="ghost" disabled={busy} onClick={() => { setDetail(null); setAcknowledged(false); }}>Leave detail; retain recovery IDs</Button>
    </section>}
    <section className="space-y-3" aria-label="Eligible witness tasks"><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl">Prepared actions you may witness</h2><Button variant="outline" disabled={busy || !parts} onClick={() => load(cursor, history)}>Refresh tasks</Button></div>
      {shownPage?.items.length === 0 && <p>No eligible tasks were returned on this page.</p>}
      {shownPage?.items.map(task => <article key={task.parent_action_id} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><h3 className="break-words font-medium">{task.product_name}</h3><p className="text-sm">{reviewEventLabels[task.event_kind]} · recorder {task.recorder.name}</p><p className="break-words text-xs text-muted-foreground">Prepared {task.created_at} · expires {task.expires_at}</p></div><Button className="min-h-11 shrink-0" disabled={busy || corrupt || !!pending && pending.parent_action_id !== task.parent_action_id} onClick={() => open(task)}>Read exact prepared action</Button></article>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !history.length} onClick={() => load(history.at(-1) ?? null, history.slice(0, -1))}>Previous page</Button><Button variant="outline" disabled={busy || !shownPage?.has_more || !shownPage.next_cursor} onClick={() => shownPage?.next_cursor && load(shownPage.next_cursor, [...history, cursor])}>Next eligible tasks</Button></div>
    </section>
    <Link className="inline-flex min-h-11 items-center underline" to="/hub/inventory/narcotics">Back to narcotics log</Link>
  </section>;
}
export default WitnessWorkspace;
