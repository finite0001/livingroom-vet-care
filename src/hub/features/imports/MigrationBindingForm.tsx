import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createMigrationRunApi } from "./migration-run-api";
import type { MigrationBinding, MigrationBindingRequest, MigrationCursor, MigrationManifest, MigrationRpc } from "./migration-run-api";
import { createMigrationSelectionApi, migrationResourceLabels } from "./migration-selection-api";
interface Props { actor: string; manifest: MigrationManifest; scopeId: string; onDirtyChange: (dirty: boolean) => void; onSaved: (binding: MigrationBinding) => void }
export function MigrationBindingForm({ actor, manifest, scopeId, onDirtyChange, onSaved }: Props) {
  const api = useMemo(() => createMigrationRunApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const choices = useMemo(() => createMigrationSelectionApi(supabase as unknown as SupabaseClient, actor), [actor]);
  const scope = manifest.scopes.find(s => s.id === scopeId)!;
  const [opened, setOpened] = useState(false), [cursor, setCursor] = useState<MigrationCursor | null>(null), [previous, setPrevious] = useState<(MigrationCursor | null)[]>([]), [child, setChild] = useState<string | null>(null), [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [recoverFirst, setRecoverFirst] = useState(false), [error, setError] = useState("");
  const [request, setRequest] = useState<MigrationBindingRequest | null>(null);
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = !!child || !!reason || !!request || busy;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const runs = useQuery({ queryKey: ["migration-run-choices", actor, scopeId, cursor], enabled: opened, retry: false, queryFn: () => choices.runs(manifest, scope, cursor) });
  const latest = useQuery({ queryKey: ["migration-binding-latest", actor, scopeId], enabled: opened, retry: false, queryFn: () => api.listBindings(scopeId, null, 1) });
  const names = useQuery({ queryKey: ["migration-binding-names", actor, scope.client_id, scope.pet_id], enabled: opened, retry: false, queryFn: async () => {
    const household = await supabase.from("clients").select("id,full_name").eq("id", scope.client_id);
    if (household.error) throw household.error;
    const h = household.data?.find(c => c.id === scope.client_id);
    if (!h) throw new Error("Saved household unavailable");
    if (!scope.pet_id) return { household: h.full_name, patient: null };
    const patient = await supabase.from("pets").select("id,name,client_id").eq("id", scope.pet_id);
    if (patient.error) throw patient.error;
    const p = patient.data?.find(p => p.id === scope.pet_id && p.client_id === scope.client_id);
    if (!p) throw new Error("Saved patient household changed");
    return { household: h.full_name, patient: p.name };
  } });
  const predecessor = latest.data?.bindings[0] ?? null;
  useEffect(() => { setConfirmed(false); }, [predecessor?.id]);
  const frozen = !!request || busy;
  function finish(binding: MigrationBinding) {
    if (!alive.current) return;
    setRequest(null); setChild(null); setReason(""); setConfirmed(false); setOpened(false); setRecoverFirst(false); setError(""); onSaved(binding);
  }
  async function save() {
    if (lock.current || recoverFirst || (!request && (!child || !reason.trim() || !confirmed || !latest.data || latest.isFetching || latest.isError || !names.data || names.isFetching || names.isError))) return;
    const payload = request ?? { id: crypto.randomUUID(), scope_id: scopeId, child_run_id: child!, reason: reason.trim(), replaces_id: predecessor?.id ?? null };
    lock.current = true; setBusy(true); setRequest(payload); setError("");
    try { finish(await api.bind(payload)); }
    catch (e) { if (alive.current) {
      if (e && typeof e === "object" && "code" in e && ["23514", "40001", "42501"].includes(String(e.code))) {
        setRequest(null); setConfirmed(false); setError("The database rejected this binding. Review the run, exact source parent and current preceding binding before trying again."); void latest.refetch();
      } else { setRecoverFirst(true); setError("Binding could not be confirmed. Check this request before retrying; the selected run is locked."); }
    } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function recover() {
    if (lock.current || !request) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = await api.readBinding(request.id, scopeId);
      if (!alive.current) return;
      if (saved) {
        if (saved.child_run_id !== request.child_run_id || saved.reason !== request.reason || saved.replaces_id !== request.replaces_id) throw new Error("Recovered binding differs");
        finish(saved);
      } else { setRecoverFirst(false); setError("No saved binding is visible yet. Retry keeps the same request, run and preceding binding."); }
    } catch { if (alive.current) { setRecoverFirst(true); setError("Binding recovery is unavailable. Keep this request and check again."); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (scope.disposition !== "required") return <p className="text-sm">This scope is {scope.disposition}; it cannot acquire an import run.</p>;
  return <section aria-label="Bind source run" className="space-y-3 rounded-md border p-3">
    {!opened ? <Button type="button" variant="outline" onClick={() => { setOpened(true); void latest.refetch(); }}>Bind an existing source run</Button> : <>
      <h5 className="font-medium">Bind an existing source run</h5>
      <p className="break-words text-sm">{manifest.run.source_site_uid} · {migrationResourceLabels[scope.resource]} · {scope.parent_type} #{scope.parent_external_id} · version {scope.parent_head_version}</p>
      {names.isFetching ? <p role="status">Checking patient and household…</p> : names.isError ? <p role="alert">Saved patient or household could not be verified. <Button type="button" variant="outline" disabled={busy} onClick={() => void names.refetch()}>Recheck binding household</Button></p> : names.data && <p className="text-sm font-medium">{names.data.patient ?? "Household"} · {names.data.household}</p>}
      <div className="flex flex-wrap gap-3 text-sm">{scope.pet_id && <Link className="text-primary underline" to={`/hub/patient/${scope.pet_id}`}>Review binding patient</Link>}<Link className="text-primary underline" to={`/hub/client/${scope.client_id}`}>Review binding household</Link></div>
      <p className="text-sm text-muted-foreground">Choose one of your saved runs for this source and resource. The server also verifies its exact patient and parent. Binding references historical work; it does not resume a scan or change its cooldown.</p>
      <fieldset disabled={frozen} className="space-y-3">
        <legend className="sr-only">Source run selection</legend>
        {latest.isFetching ? <p role="status">Checking preceding binding…</p> : latest.isError ? <p role="alert">Preceding binding could not be checked. <Button type="button" variant="outline" onClick={() => void latest.refetch()}>Retry preceding binding</Button></p> : latest.data && <p className="text-sm">{predecessor ? `This replaces the binding saved ${new Date(predecessor.created_at).toLocaleString()}: ${predecessor.reason}` : "This will be the first binding for this scope."}</p>}
        {runs.isFetching ? <p role="status">Loading your source runs…</p> : runs.isError ? <p role="alert">Source runs could not be loaded. <Button type="button" variant="outline" onClick={() => void runs.refetch()}>Retry source runs</Button></p> : <>
          {runs.data?.rows.length === 0 && <p>No source runs on this page. Use the existing import tools to prepare the required resource first.</p>}
          <div className="space-y-2">{runs.data?.rows.map(r => <Button key={r.id} type="button" variant={child === r.id ? "secondary" : "outline"} className="h-auto min-h-10 w-full whitespace-normal text-left" disabled={r.id === predecessor?.child_run_id} onClick={() => { setChild(r.id); setConfirmed(false); }}>Run {r.id.slice(0, 8)} · {new Date(r.created_at).toLocaleString()} · {r.status === "review_ready" ? "Traversal ended" : r.status === "page_limit_reached" ? "Page limit reached" : "Unfinished"}</Button>)}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={!previous.length} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous source runs</Button><Button type="button" variant="outline" disabled={!runs.data?.has_more} onClick={() => { setPrevious([...previous, cursor]); setCursor(runs.data!.next_cursor); }}>Next source runs</Button></div>
        </>}
        <label className="block">Binding reason<Input value={reason} maxLength={2000} onChange={e => { setReason(e.target.value); setConfirmed(false); }} /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed this patient, household, source parent and any preceding binding.</label>
        <Button type="button" variant="outline" onClick={() => { setChild(null); setReason(""); setConfirmed(false); setOpened(false); setError(""); }}>Discard unsaved binding</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {request && <p className="break-all text-xs text-muted-foreground">Binding request: {request.id}</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || recoverFirst || (!request && (!child || !reason.trim() || !confirmed || !latest.data || latest.isFetching || latest.isError || !names.data || names.isFetching || names.isError))} onClick={() => void save()}>{busy ? "Working…" : request ? "Retry same binding" : "Save source binding"}</Button>{request && <Button type="button" variant="outline" disabled={busy} onClick={() => void recover()}>Check binding save status</Button>}</div>
    </>}
  </section>;
}
