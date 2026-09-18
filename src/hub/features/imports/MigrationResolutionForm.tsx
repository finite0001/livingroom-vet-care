import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { createMigrationResolutionApi } from "./migration-resolution-api";
import type { MigrationResolutionContext, MigrationResolutionTarget } from "./migration-resolution-api";
import type { MigrationManifest, MigrationRpc } from "./migration-run-api";
import { beginResolutionRecovery, beginResolutionSave, emptyResolutionState, resolutionConfirmed, resolutionRecoveryAbsent, resolutionRecoveryFailed, resolutionSaveFailed } from "./migration-resolution-state";
import { MigrationResolutionHistory } from "./MigrationResolutionHistory";

interface Props {
  actor: string;
  manifest: MigrationManifest;
  scopeId: string;
  target: MigrationResolutionTarget;
  onDirtyChange: (dirty: boolean) => void;
}
export function MigrationResolutionForm(props: Props) {
  return <ResolutionForm key={`${props.actor}:${props.manifest.run.id}:${props.scopeId}:${JSON.stringify(props.target)}`} {...props} />;
}
interface TargetNamesProps { actor: string; clientId: string; petId: string | null }
function CurrentTargetNames({ actor, clientId, petId }: TargetNamesProps) {
  const household = useQuery({ queryKey: ["migration-resolution-household", actor, clientId], retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from("clients").select("id,full_name").eq("id", clientId).limit(1).retry(false).abortSignal(signal);
      if (error) throw error;
      const row = data?.[0];
      if (row && row.id !== clientId) throw new Error("Household identity differs");
      return row ?? null;
    } });
  const patient = useQuery({ queryKey: ["migration-resolution-patient", actor, clientId, petId], enabled: Boolean(petId), retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from("pets").select("id,name,client_id").eq("id", petId!).limit(1).retry(false).abortSignal(signal);
      if (error) throw error;
      const row = data?.[0];
      if (row && row.id !== petId) throw new Error("Patient identity differs");
      return row ?? null;
    } });
  return <div className="space-y-1 text-sm">
    <p>{household.isFetching ? "Loading current household name…" : household.isError || !household.data ? "Current household name unavailable; use the saved reference below." : `Current local household name: ${household.data.full_name}`}</p>
    <p className="break-all text-xs text-muted-foreground">Saved household ID: {clientId}</p>
    {petId && <>
      <p>{patient.isFetching ? "Loading current patient name…" : patient.isError || !patient.data ? "Current patient name unavailable; use the saved reference below." : `Current local patient name: ${patient.data.name}`}</p>
      {!patient.isFetching && !patient.isError && patient.data && patient.data.client_id !== clientId && <p>The patient currently belongs to a different household. The household shown above is the saved migration household.</p>}
      <p className="break-all text-xs text-muted-foreground">Saved patient ID: {petId}</p>
    </>}
    <p className="text-xs text-muted-foreground">These current display names are fetched separately. They are not frozen receipt evidence or proof of migration coverage.</p>
  </div>;
}
function ResolutionForm({ actor, manifest, scopeId, target, onDirtyChange }: Props) {
  const api = useMemo(() => createMigrationResolutionApi(supabase as unknown as MigrationRpc, actor, manifest), [actor, manifest]);
  const targetKey = `${scopeId}:${JSON.stringify(target)}`;
  const [state, setState] = useState(() => emptyResolutionState(actor, targetKey));
  const [context, setContext] = useState<MigrationResolutionContext | null>(null);
  const [reason, setReason] = useState(""), [action, setAction] = useState<"exclude" | "reopen">("exclude");
  const [acknowledged, setAcknowledged] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [historyVersion, setHistoryVersion] = useState(0);
  const alive = useRef(true), lock = useRef(false);
  const locked = state.phase !== "editable";
  const dirty = locked || reason.length > 0 || acknowledged || action !== "exclude";
  const scope = manifest.scopes.find(row => row.id === scopeId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function loadContext() {
    if (lock.current || locked) return;
    lock.current = true; setLoading(true); setContext(null); setAcknowledged(false); setError("");
    try { const result = await api.context(scopeId, target); if (alive.current) setContext(result); }
    catch { if (alive.current) setError("Decision context could not be loaded. No decision was sent."); }
    finally { lock.current = false; if (alive.current) setLoading(false); }
  }
  function confirmed(next: typeof state) {
    setState(next); setReason(""); setAcknowledged(false); setAction("exclude"); setContext(null);
    setNotice("Decision saved. Clinical review and migration acceptance remain separate. Refresh the context before another decision.");
    setHistoryVersion(value => value + 1);
  }
  async function save() {
    if (lock.current || (!context && state.phase !== "retryable")) return;
    if (state.phase !== "retryable" && (!acknowledged || !reason.trim() || (action === "reopen" && context?.latest?.action !== "exclude"))) return;
    const request = state.request ?? { id: crypto.randomUUID(), scope_id: scopeId, target_kind: target.kind,
      binding_id: target.binding_id, page: target.page, ordinal: target.ordinal, snapshot_id: target.snapshot_id,
      evidence_hash: target.evidence_hash, action, reason: reason.trim(), expected_context_hash: context!.context_hash, replaces_id: context!.latest?.id ?? null };
    const saving = beginResolutionSave(state, request);
    if (saving.phase !== "saving" || !saving.request) return;
    const reply = { actor, targetKey, requestId: saving.request.id };
    lock.current = true; setState(saving); setError(""); setNotice("");
    try { await api.save(saving.request); if (alive.current) confirmed(resolutionConfirmed(saving, reply)); }
    catch (failure) {
      if (!alive.current) return;
      const next = resolutionSaveFailed(saving, reply, failure); setState(next);
      if (next.phase === "editable") { setContext(null); setAcknowledged(false); setError("The decision was rejected. Refresh its context and review again before saving."); }
      else setError("The save result is uncertain. Recover this exact request before retrying; its reason and identity are locked.");
    } finally { lock.current = false; }
  }
  async function recover() {
    if (lock.current) return;
    const recovering = beginResolutionRecovery(state);
    if (recovering.phase !== "recovering" || !recovering.request) return;
    const reply = { actor, targetKey, requestId: recovering.request.id };
    lock.current = true; setState(recovering); setError(""); setNotice("");
    try {
      const result = await api.recover(recovering.request);
      if (!alive.current) return;
      if (result) confirmed(resolutionConfirmed(recovering, reply));
      else { setState(resolutionRecoveryAbsent(recovering, reply)); setNotice("No receipt was found yet. You may check again or retry the identical request. The original save may still be in flight."); }
    } catch { if (alive.current) { setState(resolutionRecoveryFailed(recovering, reply)); setError("Recovery is unavailable. Keep this request and check again."); } }
    finally { lock.current = false; }
  }
  const reviewed = context?.context;
  return <section aria-label={target.kind === "scope" ? "Scope operational decision" : "Observation operational decision"} className="mt-3 space-y-3 rounded-md border p-3">
    <h5 className="font-medium">{target.kind === "scope" ? "Scope operational decision" : "Exact observation decision"}</h5>
    <p className="text-sm">{target.kind === "scope" ? "Applies to the declared scope, including unknown or unfetched records. It does not review each observation." : `Applies only to this occurrence on page ${target.page}, ordinal ${target.ordinal}. Other occurrences and replacement bindings remain separate.`}</p>
    <p className="break-all text-sm">Source: {manifest.run.source_origin} · Site: {manifest.run.source_site_uid}</p>
    {scope && <><p className="text-sm">Original disposition: <strong>{scope.disposition}</strong> · {scope.resource}</p><p className="break-words text-sm">{scope.reason}</p>
      <p className="break-all text-sm">Saved source parent: {scope.parent_type} #{scope.parent_external_id}</p>
      <CurrentTargetNames actor={actor} clientId={scope.client_id} petId={scope.pet_id} />
      <div className="flex flex-wrap gap-3 text-sm"><Link className="text-primary underline" to={`/hub/client/${scope.client_id}`}>Open saved household</Link>{scope.pet_id && <Link className="text-primary underline" to={`/hub/patient/${scope.pet_id}`}>Open saved patient</Link>}</div>
      {scope.disposition !== "required" && <p className="text-sm">Reopening operational review does not change the original exclusion or unsupported contract. A new supported manifest is required to change that contract.</p>}</>}
    <p className="text-sm text-muted-foreground">Excluding a required scope leaves a coverage exception. Unseen records remain unknown. Neither action approves clinical records, resumes imports or verifies complete coverage.</p>
    <Button type="button" variant="outline" disabled={locked || loading} onClick={() => void loadContext()}>{loading ? "Loading decision context…" : "Refresh decision context"}</Button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {context && reviewed && <div className="space-y-2 text-sm">
      <p>Context checked {new Date(context.observed_at).toLocaleString()}.</p>
      {!reviewed.binding.selected_id && <p>No source attempt is bound. Unfetched coverage remains unknown.</p>}
      {reviewed.binding.superseded && <p>This is a historical binding. The decision does not apply to its replacement.</p>}
      {(!reviewed.local.client_exists || reviewed.local.pet_exists === false || !reviewed.local.household_current) && <p>The saved household or patient relationship needs review.</p>}
      {(reviewed.mapping.current_snapshot_id !== reviewed.scope.mapping_snapshot_id || reviewed.mapping.current_head_version !== reviewed.scope.mapping_head_version) && <p>The saved mapping source version has changed or is unavailable.</p>}
      {(reviewed.parent.current_snapshot_id !== reviewed.scope.parent_snapshot_id || reviewed.parent.current_head_version !== reviewed.scope.parent_head_version) && <p>The parent source version has changed or is unavailable.</p>}
      {reviewed.scan && <p>Attempt status: {reviewed.scan.status} · Next page: {reviewed.scan.next_page}. Failed and unseen coverage is unknown.{reviewed.scan.error_code ? ` Last error: ${reviewed.scan.error_code}.` : ""}</p>}
      {reviewed.observation && <p>{reviewed.observation.observed_head_version === null ? "Observed source head was not recorded; exact version fidelity is unknown." : reviewed.observation.current_snapshot_id !== reviewed.observation.snapshot_id || reviewed.observation.current_head_version !== reviewed.observation.observed_head_version ? "The observed source version has changed or is unavailable." : "The observed source version matches the current head at this check."}</p>}
      <p>{context.latest ? `Prior decision: ${context.latest.action}, version ${context.latest.version}.` : "No prior operational decision for this target."}</p>
      {context.latest && <><p className="break-words">{context.latest.reason}</p>{context.latest.reviewed_context_hash !== context.context_hash && <p>The prior decision reviewed an older context. Its history is retained.</p>}</>}
    </div>}
    {(context || locked) && <fieldset disabled={locked || loading} className="space-y-3">
      <label className="block space-y-1 text-sm"><span>Operational action</span><select className="w-full rounded-md border bg-background p-2 text-foreground" value={action} onChange={event => { setAction(event.target.value as "exclude" | "reopen"); setAcknowledged(false); }}><option value="exclude">Exclude from this migration</option><option value="reopen" disabled={context?.latest?.action !== "exclude"}>Reopen operational review</option></select></label>
      <label className="block space-y-1 text-sm"><span>Decision reason</span><textarea className="min-h-24 w-full rounded-md border bg-background p-2 text-foreground" maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I understand exclusions leave coverage incomplete, and reopening does not change clinical records or resume a scan.</label>
    </fieldset>}
    {state.phase === "editable" && context && <Button type="button" disabled={loading || !acknowledged || !reason.trim() || (action === "reopen" && context.latest?.action !== "exclude")} onClick={() => void save()}>Save operational decision</Button>}
    {state.phase === "editable" && dirty && <Button type="button" variant="outline" disabled={loading} onClick={() => { setReason(""); setAction("exclude"); setAcknowledged(false); }}>Discard unsaved decision</Button>}
    {locked && <p role="status" className="break-all text-sm">Request {state.request?.id} · {state.phase}. Keep this page open until the result is recovered.</p>}
    {["uncertain", "retryable"].includes(state.phase) && <Button type="button" variant="outline" onClick={() => void recover()}>Recover saved decision</Button>}
    {state.phase === "retryable" && <Button type="button" onClick={() => void save()}>Retry identical decision</Button>}
    <MigrationResolutionHistory key={historyVersion} actor={actor} manifest={manifest} scopeId={scopeId} target={target} />
  </section>;
}
