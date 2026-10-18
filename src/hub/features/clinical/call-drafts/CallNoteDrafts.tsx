import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Tables } from "@/integrations/supabase/types";
import { callNoteIntentSchema, callNoteReserveSchema, callNoteReviewRequestSchema, type CallNoteProcessingRead } from "../../../../../supabase/functions/_shared/clinical-call-note-processing-model.ts";
import { callFeedback, type CallSource } from "./model";
import { callNoteReviewAction, cancelCallNote, cancelCallNoteAttempt, latestCallEncounter, processCallNote, readCallNote, readCallNotes, reserveCallNote } from "./note-api";
import { callNoteAttemptActive, callNoteRetryReasons, callNoteStorageKey, verifyPendingCallNote, type PendingCallNote } from "./note-pending";
import { CallNotePolicy } from "./CallNotePolicy";
import { CallNoteReview } from "./CallNoteReview";
interface CallNoteDraftsProps {
  actor: string; encounter: Tables<"clinical_encounters">; source: CallSource; blocked: boolean;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
  onAccepted: (row: Tables<"clinical_encounters">) => void;
}
export function CallNoteDrafts({ actor, encounter, source, blocked, onDirtyChange, onBusyChange, onAccepted }: CallNoteDraftsProps) {
  const prefix = useId(), mounted = useRef(true), lock = useRef(false), exactReview = useRef<z.infer<typeof callNoteReviewRequestSchema> | null>(null);
  const key = callNoteStorageKey(actor, encounter.pet_id, encounter.id);
  const [stored] = useState(() => { try { const raw = sessionStorage.getItem(key); return { value: raw ? verifyPendingCallNote(JSON.parse(raw), actor, encounter.pet_id, encounter.id, source.id) : null, invalid: false }; } catch { return { value: null, invalid: true }; } });
  const [pending, setPending] = useState<PendingCallNote | null>(stored.value), [invalid, setInvalid] = useState(stored.invalid), [recoveryReviewed, setRecoveryReviewed] = useState(!stored.invalid);
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof readCallNotes>> | null>(null), [job, setJob] = useState<CallNoteProcessingRead | null>(null);
  const [template, setTemplate] = useState(""), [authorized, setAuthorized] = useState(false), [cost, setCost] = useState(false), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState("");
  const [policyDirty, setPolicyDirty] = useState(false), [policyBusy, setPolicyBusy] = useState(false), [reviewDirty, setReviewDirty] = useState(false);
  const localDirty = !!template || authorized || cost || !!reason;
  const activeAttempt = job?.attempts.some(callNoteAttemptActive) ?? false;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(localDirty || busy || !!pending || invalid || !recoveryReviewed || policyDirty || policyBusy || reviewDirty || activeAttempt); return () => onDirtyChange(false); }, [localDirty, busy, pending, invalid, recoveryReviewed, policyDirty, policyBusy, reviewDirty, activeAttempt, onDirtyChange]);
  useEffect(() => { onBusyChange(busy || policyBusy); return () => onBusyChange(false); }, [busy, policyBusy, onBusyChange]);
  useEffect(() => {
    let valid = true; setLoading(true); setError(null);
    readCallNotes(actor, encounter.pet_id, encounter.id, source.id).then((value) => { if (valid) setWorkspace(value); }).catch((failure) => { if (valid) { setError(failure); setWorkspace(null); } }).finally(() => { if (valid) setLoading(false); });
    return () => { valid = false; };
  }, [actor, encounter.pet_id, encounter.id, encounter.version, source.id]);
  function persist(value: PendingCallNote | null) { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); setPending(value); }
  function clearForm() { setTemplate(""); setAuthorized(false); setCost(false); setReason(""); }
  function checkDestination(value: CallNoteProcessingRead) {
    if (value.job.pet_id !== encounter.pet_id || value.job.encounter_id !== encounter.id || value.source.id !== source.id) throw Error("Call draft destination differs.");
    return value;
  }
  async function refresh() {
    const value = await readCallNotes(actor, encounter.pet_id, encounter.id, source.id);
    if (mounted.current) setWorkspace(value);
  }
  async function adopt(value: CallNoteProcessingRead) {
    checkDestination(value);
    if (!mounted.current) return;
    setJob(value); await refresh();
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNotice("");
    try { await action(); } catch (failure) { if (mounted.current) setError(failure); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const base = { actor, pet: encounter.pet_id, encounter: encounter.id, source: source.id };
  const selected = workspace?.templates.find((item) => item.id === template && !item.retired && item.approved);
  const policiesApproved = workspace?.note_policy.status === "approved" && workspace.call_generation_policy.status === "approved" && workspace.capture_policy.status === "approved";
  const disabled = blocked || busy || loading || policyDirty || policyBusy || reviewDirty || !!pending || invalid || !recoveryReviewed || !workspace;
  const canGenerate = !disabled && !activeAttempt && !job?.proposal && encounter.status === "draft" && job?.job.expected_version === encounter.version && policiesApproved && job?.job.actor_id === actor && job.template.status === "approved" && workspace?.note_policy.version === job.job.policy_version && workspace.call_generation_policy.version === job.binding.call_generation_policy_version && workspace.capture_policy.version === job.binding.source_capture_policy_version;
  async function reserve() {
    if (disabled || !selected?.approved || !workspace || !authorized || !policiesApproved || source.encounter_id !== encounter.id || encounter.status !== "draft") return;
    const request = callNoteReserveSchema.parse({ source_id: source.id, expected_version: encounter.version, template_id: selected.id, template_version: selected.approved.version, template_hash: selected.approved.sha256, note_policy_version: workspace.note_policy.version, call_generation_policy_version: workspace.call_generation_policy.version, attest_authorized: true });
    const action: PendingCallNote = { ...base, kind: "reserve", id: crypto.randomUUID(), request };
    await run(async () => { persist(action); await adopt(await reserveCallNote(actor, action.id, request)); if (!mounted.current) return; persist(null); clearForm(); setNotice("Private call source and approved template pinned. Generation requires a separate explicit action and backend activation."); });
  }
  async function generate() {
    if (!canGenerate || !job || !cost) return;
    const previous = job.attempts[0];
    if (previous && !Object.prototype.hasOwnProperty.call(callNoteRetryReasons, reason)) { setNotice("Review the previous outcome and select a retry reason before authorizing a new attempt."); return; }
    const intent = callNoteIntentSchema.parse({ job_id: job.job.id, attempt_id: crypto.randomUUID(), retry_of: previous?.id ?? null, reason: previous ? reason : "", ack_cost: previous ? cost : false });
    const action = verifyPendingCallNote({ ...base, kind: "generate", id: job.job.id, intent }, actor, encounter.pet_id, encounter.id, source.id);
    await run(async () => { persist(action); await adopt(await processCallNote(intent)); if (!mounted.current) return; persist(null); setCost(false); setReason(""); setNotice("Original generation outcome confirmed. Review all retained claims before accepting any chart text."); });
  }
  async function finishReview(result: NonNullable<Awaited<ReturnType<typeof callNoteReviewAction>>>, expectedJob: string) {
    if (!result.receipt) throw Error("Review receipt not found.");
    const receipt = result.receipt;
    if (receipt.job_id !== expectedJob) throw Error("Call review receipt differs.");
    const current = await readCallNote(actor, expectedJob, encounter.pet_id, encounter.id, source.id);
    if (current.proposal?.id !== receipt.proposal_id || current.review?.id !== receipt.review.id) throw Error("Retained call review differs from its action receipt.");
    if (!mounted.current) return;
    if (receipt.encounter) {
      if (receipt.encounter.id !== encounter.id || receipt.encounter.pet_id !== encounter.pet_id) throw Error("Accepted encounter differs.");
      const latest = await latestCallEncounter(encounter.pet_id, encounter.id);
      if (!mounted.current) return;
      onAccepted(latest as Tables<"clinical_encounters">);
    }
    await adopt(current);
    if (!mounted.current) return;
    persist(null); exactReview.current = null; clearForm(); setNotice(receipt.review.decision === "accepted" ? "Selected reviewed sections saved once. The current encounter was loaded; review and sign separately." : "Private call draft rejected. The encounter was unchanged.");
  }
  async function review(request: z.infer<typeof callNoteReviewRequestSchema>) {
    if (blocked || busy || pending || !job || invalid || policyDirty || policyBusy) return;
    const action: PendingCallNote = { ...base, kind: "review", id: crypto.randomUUID(), job: job.job.id };
    exactReview.current = request;
    await run(async () => { persist(action); const result = await callNoteReviewAction(actor, action.id, action.job, "save", request); if (!mounted.current) return; if (!result) throw Error(); await finishReview(result, action.job); });
  }
  async function recover(mode: "recover" | "retry" | "cancel") {
    if (!pending || invalid) return;
    const action = pending;
    await run(async () => {
      if (action.kind === "review") {
        let result = await callNoteReviewAction(actor, action.id, action.job, "recover");
        if (!result && mode === "cancel") result = await callNoteReviewAction(actor, action.id, action.job, "cancel");
        else if (!result && mode === "retry" && exactReview.current && !blocked) result = await callNoteReviewAction(actor, action.id, action.job, "save", exactReview.current);
        if (!mounted.current) return;
        if (result?.receipt) { await finishReview(result, action.job); return; }
        if (result?.cancelled) { persist(null); exactReview.current = null; setNotice("Uncommitted call review action durably canceled. Review wording before another action."); return; }
        setNotice("No committed review receipt found. Recover or cancel the original action before editing; reviewed text is never stored in recovery storage."); return;
      }
      if (mode === "cancel") {
        const result = action.kind === "reserve" ? await cancelCallNote(actor, action.id) : await cancelCallNoteAttempt(actor, action.intent);
        if (!mounted.current) return;
        if (result.job) await adopt(result.job);
        if (result.cancelled || (result.job && (result.job.proposal || !result.job.attempts.some(callNoteAttemptActive)))) { persist(null); clearForm(); setNotice("Original action reached a known state. Cancellation never deletes retained evidence or reverses provider work."); }
        else setNotice("The original attempt may have reached the provider. Its recovery identity is retained.");
        return;
      }
      const value = action.kind === "reserve" && mode === "retry" && !blocked ? await reserveCallNote(actor, action.id, action.request) : action.kind === "generate" && mode === "retry" && !blocked ? await processCallNote(action.intent) : await readCallNote(actor, action.id, encounter.pet_id, encounter.id, source.id);
      await adopt(value); if (!mounted.current) return;
      const attempt = action.kind === "generate" ? value.attempts.find((item) => item.id === action.intent.attempt_id) : null;
      if (action.kind === "generate" && (!attempt || callNoteAttemptActive(attempt))) { setNotice("The original generation attempt remains unconfirmed or active. Recover again; no new provider request was started by recovery."); return; }
      persist(null); clearForm(); setNotice("Original private call action recovered. Review its retained outcome before another action.");
    });
  }
  async function selectJob(id: string) {
    if (disabled || activeAttempt || (localDirty && !window.confirm("Discard unsaved call-generation choices?"))) return;
    await run(async () => { await adopt(await readCallNote(actor, id, encounter.pet_id, encounter.id, source.id)); if (mounted.current) clearForm(); });
  }
  return <section aria-label="Private call generation and review" className="min-w-0 space-y-4 rounded-lg border border-border p-3">
    <h4 className="font-display text-lg">Private call draft generation</h4>
    <p className="text-sm text-muted-foreground">Pin this retained call and an approved template, explicitly start generation, then review proposed SOAP text. New generation and chart acceptance remain separate actions. Backend processing starts off.</p>
    {loading && <p role="status">Loading private call drafting settings…</p>}{error && <p role="alert" className="text-sm text-destructive">{callFeedback(error)}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {!workspace && !loading && <Button variant="outline" disabled={busy || policyBusy} onClick={() => void run(refresh)}>Retry private call drafting settings</Button>}
    {busy && <p role="status" className="text-sm">Confirming original private call action…</p>}
    {invalid && <><p role="alert" className="text-sm text-destructive">Stored call drafting recovery identifiers are invalid. No new work can start until this local state is resolved.</p><Button variant="outline" disabled={busy} onClick={() => { if (!window.confirm("Discard invalid local call drafting recovery data? This does not cancel remote work. Review outstanding actions and retained history first.")) return; try { sessionStorage.removeItem(key); setInvalid(false); setRecoveryReviewed(false); } catch (failure) { setError(failure); } }}>Discard invalid local call drafting recovery data</Button></>}
    {!recoveryReviewed && !invalid && <Button variant="outline" disabled={busy} onClick={() => setRecoveryReviewed(true)}>I reviewed retained call drafts and outstanding actions</Button>}
    {pending && <section aria-label="Unconfirmed private call draft action" className="space-y-2"><p className="text-sm">Original {pending.kind} action remains recoverable. Only identifiers and versions are saved in this tab; call text and clinical edits are not.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || policyBusy} onClick={() => void recover("recover")}>Recover original call draft action</Button>{(pending.kind !== "review" || exactReview.current) && <Button variant="outline" disabled={blocked || busy || policyBusy} onClick={() => void recover("retry")}>Retry exact call draft action</Button>}<Button variant="outline" disabled={busy || policyBusy} onClick={() => void recover("cancel")}>Cancel undispatched call draft action</Button></div></section>}
    {workspace && <CallNotePolicy actor={actor} policy={workspace.call_generation_policy} blocked={blocked || busy || !!pending || reviewDirty || activeAttempt} onChanged={(policy) => setWorkspace((current) => current ? { ...current, call_generation_policy: policy } : current)} onDirtyChange={setPolicyDirty} onBusyChange={setPolicyBusy} />}
    {!policiesApproved && workspace && <p role="status" className="text-sm">Call capture, general note and independent call-generation policies must all be approved before new generation. Retained private evidence remains reviewable.</p>}
    {source.encounter_id !== encounter.id && <p className="text-sm">This retained source belongs to another saved encounter. Open that exact encounter to create a call draft.</p>}
    <fieldset disabled={disabled || !policiesApproved || activeAttempt || source.encounter_id !== encounter.id || encounter.status !== "draft"} className="min-w-0 space-y-3"><legend className="font-medium">Pin source and template</legend><Label htmlFor={`${prefix}-template`}>Approved call drafting template</Label><select id={`${prefix}-template`} className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={template} onChange={(event) => { setTemplate(event.target.value); setAuthorized(false); }}><option value="">Choose a template explicitly</option>{workspace?.templates.filter((item) => !item.retired && item.approved).map((item) => <option key={item.id} value={item.id}>{item.approved!.definition.name} · v{item.approved!.version}</option>)}</select><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />I confirm this exact call, selected patient and unsigned encounter are authorized for AI drafting under the approved policies.</label><Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!selected || !authorized} onClick={() => void reserve()}>Pin private call draft source</Button></fieldset>
    {localDirty && !pending && <Button variant="outline" disabled={busy || policyBusy} onClick={clearForm}>Discard unsaved call-generation choices</Button>}
    <section aria-label="Retained private call draft jobs" className="space-y-2"><h5 className="font-medium">Private drafting history for this call and encounter</h5><div className="flex flex-wrap gap-2">{workspace?.jobs.map((item) => <Button key={item.id} variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled || activeAttempt} onClick={() => void selectJob(item.id)}>{item.created_at} · {item.proposal_id ? "Draft available" : "Source pinned"}</Button>)}</div>{workspace?.has_more && <p className="text-xs text-muted-foreground">Showing 10 recent jobs. Earlier private history remains retained.</p>}</section>
    {job && <section aria-label="Selected private call drafting job" className="min-w-0 space-y-3"><p className="break-words text-sm">Pinned {job.template.definition.name} · template v{job.template.version} · selected patient {job.patient.name}. Source and template remain retained even if current approvals change.</p><details><summary className="min-h-11 cursor-pointer text-sm font-medium">Original processing attempts</summary>{job.attempts.map((attempt) => <p key={attempt.id} className="break-words text-sm">{attempt.created_at} · {attempt.state}{attempt.lease_until ? ` · lease ${attempt.lease_until}` : ""}</p>)}</details>
      {!job.proposal && <fieldset disabled={!canGenerate} className="space-y-3"><legend className="font-medium">Explicit generation</legend>{!!job.attempts.length && <><Label htmlFor={`${prefix}-retry`}>Reviewed reason for a new attempt</Label><select id={`${prefix}-retry`} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Choose after reviewing the previous outcome</option>{Object.entries(callNoteRetryReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></>}<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cost} onChange={(event) => setCost(event.target.checked)} />I authorize this explicit AI request and its provider cost{job.attempts.length ? ", including a possible duplicate charge if the previous outcome is uncertain" : ""}.</label><Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!cost || (!!job.attempts.length && !reason)} onClick={() => void generate()}>Generate private call draft</Button></fieldset>}
      {activeAttempt && !pending && <Button variant="outline" disabled={busy || policyBusy} onClick={() => void run(async () => { await adopt(await readCallNote(actor, job.job.id, encounter.pet_id, encounter.id, source.id)); })}>Refresh original generation outcome</Button>}
      {job.proposal && <CallNoteReview key={`${job.proposal.id}:${job.review?.id ?? "pending"}`} value={job} encounter={encounter} blocked={blocked || busy || !!pending || policyDirty || policyBusy || invalid} onDirtyChange={setReviewDirty} onReview={(request) => void review(request)} />}
    </section>}
  </section>;
}
