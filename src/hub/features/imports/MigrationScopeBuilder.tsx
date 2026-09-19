import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createMigrationRunApi } from "./migration-run-api";
import type { MigrationManifest, MigrationRequest, MigrationRpc, MigrationScopeInput } from "./migration-run-api";
import { createMigrationSelectionApi, migrationParentType, migrationResources, migrationResourceLabels } from "./migration-selection-api";
import type { MigrationMapping, MigrationParent } from "./migration-selection-api";
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
interface DraftScope { input: MigrationScopeInput; mapping: MigrationMapping; parent: MigrationParent }
interface Props { actor: string; onDirtyChange: (dirty: boolean) => void; onSaved: (manifest: MigrationManifest) => void }
export function MigrationScopeBuilder({ actor, onDirtyChange, onSaved }: Props) {
  const api = useMemo(() => createMigrationRunApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const choices = useMemo(() => createMigrationSelectionApi(supabase as unknown as SupabaseClient, actor), [actor]);
  const [opened, setOpened] = useState(false), [page, setPage] = useState(0), [parentPage, setParentPage] = useState(0);
  const [mapping, setMapping] = useState<MigrationMapping | null>(null), [parent, setParent] = useState<MigrationParent | null>(null);
  const [attachmentParent, setAttachmentParent] = useState<"animal" | "consult">("animal");
  const [resource, setResource] = useState<MigrationScopeInput["resource"]>("animal"), [disposition, setDisposition] = useState<MigrationScopeInput["disposition"]>("required");
  const [reason, setReason] = useState(""), [draft, setDraft] = useState<DraftScope[]>([]), [confirmed, setConfirmed] = useState(false);
  const [request, setRequest] = useState<MigrationRequest | null>(null), [busy, setBusy] = useState(false), [recoverFirst, setRecoverFirst] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = !!mapping || !!reason || draft.length > 0 || !!request || busy;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const maps = useQuery({ queryKey: ["migration-mapping-choices", actor, page], enabled: opened, retry: false, queryFn: () => choices.mappings(page) });
  const parentType = resource === "attachment" && mapping?.resource === "animal" ? attachmentParent : mapping ? migrationParentType(resource, mapping) : "animal";
  const parents = useQuery({ queryKey: ["migration-parent-choices", actor, mapping?.id, resource, parentPage, parentType], enabled: !!mapping, retry: false, queryFn: () => choices.parents(mapping!, resource, parentPage, parentType) });
  const frozen = !!request || busy;
  function finish(saved: MigrationManifest) {
    if (!alive.current) return;
    setRequest(null); setDraft([]); setMapping(null); setParent(null); setReason(""); setConfirmed(false); setOpened(false); setError(""); setRecoverFirst(false); onSaved(saved);
  }
  async function save() {
    if (lock.current || recoverFirst || (!request && (!draft.length || !confirmed))) return;
    const payload = request ?? { id: crypto.randomUUID(), source_origin: draft[0].mapping.source_origin, source_site_uid: draft[0].mapping.source_site_uid, scopes: draft.map(d => d.input) };
    lock.current = true; setBusy(true); setRequest(payload); setError("");
    try { finish(await api.prepare(payload)); }
    catch (e) { if (alive.current) {
      if (e && typeof e === "object" && "code" in e && ["23514", "40001", "42501"].includes(String(e.code))) { setRequest(null); setConfirmed(false); setError("The database rejected this scope. Refresh and review the source parents and coverage before saving again."); }
      else { setRecoverFirst(true); setError("Save could not be confirmed. Check this request before retrying; its scope is locked."); }
    } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function recover() {
    if (lock.current || !request) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = await api.read(request.id);
      if (!alive.current) return;
      if (saved) {
        if (saved.run.source_origin !== request.source_origin || saved.run.source_site_uid !== request.source_site_uid || saved.scopes.length !== request.scopes.length || request.scopes.some(s => !saved.scopes.some(r => Object.entries(s).every(([k,v]) => r[k as keyof typeof s] === v)))) throw new Error("Recovered scope differs");
        finish(saved);
      } else { setRecoverFirst(false); setError("No saved receipt is visible yet. Retry uses the same request and scope; a delayed save cannot create a second migration."); }
    } catch { if (alive.current) { setRecoverFirst(true); setError("Recovery is unavailable. Keep this request and check again."); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function add() {
    if (!mapping || !parent || !reason.trim() || frozen || draft.length >= 100) return;
    const parent_type = parentType;
    if (resource === "attachment" && parent_type !== "animal" && disposition === "required") return;
    if (draft.some(d => d.input.mapping_id === mapping.id && d.input.resource === resource && d.input.parent_snapshot_id === parent.id)) { setError("This resource and parent are already in the draft."); return; }
    setDraft([...draft, { mapping, parent, input: { id: crypto.randomUUID(), mapping_id: mapping.id, resource, parent_type, parent_snapshot_id: parent.id, parent_head_version: parent.version, disposition, reason: reason.trim() } }]);
    setConfirmed(false); setReason(""); setError("");
  }
  return <section aria-label="New migration scope" className="space-y-3">
    {!opened ? <Button type="button" variant="outline" onClick={() => setOpened(true)}>Plan a migration</Button> : <>
      <h3 className="font-medium">Plan a migration</h3>
      <p className="text-sm text-muted-foreground">Choose approved households and patients, source parents and explicit resource coverage. Saving this plan does not contact ezyVet or start an import.</p>
      <fieldset disabled={frozen} className="space-y-3">
        <legend className="text-sm font-medium">Approved patient and household mappings</legend>
        {maps.isFetching ? <p role="status">Loading approved mappings…</p> : maps.isError ? <p role="alert">Approved mappings could not be loaded. <Button variant="outline" type="button" onClick={() => void maps.refetch()}>Retry mappings</Button></p> : <>
          {maps.data?.rows.length === 0 && <p>No available mappings on this page.</p>}
          {!!maps.data?.unavailable_count && <p role="status" className="text-sm text-muted-foreground">{maps.data.unavailable_count} mapping(s) on this page are unavailable because the patient or household no longer matches. Review their current household before planning a new import. Saved history remains available.</p>}
          <div className="flex flex-wrap gap-2">{maps.data?.rows.map(m => <Button type="button" key={m.id} variant={mapping?.id === m.id ? "secondary" : "outline"} className="h-auto min-h-10 whitespace-normal text-left" disabled={!!draft.length && (m.source_origin !== draft[0].mapping.source_origin || m.source_site_uid !== draft[0].mapping.source_site_uid)} onClick={() => { setMapping(m); setAttachmentParent("animal"); setResource(m.resource); setParent(null); setParentPage(0); setDisposition("required"); setConfirmed(false); }}>{m.patient_name ?? "Household"} · {m.household_name} · {m.source_site_uid}</Button>)}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous mappings</Button><Button type="button" variant="outline" disabled={!maps.data?.has_more} onClick={() => setPage(page + 1)}>Next mappings</Button></div>
        </>}
        {mapping && <>
          <p className="break-words text-sm">Selected: {mapping.patient_name ?? "Household"} · {mapping.household_name} · {mapping.source_origin} · {mapping.source_site_uid}</p>
          <label className="block">Migration resource<select aria-label="Migration resource" className={selectClass} value={resource} onChange={e => { setResource(e.target.value as typeof resource); setParent(null); setParentPage(0); setConfirmed(false); }}>{migrationResources.filter(r => mapping.resource === "contact" ? ["contact","attachment"].includes(r) : r !== "contact").map(r => <option key={r} value={r}>{migrationResourceLabels[r]}</option>)}</select></label>
          {resource === "attachment" && mapping.resource === "animal" && <label className="block">Attachment source parent<select aria-label="Attachment source parent" className={selectClass} value={attachmentParent} onChange={e => { setAttachmentParent(e.target.value as typeof attachmentParent); setParent(null); setParentPage(0); setConfirmed(false); }}><option value="animal">Patient</option><option value="consult">Consultation (excluded or unsupported only)</option></select></label>}
          <p className="text-sm">Select the current {parentType} source parent. Historical versions on these pages are not selectable.</p>
          {parents.isFetching ? <p role="status">Loading source parents…</p> : parents.isError ? <p role="alert">Source parents could not be loaded. <Button variant="outline" type="button" onClick={() => void parents.refetch()}>Retry parents</Button></p> : <>
            {parents.data?.rows.length === 0 && <p>No current parent on this page. Continue paging or import the required parent through the existing tools.</p>}
            <div className="flex flex-wrap gap-2">{parents.data?.rows.map(p => <Button type="button" key={p.id} variant={parent?.id === p.id ? "secondary" : "outline"} onClick={() => { setParent(p); setConfirmed(false); }}>Source parent #{p.external_id} · version {p.version}</Button>)}</div>
            <div className="flex gap-2"><Button type="button" variant="outline" disabled={!parentPage} onClick={() => setParentPage(parentPage - 1)}>Previous parents</Button><Button type="button" variant="outline" disabled={!parents.data?.has_more} onClick={() => setParentPage(parentPage + 1)}>Next parents</Button></div>
          </>}
          <label className="block">Coverage decision<select aria-label="Coverage decision" className={selectClass} value={disposition} onChange={e => { setDisposition(e.target.value as typeof disposition); setConfirmed(false); }}><option value="required">Required</option><option value="excluded">Explicitly excluded</option><option value="unsupported">Unsupported source contract</option></select></label>
          {resource === "attachment" && parentType !== "animal" && <p>Contact and consultation attachments currently require an excluded or unsupported disposition.</p>}
          <label className="block">Scope reason<Input value={reason} maxLength={2000} onChange={e => { setReason(e.target.value); setConfirmed(false); }} /></label>
          <Button type="button" onClick={add} disabled={!parent || !reason.trim() || draft.length >= 100 || (resource === "attachment" && parentType !== "animal" && disposition === "required")}>Add resource to scope</Button>
        </>}
        {draft.length > 0 && <ul className="space-y-2">{draft.map(d => <li key={d.input.id} className="rounded-md border p-3 text-sm"><p>{d.mapping.patient_name ?? "Household"} · {d.mapping.household_name} · {migrationResourceLabels[d.input.resource]} · {d.input.disposition}</p><p>{d.input.parent_type} #{d.parent.external_id} · version {d.parent.version}</p><p className="break-words">{d.input.reason}</p><Button type="button" variant="outline" size="sm" onClick={() => { setDraft(draft.filter(row => row.input.id !== d.input.id)); setConfirmed(false); }}>Remove {d.input.resource} scope</Button></li>)}</ul>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed the listed patients, source parents and coverage decisions.</label>
        <Button type="button" variant="outline" onClick={() => { setDraft([]); setMapping(null); setParent(null); setReason(""); setConfirmed(false); setOpened(false); setError(""); }}>Discard unsaved plan</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {request && <p className="break-all text-xs text-muted-foreground">Save request: {request.id}</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || recoverFirst || (!request && (!draft.length || !confirmed))} onClick={() => void save()}>{busy ? "Working…" : request ? "Retry same plan" : "Save migration scope"}</Button>{request && <Button type="button" variant="outline" disabled={busy} onClick={() => void recover()}>Check plan save status</Button>}</div>
    </>}
  </section>;
}
