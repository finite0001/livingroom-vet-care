import { MigrationWeightEvidence } from "./MigrationWeightEvidence";
import { MigrationIdentityEvidence } from "./MigrationIdentityEvidence";
import { MigrationPrescriptionItemEvidence } from "./MigrationPrescriptionItemEvidence";
import { MigrationResolutionForm } from "./MigrationResolutionForm";
import { MigrationResume } from "./MigrationResume";
import { MigrationScopeBuilder } from "./MigrationScopeBuilder";
import { MigrationBindingForm } from "./MigrationBindingForm";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createMigrationRunApi } from "./migration-run-api";
import type { MigrationBinding, MigrationCursor, MigrationManifest, MigrationRpc } from "./migration-run-api";
import { MigrationWeightEvidence } from "./MigrationWeightEvidence";
import { MigrationPrescriptionEvidence } from "./MigrationPrescriptionEvidence";
import { MigrationVaccinationEvidence } from "./MigrationVaccinationEvidence";
import { MigrationHistoryEvidence } from "./MigrationHistoryEvidence";
import { createMigrationCaptureApi } from "./migration-capture-api";
import type { MigrationItem, MigrationItemCursor } from "./migration-items-api";

interface Props { actor: string }
interface WorkspaceProps extends Props { onDirtyChange: (dirty: boolean) => void }
const resourceNames: Record<string, string> = { contact: "Contacts", animal: "Patients", healthstatus: "Weights", consult: "Consultations", history: "History", vaccination: "Vaccinations", prescription: "Prescriptions", prescriptionitem: "Prescription items", attachment: "Attachments" };
const resourceName = (value: string) => resourceNames[value] ?? value;
const recorded = (value: string) => new Date(value).toLocaleString();
interface PaginationProps { disabled?: boolean; label: string; previous: boolean; next: boolean; onPrevious: () => void; onNext: () => void }
function Pagination({ disabled = false, label, previous, next, onPrevious, onNext }: PaginationProps) {
  return <div className="flex flex-wrap gap-2">
    <Button type="button" variant="outline" size="sm" disabled={disabled || !previous} onClick={onPrevious} aria-label={`Previous ${label} page`}>Previous</Button>
    <Button type="button" variant="outline" size="sm" disabled={disabled || !next} onClick={onNext} aria-label={`Next ${label} page`}>Next</Button>
  </div>;
}
interface FailureProps { message: string; retry: () => void }
function Failure({ message, retry }: FailureProps) {
  return <div role="alert" className="space-y-2"><p>{message}</p><Button type="button" variant="outline" size="sm" onClick={retry}>Try again</Button></div>;
}
function useApi(actor: string) { return useMemo(() => createMigrationRunApi(supabase as unknown as MigrationRpc, actor), [actor]); }

export function EzyVetMigrationRuns({ actor, onDirtyChange }: WorkspaceProps) {
  return <MigrationWorkspace key={actor} actor={actor} onDirtyChange={onDirtyChange} />;
}
function MigrationWorkspace({ actor, onDirtyChange }: WorkspaceProps) {
  const [planDirty, setPlanDirty] = useState(false), [bindingDirty, setBindingDirty] = useState(false);
  const locked = planDirty || bindingDirty;
  useEffect(() => { onDirtyChange(locked); }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const api = useApi(actor);
  const [opened, setOpened] = useState(false);
  const [cursor, setCursor] = useState<MigrationCursor | null>(null);
  const [previous, setPrevious] = useState<(MigrationCursor | null)[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["migration-runs", actor, cursor], enabled: opened, retry: false, queryFn: () => api.list(cursor) });
  return <Card role="region" aria-label="Migration reconciliation">
    <CardHeader><CardTitle>Migration reconciliation</CardTitle><p className="text-sm text-muted-foreground">Reopen saved migrations and inspect their source evidence. Clinical review and cutover acceptance remain separate.</p></CardHeader>
    <CardContent className="space-y-4">
      <fieldset disabled={bindingDirty}><MigrationScopeBuilder actor={actor} onDirtyChange={setPlanDirty} onSaved={saved => { setOpened(true); setCursor(null); setPrevious([]); setSelected(saved.run.id); void runs.refetch(); }} /></fieldset>
      {!opened ? <Button type="button" variant="outline" onClick={() => setOpened(true)}>Browse saved migrations</Button> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Your saved migrations</h3><Button type="button" variant="outline" size="sm" disabled={locked || runs.isFetching} onClick={() => void runs.refetch()}>Refresh saved migrations</Button></div>
        {runs.isFetching ? <p role="status">Loading saved migrations…</p> : runs.isError ? <Failure message="Saved migrations could not be loaded." retry={() => void runs.refetch()} /> : runs.data && <>
          {runs.data.runs.length === 0 ? <p className="text-sm text-muted-foreground">No saved migrations on this page. This does not establish that the source migration is complete.</p> : <ul className="space-y-2">{runs.data.runs.map(run => <li key={run.id} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 text-sm"><p className="break-all font-medium">{run.source_site_uid}</p><p className="text-muted-foreground">{run.source_origin.includes("trial") ? "Trial source" : "Production source"} · Saved {recorded(run.created_at)}</p></div>
            <Button type="button" variant={selected === run.id ? "secondary" : "outline"} disabled={locked} onClick={() => setSelected(run.id)}>Open migration {run.id.slice(0, 8)}</Button>
          </li>)}</ul>}
          <Pagination disabled={locked} label="migration" previous={previous.length > 0} next={runs.data.has_more} onPrevious={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }} onNext={() => { setPrevious([...previous, cursor]); setCursor(runs.data.next_cursor); }} />
        </>}
        <fieldset disabled={planDirty}>{selected && <MigrationDetail key={`${actor}:${selected}`} actor={actor} id={selected} locked={locked} onDirtyChange={setBindingDirty} />}</fieldset>
      </>}
    </CardContent>
  </Card>;
}
interface DetailProps extends Props { id: string; locked: boolean; onDirtyChange: (dirty: boolean) => void }
function MigrationDetail({ actor, id, locked, onDirtyChange }: DetailProps) {
  const api = useApi(actor);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const manifest = useQuery({ queryKey: ["migration-manifest", actor, id], retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, queryFn: () => api.read(id) });
  if (manifest.isFetching && !manifest.data) return <p role="status">Loading migration scope…</p>;
  if (manifest.isError) return <Failure message="Migration scope could not be loaded." retry={() => void manifest.refetch()} />;
  if (!manifest.data) return <p role="alert">This saved migration is unavailable to your account.</p>;
  const saved = manifest.data, selected = saved.scopes.find(scope => scope.id === scopeId);
  return <section aria-label="Saved migration scope" className="space-y-3 border-t pt-4">
    <h3 className="font-medium">Saved scope</h3>
    <p className="text-sm text-muted-foreground">Select a resource to inspect its saved attempts. Exclusions stay visible in this scope.</p>
    <ul className="grid gap-2 md:grid-cols-2">{saved.scopes.map(scope => <li key={scope.id} className="min-w-0 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{resourceName(scope.resource)}</span><Badge variant="outline">{scope.disposition}</Badge></div>
      <p className="break-all text-muted-foreground">{resourceName(scope.parent_type)} source #{scope.parent_external_id}</p>
      <div className="mt-1 flex flex-wrap gap-3">
        {scope.pet_id && <Link className="text-primary underline" to={`/hub/patient/${scope.pet_id}`}>Open saved patient</Link>}
        <Link className="text-primary underline" to={`/hub/client/${scope.client_id}`}>Open saved household</Link>
      </div>
      <p className="mt-1 break-words">{scope.reason}</p>
      <Button type="button" variant={scopeId === scope.id ? "secondary" : "outline"} size="sm" className="mt-2 h-auto min-h-10 max-w-full whitespace-normal" disabled={locked} onClick={() => setScopeId(scope.id)}>Inspect {resourceName(scope.resource).toLowerCase()} scope {scope.id.slice(0, 8)}</Button>
    </li>)}</ul>
    {selected && <ScopeBindings key={`${actor}:${selected.id}`} actor={actor} manifest={saved} scopeId={selected.id} onDirtyChange={onDirtyChange} />}
  </section>;
}
interface ScopeProps extends Props { manifest: MigrationManifest; scopeId: string; onDirtyChange: (dirty: boolean) => void }
function ScopeBindings({ actor, manifest, scopeId, onDirtyChange }: ScopeProps) {
  const [bindingDirty, setBindingDirty] = useState(false), [resumeDirty, setResumeDirty] = useState(false);
  const [scopeDecisionDirty, setScopeDecisionDirty] = useState(false), [itemDecisionDirty, setItemDecisionDirty] = useState(false);
  const locked = bindingDirty || resumeDirty || scopeDecisionDirty || itemDecisionDirty;
  useEffect(() => { onDirtyChange(locked); }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const api = useApi(actor);
  const [cursor, setCursor] = useState<MigrationCursor | null>(null);
  const [previous, setPrevious] = useState<(MigrationCursor | null)[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const bindings = useQuery({ queryKey: ["migration-bindings", actor, scopeId, cursor], retry: false, queryFn: () => api.listBindings(scopeId, cursor) });
  const binding = useQuery({ queryKey: ["migration-binding", actor, scopeId, selected], enabled: Boolean(selected), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, queryFn: () => api.readBinding(selected, scopeId) });
  return <section aria-label="Saved resource attempts" className="space-y-3 border-t pt-4">
    <h4 className="font-medium">Saved resource attempts</h4>
    <fieldset disabled={resumeDirty || scopeDecisionDirty || itemDecisionDirty}><MigrationBindingForm actor={actor} manifest={manifest} scopeId={scopeId} onDirtyChange={setBindingDirty} onSaved={saved => { setCursor(null); setPrevious([]); setSelected(saved.id); void bindings.refetch(); }} /></fieldset>
    <fieldset disabled={bindingDirty || resumeDirty || itemDecisionDirty}><MigrationResolutionForm actor={actor} manifest={manifest} scopeId={scopeId} target={{ kind: "scope", binding_id: null, page: null, ordinal: null, snapshot_id: null, evidence_hash: null }} onDirtyChange={setScopeDecisionDirty} /></fieldset>
    {bindings.isFetching ? <p role="status">Loading saved attempts…</p> : bindings.isError ? <Failure message="Saved attempts could not be loaded." retry={() => void bindings.refetch()} /> : bindings.data && <>
      {bindings.data.bindings.length === 0 ? <p className="text-sm text-muted-foreground">No source run is bound on this page. Review the saved disposition before assessing coverage.</p> : <ul className="space-y-2">{bindings.data.bindings.map(row => <li key={row.id} className="rounded-md border p-3 text-sm">
        <p className="break-words">{row.reason}</p><p className="text-muted-foreground">Saved {recorded(row.created_at)}{row.replaces_id ? " · Replaces an earlier binding" : ""}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" disabled={locked} onClick={() => setSelected(row.id)}>Inspect attempt {row.id.slice(0, 8)}</Button>
      </li>)}</ul>}
      <Pagination disabled={locked} label="attempt" previous={previous.length > 0} next={bindings.data.has_more} onPrevious={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }} onNext={() => { setPrevious([...previous, cursor]); setCursor(bindings.data.next_cursor); }} />
    </>}
    {selected && (binding.isFetching && !binding.data ? <p role="status">Loading source run…</p> : binding.isError ? <Failure message="Source run could not be recovered." retry={() => void binding.refetch()} /> : binding.data ? <SourceEvidence key={`${actor}:${binding.data.id}`} actor={actor} manifest={manifest} binding={binding.data} onResumeDirty={setResumeDirty} onDecisionDirty={setItemDecisionDirty} resumeDirty={resumeDirty} bindingDirty={bindingDirty || scopeDecisionDirty} /> : <p role="alert">This source run is unavailable to your account.</p>)}
  </section>;
}
interface EvidenceProps extends Props { manifest: MigrationManifest; binding: MigrationBinding; onResumeDirty: (dirty: boolean) => void; onDecisionDirty: (dirty: boolean) => void; resumeDirty: boolean; bindingDirty: boolean }
function SourceEvidence({ actor, manifest, binding, onResumeDirty, onDecisionDirty, resumeDirty, bindingDirty }: EvidenceProps) {
  const [decisionDirty, setDecisionDirty] = useState(false);
  const locked = decisionDirty || bindingDirty || resumeDirty;
  useEffect(() => { onDecisionDirty(decisionDirty); }, [decisionDirty, onDecisionDirty]);
  useEffect(() => () => onDecisionDirty(false), [onDecisionDirty]);
  const api = useApi(actor);
  const [cursor, setCursor] = useState<MigrationItemCursor | null>(null);
  const [previous, setPrevious] = useState<(MigrationItemCursor | null)[]>([]);
  const progress = useQuery({ queryKey: ["migration-progress", actor, binding.id], retry: false, queryFn: () => api.progress(manifest, binding) });
  const items = useQuery({ queryKey: ["migration-items", actor, binding.id, cursor], retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, queryFn: () => api.items(manifest, binding, cursor) });
  const [expanded, setExpanded] = useState<string | null>(null);
  return <section aria-label="Migration source evidence" className="space-y-3 rounded-md border bg-muted/30 p-3 md:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">Source evidence</h4><Button type="button" variant="outline" size="sm" disabled={locked || items.isFetching || progress.isFetching} onClick={() => { void items.refetch(); void progress.refetch(); }}>Refresh source evidence</Button></div>
    {manifest.scopes.find(s => s.id === binding.scope_id)?.disposition === "required" && <fieldset disabled={bindingDirty || decisionDirty}><MigrationResume actor={actor} manifest_id={manifest.run.id} scope_id={binding.scope_id} binding_id={binding.id} onDirtyChange={onResumeDirty} onUpdated={() => { void progress.refetch(); void items.refetch(); }} /></fieldset>}
    <p className="text-sm text-muted-foreground">Source observations and available review receipts. Original-file verification and migration acceptance are not assessed here.</p>
    {progress.isFetching ? <p role="status">Loading run progress…</p> : progress.isError ? <Failure message="Run progress is unavailable; counts are not shown." retry={() => void progress.refetch()} /> : progress.data ? <>
      <dl className="grid gap-3 sm:grid-cols-3">{[["Observed occurrences", progress.data.observations.occurrences], ["Distinct source records", progress.data.observations.distinct_source_identities], ["Distinct snapshots", progress.data.observations.distinct_snapshot_versions]].map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{count}</dd></div>)}</dl>
      <p className="text-sm">{progress.data.scan.page_limit_reached ? "Page limit reached; source coverage is incomplete." : progress.data.scan.traversal_ended ? "Traversal ended; source coverage has not been accepted." : "Source traversal is unfinished."}</p>
      {progress.data.scan.latest_error_code && <p className="text-sm">Latest attempt error: {progress.data.scan.latest_error_code.toLowerCase().replace(/_/g, " ")}</p>}
      {progress.data.scan.retry_after && <p className="text-sm text-muted-foreground">Retry boundary: {recorded(progress.data.scan.retry_after)}</p>}
    </> : <p role="alert">Run progress is unavailable.</p>}
    {items.isFetching ? <p role="status">Loading source items…</p> : items.isError ? <Failure message="Source items could not be loaded." retry={() => void items.refetch()} /> : items.data && <>
      <p className="text-xs text-muted-foreground">Source state checked {recorded(items.data.observed_at)}. Counts and item pages refresh independently.</p>
      {(items.data.superseded || !items.data.mapping_matches_manifest || !items.data.mapping_source_current || !items.data.parent_current || !items.data.household_current) && <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
        {items.data.superseded && <p>This binding has been replaced. Its historical evidence is retained.</p>}
        {(!items.data.mapping_matches_manifest || !items.data.mapping_source_current) && <p>The saved patient or contact mapping requires review.</p>}
        {!items.data.parent_current && <p>The parent source has changed since this scope was saved.</p>}
        {!items.data.household_current && <p>The saved household relationship has changed.</p>}
      </div>}
      {items.data.items.length === 0 ? <p className="text-sm">No observed source items on this page. Unseen source records remain unknown.</p> : <ul className="space-y-2">{items.data.items.map(item => <li key={`${item.page}:${item.ordinal}:${item.snapshot_id}`} className="min-w-0 rounded-md border bg-background p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-medium">{resourceName(items.data.resource)} #{item.external_id}</span><Badge variant="outline">{item.exact_source_current === null ? "Observed version not recorded" : item.exact_source_current ? "Observed version is current" : "Source version changed"}</Badge></div>
        <p className="text-muted-foreground">Page {item.page}{item.ordinal > 0 ? ` · Occurrence ${item.ordinal}` : " · Deduplicated snapshot"}</p>
        <Button type="button" variant="ghost" size="sm" className="h-auto min-h-10 max-w-full whitespace-normal text-left" disabled={locked} aria-expanded={expanded === item.evidence_hash} onClick={() => setExpanded(expanded === item.evidence_hash ? null : item.evidence_hash)}>Evidence references for source {item.external_id}, page {item.page}{item.ordinal > 0 ? `, occurrence ${item.ordinal}` : ""}</Button>
        {expanded === item.evidence_hash && <><dl className="mt-2 space-y-1 break-all text-xs"><dt className="text-muted-foreground">Snapshot reference</dt><dd>{item.snapshot_id}</dd><dt className="text-muted-foreground">Occurrence evidence hash</dt><dd>{item.evidence_hash}</dd></dl>
          <fieldset disabled={bindingDirty || resumeDirty}><MigrationResolutionForm actor={actor} manifest={manifest} scopeId={binding.scope_id} target={{ kind: "observation", binding_id: binding.id, page: item.page, ordinal: item.ordinal, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash }} onDirtyChange={setDecisionDirty} /></fieldset>
          {items.data.resource === "healthstatus" && <MigrationWeightEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {["contact", "animal"].includes(items.data.resource) && <MigrationIdentityEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {items.data.resource === "healthstatus" && <MigrationWeightEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {items.data.resource === "prescription" && <MigrationPrescriptionEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {items.data.resource === "prescriptionitem" && <MigrationPrescriptionItemEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {items.data.resource === "vaccination" && <MigrationVaccinationEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {items.data.resource === "history" && <MigrationHistoryEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
          {items.data.resource === "attachment" && <CaptureEvidence key={item.evidence_hash} actor={actor} binding={binding} item={item} />}
        </>}
      </li>)}</ul>}
      <Pagination disabled={locked} label="source item" previous={previous.length > 0} next={items.data.has_more} onPrevious={() => { setExpanded(null); setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }} onNext={() => { setExpanded(null); setPrevious([...previous, cursor]); setCursor(items.data.next_cursor); }} />
    </>}
  </section>;
}

interface CaptureProps extends Props { binding: MigrationBinding; item: MigrationItem }
function CaptureEvidence({ actor, binding, item }: CaptureProps) {
  const api = useMemo(() => createMigrationCaptureApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [cursor, setCursor] = useState<MigrationCursor | null>(null);
  const [previous, setPrevious] = useState<(MigrationCursor | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-capture-evidence", actor, binding.id, item.evidence_hash, cursor], retry: false, queryFn: () => api.list(binding, item, cursor) });
  const statuses: Record<string, string> = { prepared: "Capture prepared", reserved: "Upload reserved", ready: "Original captured", blocked: "Capture blocked", discarding: "Discard in progress", abandoned: "Capture abandoned" };
  return <section aria-label="Owned capture evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Your capture evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh capture evidence</Button></div>
    <p className="text-xs text-muted-foreground">Your requests for this source version. Other staff’s pending requests are not included. Stored bytes are not reverified by this view.</p>
    {query.isFetching ? <p role="status">Loading capture evidence…</p> : query.isError ? <Failure message="Capture evidence could not be loaded." retry={() => void query.refetch()} /> : query.data && <>
      <p className="text-xs text-muted-foreground">Capture state checked {recorded(query.data.observed_at)}.</p>
      {query.data.captures.length === 0 ? <p>No owned capture requests match this source version.</p> : <ul className="space-y-3">{query.data.captures.map(row => <li key={row.request_id} className="space-y-1 rounded-md border p-3">
        <p className="font-medium">{statuses[row.status]}</p>
        <p className="text-xs text-muted-foreground">{row.relationship === "exact_occurrence" ? "Request for this occurrence" : "Request for the same source version on another occurrence"} · {recorded(row.created_at)}</p>
        {!row.source_current && <p>Source changed since this request.</p>}
        {row.latest_error_code && <p>Latest capture error: {row.latest_error_code.toLowerCase().replace(/_/g, " ")}</p>}
        {row.capture && <p>Stored original receipt: {row.capture.mime_type} · {row.capture.file_size.toLocaleString()} bytes</p>}
        <p>Recorded approval versions: {row.approved_versions}</p><p>Canceled unconfirmed decisions: {row.canceled_unconfirmed_decisions}</p>
        {row.latest_approval && <p>Latest approval on this capture: version {row.latest_approval.version}{row.latest_approval.superseded ? " · Replaced by a later record" : ""}</p>}
      </li>)}</ul>}
      <Pagination label="capture evidence" previous={previous.length > 0} next={query.data.has_more} onPrevious={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }} onNext={() => { setPrevious([...previous, cursor]); setCursor(query.data.next_cursor); }} />
    </>}
  </section>;
}
