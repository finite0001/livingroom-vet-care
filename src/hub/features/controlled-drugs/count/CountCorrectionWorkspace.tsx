import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { CountClient } from "./count-client.ts";
import type { CountOperationController } from "./count-operation-controller.ts";
import type { CountDiscoveryReply } from "./count-discovery.ts";
import type { CountCauseDiscoveryReply } from "./count-causes.ts";
import type { CountInvestigationItem, CountInvestigationReply, CountReconciliationAvailableAction, CountReconciliationCursor, CountReconciliationListReply } from "./count-dashboard.ts";
import type { CountReconciliationDetail, CountReconciliationTarget } from "./count-reconciliation-detail.ts";
import type { CountReadData } from "./count-read-wire.ts";
import { parseCountManagementRequest, type CountManagementMutationAction, type CountManagementRequestMap } from "./count-management-schema.ts";
import { CountRecord } from "./CountRecord";

interface CountCorrectionWorkspaceProps {
  readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: CountClient; readonly operations: CountOperationController;
  readonly productId: string; readonly siteId: string;
}
export function CountCorrectionWorkspace({ sessions, identity, client, operations, productId, siteId }: CountCorrectionWorkspaceProps) {
  const [surface, setSurface] = useState<CountDiscoveryReply | null>(null), [cases, setCases] = useState<CountReconciliationListReply | null>(null);
  const [investigations, setInvestigations] = useState<CountInvestigationReply | null>(null), [eligible, setEligible] = useState<CountCauseDiscoveryReply | null>(null);
  const [detail, setDetail] = useState<CountReconciliationDetail | null>(null), [sourceCount, setSourceCount] = useState<CountReadData | null>(null);
  const [sourceTarget, setSourceTarget] = useState<CountReconciliationTarget | null>(null), [reviewedSources, setReviewedSources] = useState<readonly string[]>([]);
  const [quantity, setQuantity] = useState(""), [reason, setReason] = useState(""), [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [discard, setDiscard] = useState(false), [, revise] = useState(0);
  const [resolution, setResolution] = useState<CountInvestigationItem | null>(null), [postCountId, setPostCountId] = useState(""), [postCount, setPostCount] = useState<CountReadData | null>(null), [resolveAttest, setResolveAttest] = useState(false);
  const alive = useRef(true), inflight = useRef(false), attempted = useRef<string | null>(null);
  const dirty = quantity !== "" || reason !== "" || attest || reviewedSources.length > 0 || resolution !== null || postCountId !== "" || resolveAttest;
  const guard = useUnsavedChanges(dirty, "Your stock-correction draft or review has not been recorded. Leaving will discard it; pending saves remain recoverable.");
  useEffect(() => {
    alive.current = true;
    const change = () => { if (alive.current) revise(value => value + 1); };
    window.addEventListener("storage", change); window.addEventListener("focus", change);
    return () => { alive.current = false; window.removeEventListener("storage", change); window.removeEventListener("focus", change); };
  }, []);
  const active = () => alive.current && sessions.isCurrent(identity);
  const request = { schema_version: 1 as const, actor_id: identity.actorId, product_id: productId, site_id: siteId };
  let pending: ReturnType<CountOperationController["pending"]> = null, storageBlocked = false;
  try { pending = operations.pending(identity.actorId); } catch { storageBlocked = true; }
  const locked = busy || !!pending || storageBlocked;
  const supports = (action: CountDiscoveryReply["available_actions"][number]) => surface?.available_actions.includes(action) === true;
  function clearDraft() { setQuantity(""); setReason(""); setAttest(false); setReviewedSources([]); setSourceCount(null); setSourceTarget(null); setResolution(null); setPostCountId(""); setPostCount(null); setResolveAttest(false); }
  async function run(work: () => Promise<void>) {
    if (inflight.current || !active()) return;
    inflight.current = true; setBusy(true); setMessage("");
    try { await work(); }
    catch { if (active()) setMessage("The result could not be confirmed. Recover any pending action before continuing."); }
    finally { inflight.current = false; if (active()) { setBusy(false); revise(value => value + 1); } }
  }
  async function loadCases(cursor: CountReconciliationCursor | null = null) {
    const value = await client.reconciliations({ ...request, cursor, page_size: 25 }, identity);
    if (active()) { setCases(value); setDetail(null); }
  }
  async function load() {
    if (dirty) return;
    clearDraft();
    const current = await client.discover({ ...request, cursor: null, page_size: 100 }, identity);
    if (!active()) return;
    setSurface(current); setEligible(null); setDetail(null); setSourceCount(null); setSourceTarget(null);
    if (!current.available_actions.includes("management_read")) { setMessage("The stock-correction workflow is not enabled in this backend."); return; }
    await loadCases();
    if (current.capabilities.manage || current.capabilities.cause_resolve) {
      const value = await client.investigations({ ...request, cursor: null, page_size: 100 }, identity);
      if (active()) setInvestigations(value);
    }
  }
  async function openCase(reconciliationId: string) {
    if (dirty) return;
    const value = await client.reconciliationDetail({ ...request, reconciliation_id: reconciliationId }, identity);
    if (active()) { setDetail(value.data); setEligible(null); setSourceCount(null); setSourceTarget(null); clearDraft(); }
  }
  async function readSource(target: CountReconciliationTarget) {
    const value = await client.read({ schema_version: 1, actor_id: identity.actorId, count_id: target.source_count_id }, identity), data = value.data;
    if (data.product.id !== productId || data.site.id !== siteId || data.history_state !== "variance" || data.terminal?.kind !== "outcome" ||
      data.terminal.id !== target.source_outcome_id || !data.statements || !data.comparison) throw new Error("Source count does not match this correction.");
    if (active()) { setSourceCount(data); setSourceTarget(target); }
  }
  async function save<K extends CountManagementMutationAction>(action: K, input: CountManagementRequestMap[K]) {
    const parsed = parseCountManagementRequest(action, input); attempted.current = parsed.operation_id;
    const saved = await operations.manage(action, parsed, detail ? { schema_version: 1, state: "available", data: detail.summary } : null, identity);
    if (!active()) return;
    const labels = { reconciliation_prepare: "Correction prepared", reconciliation_approve: "Correction approved", reconciliation_execute: "Stock correction applied", reconciliation_confirm: "Independent confirmation recorded", cause_resolve: "Investigation resolved" };
    clearDraft(); setDetail(null); setEligible(null); setMessage(`${labels[saved.data.receipt.action]}. Reload the case list for the next step.`);
  }
  const currentCase = detail ? cases?.items.find(item => item.reconciliation_id === detail.summary.reconciliation_id && item.preparation_id === detail.summary.preparation_id &&
    item.history_state === detail.summary.history_state && item.current_state === detail.summary.current_state && item.approval_id === detail.summary.approval_id && item.execution_id === detail.summary.execution_id) : null;
  const actions = currentCase?.available_actions ?? [];
  const targets = resolution ? [] : detail?.target_causes ?? (eligible?.state === "eligible" ? eligible.data.causes ?? [] : []);
  const allReviewed = targets.length > 0 && targets.every(target => reviewedSources.includes(target.cause_id));
  const meaning = resolution ? null : detail?.meaning ?? eligible?.data.meaning;
  async function prepare() {
    if (locked || resolution || !attest || !allReviewed || eligible?.state !== "eligible" || !eligible.data.footprint || !surface?.capabilities.reconciliation_prepare || !supports("reconciliation_prepare")) return;
    let value: CountManagementRequestMap["reconciliation_prepare"];
    try { value = parseCountManagementRequest("reconciliation_prepare", { ...request, operation_id: crypto.randomUUID(), reconciliation_id: crypto.randomUUID(), preparation_id: crypto.randomUUID(),
      parent_action_id: crypto.randomUUID(), target_cause_ids: eligible.data.causes!.map(cause => cause.cause_id), lot_id: eligible.data.footprint.lot_id, quantity_delta: quantity, reason }); }
    catch { setMessage("Enter a nonzero signed stock change with up to three decimal places and a clean, nonblank reason."); return; }
    await save("reconciliation_prepare", value);
  }
  async function act(action: CountReconciliationAvailableAction) {
    if (!detail || resolution || locked || !attest || !allReviewed || !actions.includes(action) || detail.summary.current_state !== "current") return;
    const data = detail.summary, operation_id = crypto.randomUUID();
    if (action === "reconciliation_approve") await save(action, { ...request, operation_id, preparation_id: data.preparation_id, approval_id: crypto.randomUUID() });
    else if (action === "reconciliation_execute" && data.approval_id) await save(action, { ...request, operation_id, preparation_id: data.preparation_id, approval_id: data.approval_id, execution_id: crypto.randomUUID() });
    else if (action === "reconciliation_confirm" && data.execution_id) await save(action, { ...request, operation_id, execution_id: data.execution_id, confirmation_id: crypto.randomUUID() });
  }
  async function beginResolution(item: CountInvestigationItem) {
    if (dirty || !surface?.capabilities.cause_resolve || !supports("cause_resolve")) return;
    const value = await client.read({ schema_version: 1, actor_id: identity.actorId, count_id: item.source_count_id }, identity);
    if (value.data.product.id !== productId || value.data.site.id !== siteId) throw new Error("Investigation scope changed.");
    if (active()) { setResolution(item); setSourceCount(value.data); setSourceTarget(null); setEligible(null); setPostCountId(""); setPostCount(null); setResolveAttest(false); }
  }
  async function readPostCount() {
    if (!resolution || !surface?.counts.some(item => item.count_id === postCountId && item.history_state === "agreement")) return;
    const value = await client.read({ schema_version: 1, actor_id: identity.actorId, count_id: postCountId }, identity), data = value.data;
    if (data.product.id !== productId || data.site.id !== siteId || data.count_id === resolution.source_count_id || data.history_state !== "agreement" ||
      data.current_boundary_state !== "unchanged" || !data.statements || data.comparison?.agreement !== true || data.captured_at <= resolution.recorded_at)
      throw new Error("A newer, current agreeing count is required.");
    if (active()) { setPostCount(data); setResolveAttest(false); }
  }
  async function olderCountCandidates() {
    if (locked || !resolution || !surface?.has_more || !surface.next_cursor || postCountId || postCount || resolveAttest) return;
    const page = await client.discover({ ...request, cursor: surface.next_cursor, page_size: 100 }, identity);
    if (active()) { setSurface(page); setPostCountId(""); setPostCount(null); setResolveAttest(false); }
  }
  async function resolve() {
    if (locked || !resolution || !postCount || !resolveAttest || !surface?.capabilities.cause_resolve || !supports("cause_resolve")) return;
    const summary = detail?.summary;
    const evidence = resolution.history_state === "variance" ? summary?.history_state === "confirmed" && summary.confirmation_id && summary.target_cause_ids.includes(resolution.cause_id)
      ? { kind: "reconciled_available" as const, confirmation_id: summary.confirmation_id, post_count_id: postCount.count_id } : null
      : resolution.history_state === "stale" || resolution.history_state === "cancelled" ? { kind: "fresh_agreement" as const, post_count_id: postCount.count_id } : null;
    if (!evidence) { setMessage("Open the confirmed correction for this variance, or use a supported stale/cancelled investigation. Stock remains held until verified resolution."); return; }
    await save("cause_resolve", { ...request, operation_id: crypto.randomUUID(), resolution_id: crypto.randomUUID(), cause_id: resolution.cause_id, evidence });
  }
  const actionLabels = { management_read: "Read correction", reconciliation_approve: "Approve this correction", reconciliation_execute: "Apply approved stock correction", reconciliation_confirm: "Record independent confirmation" };
  return <section className="min-w-0 space-y-5" aria-label="Stock discrepancies and corrections">
    {guard}
    <header className="space-y-2"><h2 className="font-display text-xl">Stock discrepancies and corrections</h2><p className="text-sm text-muted-foreground">Review the original counts and proposed correction. Approval, stock execution, independent confirmation, and closing an investigation are separate actions.</p></header>
    {message && <p role="status">{message}</p>}
    {storageBlocked && <p role="alert" className="text-destructive">The pending-operation record cannot be read. Preserve this browser’s data and ask for recovery assistance.</p>}
    {pending && <section className="space-y-3 rounded-xl border p-4" aria-label="Pending correction recovery"><h3 className="font-medium">Check the previous action</h3>
      <p className="text-sm">Check or close the original attempt before recording another action. Closing preserves an existing save or prevents that attempt from saving later.</p>
      <div className="flex flex-wrap gap-2">{(["read", "close"] as const).map(mode => <Button key={mode} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(async () => {
        const value = await operations.recover(mode, identity);
        if (!active()) return;
        if (value.state !== "pending" && value.operation_id === attempted.current) { clearDraft(); setDetail(null); setEligible(null); attempted.current = null; }
        setMessage(value.state === "pending" ? "No saved receipt yet. Check again or close the original attempt." : value.state === "saved" ? "The original action is recorded. Reload the case list." : "The original attempt is closed without a save.");
      })}>{mode === "read" ? "Check original action" : "Close pending attempt"}</Button>)}</div>
    </section>}
    <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy || dirty} onClick={() => void run(load)}>Load stock reviews</Button>
      {dirty && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setDiscard(true)}>Discard this review draft</Button>}</div>
    {investigations && <section className="space-y-3" aria-label="Open stock investigations"><h3 className="font-medium">Open investigations</h3>
      {investigations.other_scope_causes && <p role="status" className="text-sm">Other sites also have open investigations. This site’s list is not the complete product investigation set.</p>}
      {!investigations.items.length && <p className="text-sm text-muted-foreground">No open investigations at this site.</p>}
      <ul className="space-y-2">{investigations.items.map(item => <li key={item.cause_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><span className="text-sm">{new Date(item.recorded_at).toLocaleString()} · {item.history_state}</span>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || dirty} onClick={() => void run(async () => {
          const value = await client.read({ schema_version: 1, actor_id: identity.actorId, count_id: item.source_count_id }, identity);
          if (value.data.product.id !== productId || value.data.site.id !== siteId) throw new Error("Source scope differs.");
          if (active()) { setSourceCount(value.data); setSourceTarget(null); }
        })}>Read source count</Button>
        {surface?.capabilities.cause_resolve && supports("cause_resolve") && <Button type="button" variant="outline" className="min-h-11" disabled={locked || dirty} onClick={() => void run(() => beginResolution(item))}>Review resolution evidence</Button>}
      </li>)}</ul>
    </section>}
    {cases && <section className="space-y-3" aria-label="Recorded correction cases"><h3 className="font-medium">Correction cases</h3>
      {!cases.items.length && <p className="text-sm text-muted-foreground">No recorded correction cases.</p>}
      <ul className="space-y-2">{cases.items.map(item => <li key={item.reconciliation_id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-words text-sm">{item.recorder_name} · {new Date(item.prepared_at).toLocaleString()}</p><p className="text-sm text-muted-foreground">{item.history_state} · {item.current_state}</p></div>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || dirty} onClick={() => void run(() => openCase(item.reconciliation_id))}>Open correction</Button></li>)}</ul>
      {cases.has_more && <Button type="button" variant="outline" className="min-h-11" disabled={busy || dirty} onClick={() => void run(() => loadCases(cases.next_cursor))}>Older correction cases</Button>}
    </section>}
    {surface?.capabilities.reconciliation_prepare && supports("reconciliation_prepare") && <Button type="button" variant="outline" className="min-h-11" disabled={locked || dirty} onClick={() => void run(async () => {
      const value = await client.causes(request, identity);
      if (active()) { clearDraft(); setEligible(value); setDetail(null); }
    })}>Check eligibility for a new correction</Button>}
    {eligible?.state === "blocked" && <p role="status">These discrepancies require further investigation. Stock remains held; no correction is prepared.</p>}
    {eligible?.state === "empty" && <p role="status">No open discrepancies are eligible for this correction workflow.</p>}
    {detail && <section className="space-y-3 rounded-xl border p-4" aria-label="Proposed stock correction"><h3 className="font-display text-lg">Recorded correction proposal</h3>
      <p className="text-sm">Prepared by {detail.recorder_name} · {detail.summary.history_state} · {detail.summary.current_state}</p>
      <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-3"><div className="min-w-0"><dt className="text-muted-foreground">Recorded balance before correction</dt><dd className="break-words">{detail.before_quantity} {detail.stock_unit}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Requested change</dt><dd className="break-words">{detail.summary.quantity_delta} {detail.stock_unit}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Proposed balance after execution</dt><dd className="break-words">{detail.proposed_after_quantity} {detail.stock_unit}</dd></div></dl>
      <p className="whitespace-pre-wrap break-words text-sm">{detail.summary.reason}</p><p className="text-xs text-muted-foreground">The proposed balance is not an observed physical count. Original validity limit: {new Date(detail.summary.parent_expires_at).toLocaleString()}.</p>
    </section>}
    {targets.length > 0 && <section className="space-y-3" aria-label="Counts supporting this correction"><h3 className="font-medium">Read every source count</h3>
      <p className="text-sm text-muted-foreground">The complete source set stays together. No discrepancy is silently omitted.</p><ul className="space-y-2">{targets.map((target, index) => <li key={target.cause_id} className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(() => readSource(target))}>Read source count {index + 1}</Button><span className="text-sm">{reviewedSources.includes(target.cause_id) ? "Reviewed" : "Review needed"}</span></li>)}</ul>
    </section>}
    {sourceCount && <CountRecord data={sourceCount} refreshing={busy} onRefresh={() => { if (sourceTarget) void run(() => readSource(sourceTarget)); }} locked={!sourceTarget} />}
    {sourceTarget && sourceCount && <Button type="button" variant="outline" className="min-h-11" disabled={locked || reviewedSources.includes(sourceTarget.cause_id)} onClick={() => { setReviewedSources(values => values.includes(sourceTarget.cause_id) ? values : [...values, sourceTarget.cause_id]); setAttest(false); }}>I reviewed this source count</Button>}
    {eligible?.state === "eligible" && <div className="grid gap-3 rounded-xl border p-4"><h3 className="font-display text-lg">Prepare a stock correction</h3>
      <Label htmlFor="correction-delta">Signed quantity change ({eligible.data.footprint?.stock_unit})</Label><Input id="correction-delta" inputMode="decimal" autoComplete="off" maxLength={16} disabled={locked} value={quantity} onChange={event => { setQuantity(event.target.value); setAttest(false); }} />
      <p className="text-xs text-muted-foreground">Enter a positive or negative change deliberately. No adjustment is calculated or prefilled.</p>
      <Label htmlFor="correction-reason">Reason for this correction</Label><Textarea id="correction-reason" disabled={locked} value={reason} maxLength={4000} onChange={event => { setReason(event.target.value); setAttest(false); }} />
    </div>}
    {meaning && <section className="space-y-3 rounded-xl border p-4" aria-label="Correction confirmation wording"><h3 className="font-medium">Confirmation wording · {meaning.version}</h3><p className="whitespace-pre-wrap break-words text-sm">{meaning.text}</p>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" disabled={locked || !allReviewed} checked={attest} onChange={event => setAttest(event.target.checked)} /><span>I reviewed every source count, the proposed change, and the confirmation wording.</span></label>
      {eligible?.state === "eligible" && <Button type="button" className="min-h-11" disabled={locked || !allReviewed || !attest || !quantity || !reason} onClick={() => void run(prepare)}>Prepare correction for independent approval</Button>}
      {detail && <div className="flex flex-wrap gap-2">{actions.filter(action => action !== "management_read").map(action => <Button key={action} type="button" className="min-h-11" disabled={locked || !allReviewed || !attest || detail.summary.current_state !== "current"} onClick={() => void run(() => act(action))}>{actionLabels[action]}</Button>)}</div>}
    </section>}
    {resolution && <section className="space-y-4 rounded-xl border p-4" aria-label="Resolve stock investigation"><h3 className="font-display text-lg">Review fresh count evidence</h3>
      <p className="text-sm">Choose a genuinely newer agreeing count at this medication and site. The server also checks observation ages, clean source evidence, and any required confirmed correction. Unsupported conditions remain held.</p>
      {resolution.history_state === "variance" && (!detail || detail.summary.history_state !== "confirmed" || !detail.summary.target_cause_ids.includes(resolution.cause_id)) && <p role="status" className="text-sm">Open the confirmed correction for this variance before resolving it.</p>}
      <div className="grid gap-1"><Label htmlFor="resolution-postcount">New agreeing count</Label><select id="resolution-postcount" className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={postCountId} disabled={locked} onChange={event => { setPostCountId(event.target.value); setPostCount(null); setResolveAttest(false); }}>
        <option value="">Choose a fresh agreeing count</option>{surface?.counts.filter(item => item.history_state === "agreement" && item.count_id !== resolution.source_count_id && item.captured_at > resolution.recorded_at).map(item => <option key={item.count_id} value={item.count_id}>{new Date(item.captured_at).toLocaleString()} · {item.participants.map(person => person.name).join(" and ")}</option>)}
      </select></div>
      {surface?.has_more && <div className="space-y-2"><p className="text-sm text-muted-foreground">More count history is available. Clear any selected count before changing pages.</p><Button type="button" variant="outline" className="min-h-11" disabled={locked || !!postCountId || !!postCount || resolveAttest} onClick={() => void run(olderCountCandidates)}>Earlier count candidates</Button></div>}
      <Button type="button" variant="outline" className="min-h-11" disabled={locked || !postCountId} onClick={() => void run(readPostCount)}>Read selected fresh count</Button>
      {postCount && <CountRecord data={postCount} refreshing={busy} onRefresh={() => void run(readPostCount)} />}
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={resolveAttest} disabled={locked || !postCount} onChange={event => setResolveAttest(event.target.checked)} /><span>I reviewed the source count’s available information and the new agreeing count. This request does not supply a missing physical observation.</span></label>
      <Button type="button" className="min-h-11" disabled={locked || !postCount || !resolveAttest} onClick={() => void run(resolve)}>Request verified investigation resolution</Button>
    </section>}
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this correction draft?</AlertDialogTitle><AlertDialogDescription>Your unrecorded reason, quantity, and review confirmations will be cleared. Recorded actions and pending recovery remain available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep reviewing</AlertDialogCancel><AlertDialogAction onClick={() => { clearDraft(); setDiscard(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
