import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hub/contexts/auth-context";
import type { Tables } from "@/integrations/supabase/types";
import { formatDateTime } from "@/hub/features/patient-360/model";
import { CallSourcePolicy } from "./CallSourcePolicy";
import { CallSourcePreview } from "./CallSourcePreview";
import { captureCall, cancelCall, listCallCandidates, listCallSources, readCallPatient, readCallPolicy, readCallSource, recoverCall, reserveCall } from "./api";
import { callActionIsTerminal, callCaptureIntentSchema, callFeedback, summarizeCallSource, verifyPendingCall, type CallCaptureRead, type CallPolicy, type CallSource, type CallSourceSummary, type PendingCall, type callCandidateSchema } from "./model";
interface PatientCallDraftsProps {
  encounter: Tables<"clinical_encounters">;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}
export function PatientCallDrafts(props: PatientCallDraftsProps) {
  const { session, hasRole } = useAuth();
  return session && hasRole("ADMIN") ? <CallLauncher key={`${session.user.id}:${props.encounter.pet_id}:${props.encounter.id}`} {...props} actor={session.user.id} /> : null;
}
interface CallSessionProps extends PatientCallDraftsProps { actor: string }
function CallLauncher(props: CallSessionProps) {
  const [open, setOpen] = useState(false);
  return open ? <CallSession {...props} /> : <section aria-label="Call source actions" className="min-w-0 space-y-2 rounded-lg border border-border p-3">
    <h3 className="font-medium">Household call evidence</h3>
    <p className="text-sm text-muted-foreground">Administrators can explicitly select and inspect a private call transcript for this saved encounter.</p>
    <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={props.blocked} onClick={() => setOpen(true)}>Review household call sources</Button>
  </section>;
}
function CallSession({ actor, encounter, blocked, onDirtyChange, onBusyChange }: CallSessionProps) {
  const prefix = useId(), lock = useRef(false), mounted = useRef(true);
  const storageKey = `lrv:call-capture:${actor}:${encounter.pet_id}:${encounter.id}`;
  const [stored] = useState(() => {
    try { const raw = sessionStorage.getItem(storageKey); return { value: raw ? verifyPendingCall(JSON.parse(raw), actor, encounter.pet_id, encounter.id) : null, invalid: false }; }
    catch { return { value: null, invalid: true }; }
  });
  const [pending, setPending] = useState<PendingCall | null>(stored.value);
  const [invalidStorage, setInvalidStorage] = useState(stored.invalid), [recoveryReviewRequired, setRecoveryReviewRequired] = useState(false);
  const [policy, setPolicy] = useState<CallPolicy | null>(null), [patient, setPatient] = useState<Awaited<ReturnType<typeof readCallPatient>> | null>(null);
  const [calls, setCalls] = useState<z.infer<typeof callCandidateSchema>[]>([]), [history, setHistory] = useState<CallSourceSummary[]>([]);
  const [callsHaveMore, setCallsHaveMore] = useState(false), [historyHasMore, setHistoryHasMore] = useState(false);
  const [selected, setSelected] = useState(""), [mappingConfirmed, setMappingConfirmed] = useState(false), [authorized, setAuthorized] = useState(false);
  const [capture, setCapture] = useState<CallCaptureRead | null>(null), [source, setSource] = useState<CallSource | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [uncertain, setUncertain] = useState(!!stored.value);
  const [policyDirty, setPolicyDirty] = useState(false), [policyBusy, setPolicyBusy] = useState(false);
  const [error, setError] = useState<unknown>(null), [notice, setNotice] = useState("");
  const formDirty = !!selected || mappingConfirmed || authorized;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(formDirty || !!pending || busy || policyDirty || policyBusy || invalidStorage); return () => onDirtyChange(false); }, [formDirty, pending, busy, policyDirty, policyBusy, invalidStorage, onDirtyChange]);
  useEffect(() => { onBusyChange(busy || policyBusy); return () => onBusyChange(false); }, [busy, policyBusy, onBusyChange]);
  useEffect(() => {
    let valid = true;
    setLoading(true); setError(null); setSelected(""); setAuthorized(false); setMappingConfirmed(false);
    Promise.all([readCallPatient(encounter.pet_id), readCallPolicy(actor), listCallSources(actor, encounter.pet_id), encounter.status === "draft" ? listCallCandidates(actor, encounter.pet_id, encounter.id, encounter.version) : Promise.resolve(null)])
      .then(([identity, currentPolicy, sources, candidates]) => {
        if (!valid) return;
        if (candidates?.calls.some((call) => call.client_id !== identity.patient.client_id)) throw Error("Call household differs.");
        setPatient(identity); setPolicy(candidates?.policy ?? currentPolicy); setHistory(sources.sources); setCalls(candidates?.calls ?? []); setHistoryHasMore(sources.has_more); setCallsHaveMore(candidates?.has_more ?? false);
      })
      .catch((failure) => { if (valid) { setError(failure); setSource(null); setCapture(null); setPatient(null); setPolicy(null); setHistory([]); setCalls([]); setHistoryHasMore(false); setCallsHaveMore(false); } })
      .finally(() => { if (valid) setLoading(false); });
    return () => { valid = false; };
  }, [actor, encounter.pet_id, encounter.id, encounter.version, encounter.status]);
  function persist(value: PendingCall | null) { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); setPending(value); }
  function clearSelection() { setSelected(""); setAuthorized(false); setMappingConfirmed(false); }
  function acceptRead(value: CallCaptureRead) {
    setCapture(value); setUncertain(false); setPolicy(value.policy); setSource(value.source);
    if (callActionIsTerminal(value.action.state)) { persist(null); clearSelection(); }
    if (value.source) {
      const summary = summarizeCallSource(value.source);
      if (history.length >= 100 && !history.some((item) => item.id === summary.id)) setHistoryHasMore(true);
      setHistory((items) => [summary, ...items.filter((item) => item.id !== summary.id)].slice(0, 100));
    }
  }
  async function run(mode: "reserve" | "capture" | "recover" | "cancel") {
    if (lock.current || invalidStorage || ((mode === "reserve" || mode === "capture") && (blocked || policyDirty || policyBusy || recoveryReviewRequired))) return;
    let action = pending;
    if (!action && mode === "reserve") {
      const call = calls.find((item) => item.inbound_id === selected);
      if (!call || !patient || !policy || !mappingConfirmed || !authorized || encounter.status !== "draft" || patient.patient.archived_at || patient.patient.deceased_at || policy.status !== "approved" || call.client_id !== patient.patient.client_id) { setNotice("Confirm the household call, saved patient, unsigned encounter and approved call-source permission before reserving."); return; }
      action = { actor_id: actor, action_id: crypto.randomUUID(), request: callCaptureIntentSchema.parse({ pet_id: encounter.pet_id, expected_pet_version: patient.patient.version, encounter_id: encounter.id, expected_encounter_version: encounter.version, inbound_id: call.inbound_id, expected_inbound_version: call.inbound_version, policy_version: policy.version, attest_authorized: true }) };
    }
    if (!action || (mode === "capture" && (uncertain || capture?.action.state !== "pending"))) return;
    lock.current = true; setBusy(true); setError(null); setNotice("");
    try {
      persist(action);
      if (mode === "cancel") {
        const cancelled = await cancelCall(action);
        if (!mounted.current) return;
        if (cancelled.cancelled) { persist(null); setCapture(null); setSource(null); setUncertain(false); clearSelection(); setNotice("Original call reservation canceled. Its action identifier cannot be reused."); }
        else { acceptRead(await recoverCall(action)); setNotice("Capture already started or finished. Its original state was recovered; cancellation did not remove retained evidence."); }
      } else {
        const value = mode === "reserve" ? await reserveCall(action) : mode === "capture" ? await captureCall(action) : await recoverCall(action);
        if (!mounted.current) return;
        acceptRead(value);
        setNotice(value.action.state === "completed" ? "Complete call transcript captured privately. No AI or chart write occurred." : value.action.state === "failed" ? "The original capture failed. No usable transcript was retained; review its outcome before an explicitly new reservation." : value.action.state === "capturing" ? "Original capture is still in progress. Recover its state; no additional provider request will be started here." : "Original call reservation confirmed. Capture requires independent backend activation.");
      }
    } catch (failure) { if (mounted.current) { setError(failure); setSource(null); setCapture(null); setUncertain(true); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function openSource(id: string) {
    if (lock.current || pending || policyBusy) return;
    lock.current = true; setBusy(true); setError(null); setSource(null);
    try { const value = await readCallSource(actor, encounter.pet_id, id); if (mounted.current) setSource(value); }
    catch (failure) { if (mounted.current) setError(failure); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const selectedCall = calls.find((item) => item.inbound_id === selected);
  const captureBlocked = blocked || loading || busy || !!pending || policyDirty || policyBusy || invalidStorage || recoveryReviewRequired || encounter.status !== "draft" || !patient || !!patient.patient.archived_at || !!patient.patient.deceased_at || policy?.status !== "approved";
  return <section aria-label="Patient-linked call sources" className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 shadow-card">
    <h3 className="font-display text-lg">Patient-linked call sources</h3>
    <p className="text-sm text-muted-foreground">Administrator-only full-call evidence. Explicitly choose an assigned household call and confirm this patient and saved unsigned encounter. Capture preserves the transcript privately; AI call drafts and reviewed chart insertion are separate work.</p>
    {error && <p role="alert" className="text-sm text-destructive">{callFeedback(error)}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm">Loading authorized call sources…</p>}
    {busy && <p role="status" className="text-sm">Confirming original call-source action…</p>}
    {invalidStorage && <p role="alert" className="text-sm text-destructive">Stored call-capture recovery identifiers could not be validated. New capture remains blocked until this local state is resolved.</p>}
    {invalidStorage && <Button variant="outline" disabled={busy || policyBusy} onClick={() => { if (!window.confirm("Discard invalid local call recovery data? This does not cancel any remote capture. Review retained history and investigate outstanding actions before a new reservation.")) return; try { sessionStorage.removeItem(storageKey); setPending(null); setInvalidStorage(false); setRecoveryReviewRequired(true); setError(null); } catch (failure) { setError(failure); } }}>Discard invalid local call recovery data</Button>}
    {recoveryReviewRequired && <section aria-label="Call recovery review required" className="space-y-2"><p className="text-sm">Local recovery data was discarded; no remote action was canceled. Review retained sources below and investigate any outstanding capture before reserving again.</p><Button variant="outline" disabled={busy || policyBusy} onClick={() => setRecoveryReviewRequired(false)}>I reviewed retained sources and outstanding captures</Button></section>}
    {policy && <CallSourcePolicy actor={actor} policy={policy} blocked={blocked || busy || !!pending} onChanged={(value) => { setPolicy(value); setAuthorized(false); }} onDirtyChange={setPolicyDirty} onBusyChange={setPolicyBusy} />}
    {policy?.status !== "approved" && !loading && <p role="status" className="text-sm">Practice approval for call sources is pending. Existing clinician recording and typed-note approvals do not enable call capture.</p>}
    {encounter.status !== "draft" && <p className="text-sm">Choose a saved unsigned encounter before capturing a new call source. Retained private evidence can still be reviewed below.</p>}
    {patient && <section aria-label="Explicit call destination" className="min-w-0 space-y-2 rounded-md border border-border p-3">
      <h4 className="font-medium">Confirm destination</h4>
      <p className="break-words text-sm">Household: {patient.client.full_name} · patient: {patient.patient.name}</p>
      <p className="break-words text-sm">Encounter: {formatDateTime(encounter.visit_at)} (Denver) · {encounter.status} · version {encounter.version}</p>
      <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Destination audit details</summary><p className="break-all text-xs text-muted-foreground">Patient {encounter.pet_id} · household {patient.client.id} · encounter {encounter.id}</p></details>
    </section>}
    <fieldset disabled={captureBlocked} className="min-w-0 space-y-3"><legend className="font-medium">Select household call</legend>
      <Label htmlFor={`${prefix}-call`}>Assigned completed household call</Label>
      <select id={`${prefix}-call`} className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={selected} onChange={(event) => { setSelected(event.target.value); setAuthorized(false); setMappingConfirmed(false); }}><option value="">Choose a call explicitly</option>{calls.map((call) => <option key={call.inbound_id} value={call.inbound_id}>{formatDateTime(call.occurred_at)} (Denver) · household call {calls.indexOf(call) + 1}</option>)}</select>
      {selectedCall && <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Selected call audit details</summary><p className="break-all text-xs text-muted-foreground">Conversation {selectedCall.conversation_id} · assigned household {selectedCall.client_id} · call {selectedCall.call_uuid} · assignment version {selectedCall.inbound_version}</p></details>}
      {!calls.length && !loading && <p className="text-sm text-muted-foreground">No eligible completed transcript-ready call was returned for this household and encounter. Unmatched calls need assignment in Messages first.</p>}
      {callsHaveMore && <p className="text-sm text-muted-foreground">Only the 100 most recent eligible calls are shown. Older calls are not included in this selection.</p>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={mappingConfirmed} onChange={(event) => setMappingConfirmed(event.target.checked)} />I explicitly confirm this household call belongs with {patient?.patient.name ?? "this saved patient"} and the unsigned encounter shown above.</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />I verified permission to capture this call under the separate approved call-source policy.</label>
      <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!selected || !mappingConfirmed || !authorized} onClick={() => void run("reserve")}>Reserve selected household call</Button>
    </fieldset>
    {formDirty && !pending && <Button variant="outline" disabled={busy || policyBusy} onClick={clearSelection}>Discard local call selection</Button>}
    {pending && <section aria-label="Pending call capture" className="min-w-0 space-y-3 rounded-md border border-border p-3">
      <h4 className="font-medium">Original call capture</h4>
      <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Capture action audit details</summary><p className="break-all text-xs text-muted-foreground">Action {pending.action_id} · patient {pending.request.pet_id} · encounter {pending.request.encounter_id} · assignment {pending.request.inbound_id}</p></details>
      <p className="text-sm">State: {uncertain ? "Unconfirmed; recover before continuing" : capture?.action.state ?? "Unconfirmed"}. Only identifiers and versions are saved in this tab’s recovery storage; transcript text is not saved there.</p>
      {capture?.action.lease_until && <p className="break-words text-xs text-muted-foreground">Capture lease until {capture.action.lease_until}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || policyBusy} onClick={() => void run("recover")}>Recover original call capture</Button>{!capture && <Button variant="outline" disabled={blocked || busy || policyBusy || policyDirty} onClick={() => void run("reserve")}>Retry exact call reservation</Button>}{!uncertain && capture?.action.state === "pending" && <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={blocked || busy || policyDirty || policyBusy} onClick={() => void run("capture")}>Capture complete call transcript</Button>}<Button variant="outline" disabled={busy || policyBusy} onClick={() => void run("cancel")}>Cancel undispatched call capture</Button></div>
    </section>}
    {capture && !pending && <section aria-label="Call capture outcome" className="min-w-0 space-y-2 rounded-md border border-border p-3">
      <h4 className="font-medium">Original capture outcome: {capture.action.state}</h4>
      <p className="text-sm">{capture.action.error_code ? `Outcome: ${capture.action.error_code}. Review this result before an explicitly new reservation.` : "The original result is retained."}</p><details><summary className="min-h-11 cursor-pointer text-sm font-medium">Capture action audit details</summary><p className="break-all text-xs text-muted-foreground">Action {capture.action.id} · finished {capture.action.finished_at ?? "Not supplied"}</p></details>
    </section>}
    <section aria-label="Captured call source history" className="min-w-0 space-y-2">
      <h4 className="font-medium">Retained private call sources</h4>
      <p className="text-xs text-muted-foreground">Up to 100 recent sources for this patient. Opening a transcript rechecks administrator access and its household association.</p>
      {historyHasMore && <p className="text-sm text-muted-foreground">Older retained sources exist beyond this recent list.</p>}
      {!history.length && !loading && <p className="text-sm text-muted-foreground">No retained call sources returned.</p>}
      <div className="flex flex-wrap gap-2">{history.map((item) => <Button key={item.id} variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={busy || !!pending || policyBusy} onClick={() => void openSource(item.id)}>Review call ended {formatDateTime(item.context.call_ended_at)} · captured {formatDateTime(item.created_at)} (Denver)</Button>)}</div>
    </section>
    {source && <CallSourcePreview source={source} patientName={patient?.patient.name} householdName={patient?.client.full_name} encounterDate={source.encounter_id === encounter.id ? encounter.visit_at : undefined} />}
  </section>;
}
