import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { searchMappings } from "./clinical-api";
import { listAttachmentRuns, listAttachmentObservations } from "./attachment-discovery-api";
import type { AttachmentMapping, AttachmentHistoryCursor, AttachmentObservationCursor, AttachmentRun } from "./attachment-discovery-state";
interface Props { actor: string; }
interface SelectedMapping extends AttachmentMapping { patient_name: string; household_name: string; }
export function AttachmentScanHistory({ actor }: Props) {
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState<SelectedMapping | null>(null);
  const patients = useQuery({ queryKey: ["attachment-patients", actor, search], enabled: search.trim().length >= 2, queryFn: () => searchMappings(search), retry: false });
  return <section aria-label="Attachment scan history" className="space-y-4 rounded-md border p-4">
    <div><h2 className="text-xl font-semibold">Source attachment history</h2><p className="text-sm text-muted-foreground">Find files observed in your saved ezyVet scans. Source files require review before they become part of the medical record.</p></div>
    <label className="block">Find attachment history patient<Input value={search} onChange={event => setSearch(event.target.value)} maxLength={200} /></label>
    {patients.isFetching && <p role="status">Finding mapped patients…</p>}
    {patients.isError && <p role="alert">Patient search is unavailable. Try again without changing the saved scan.</p>}
    {patients.data?.length === 0 && <p>No mapped patients match this search.</p>}
    {/* searchMappings validates these required fields; the project's non-strict null typing makes its inferred fields optional. */}
    <div className="flex flex-wrap gap-2">{patients.data?.map(item => <Button key={item.link_id} variant="secondary" aria-pressed={mapping?.link_id === item.link_id} onClick={() => setMapping(item as SelectedMapping)}>{item.patient_name} · {item.household_name}</Button>)}</div>
    {mapping && <PatientScans key={`${actor}:${mapping.link_id}`} actor={actor} mapping={mapping} />}
  </section>;
}
interface PatientProps { actor: string; mapping: SelectedMapping; }
function PatientScans({ actor, mapping }: PatientProps) {
  const [cursor, setCursor] = useState<AttachmentHistoryCursor | null>(null);
  const [selected, setSelected] = useState<AttachmentRun | null>(null);
  const scans = useQuery({ queryKey: ["attachment-scans", actor, mapping.link_id, cursor], queryFn: () => listAttachmentRuns(actor, mapping, cursor), retry: false });
  const labels = { running: "Scan in progress", review_ready: "Scan complete", page_limit_reached: "Scan limit reached" };
  return <div className="space-y-3">
    <p className="font-medium">Selected patient: {mapping.patient_name} · {mapping.household_name}</p>
    {scans.isFetching && <p role="status">Loading saved attachment scans…</p>}
    {scans.isError && <p role="alert">Saved attachment scans are unavailable. Recheck before choosing a file.</p>}
    {!scans.isError && scans.data?.runs.length === 0 && <p>No saved attachment scans on this page.</p>}
    {!scans.isError && scans.data?.runs.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-3">
      <Badge variant="secondary">{item.parent_context.parent_type === "Animal" ? "Patient files" : `Consultation ${item.parent_context.parent_external_id}`}</Badge>
      <span>{labels[item.status]} · {new Date(item.created_at).toLocaleString()}</span>
      <Button variant="secondary" onClick={() => setSelected(item)} aria-pressed={selected?.id === item.id}>View files from scan {item.id.slice(0, 8)}</Button>
    </div>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={scans.isFetching} onClick={() => void scans.refetch()}>Refresh attachment scans</Button>
      <Button variant="secondary" disabled={!cursor || scans.isFetching} onClick={() => setCursor(null)}>Newest attachment scans</Button>
      <Button variant="secondary" disabled={scans.isFetching || scans.isError || !scans.data?.next_cursor} onClick={() => setCursor(scans.data?.next_cursor ?? null)}>Older attachment scans</Button>
    </div>
    {selected && <ScanFiles key={selected.id} actor={actor} mapping={mapping} scan={selected} />}
  </div>;
}
interface FilesProps extends PatientProps { scan: AttachmentRun; }
function ScanFiles({ actor, mapping, scan }: FilesProps) {
  const [cursor, setCursor] = useState<AttachmentObservationCursor | null>(null);
  const files = useQuery({ queryKey: ["attachment-observations", actor, mapping.link_id, scan.id, cursor], queryFn: () => listAttachmentObservations(scan.id, mapping, scan.parent_context, cursor), retry: false });
  return <section aria-label="Files observed in selected scan" className="space-y-3">
    <h3 className="font-semibold">Files observed in this scan</h3>
    <p className="text-sm text-muted-foreground">{scan.status === "running" ? "This scan is still in progress. The list includes only pages already saved." : scan.status === "page_limit_reached" ? "The scan reached its limit. More source files may remain." : "This scan completed for the selected patient or consultation. It does not establish complete migration of the patient's records."}</p>
    {files.isFetching && <p role="status">Loading observed files…</p>}
    {files.isError && <p role="alert">File evidence is unavailable or changed unexpectedly. Recheck the saved scan.</p>}
    {!files.isError && files.data && <>
      {!files.data.parent_is_current && <p role="status">The patient or consultation source has changed since this scan. These original observations are retained for review.</p>}
      {files.data.observations.length === 0 && <p>No observed files on this page.</p>}
      {files.data.observations.map(file => <article key={`${file.page}:${file.snapshot_id}`} className="space-y-2 rounded border p-3">
        <h4 className="break-words font-medium">{file.metadata.name || `Source attachment ${file.external_id}`}{file.metadata.name_truncated ? "… (name shortened)" : ""}</h4>
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">{file.is_current ? "Latest observed file revision" : "File source changed"}</Badge><span className="text-sm">{file.metadata.mime_type || "File type not supplied"}</span></div>
        {file.metadata.mime_type && !["application/pdf", "image/jpeg", "image/png", "application/octet-stream"].includes(file.metadata.mime_type.toLowerCase().split(";")[0].trim()) && <p className="text-sm">This file type needs separate review; it is not supported by the current file capture process.</p>}
        {file.metadata.notes && <p className="whitespace-pre-wrap break-words text-sm">{file.metadata.notes}{file.metadata.notes_truncated ? "\nNotes preview shortened; full source evidence is retained." : ""}</p>}
        <p className="text-xs text-muted-foreground">Source attachment {file.external_id} · saved page {file.page} · observed revision {file.observed_head_version}</p>
      </article>)}
    </>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={files.isFetching} onClick={() => void files.refetch()}>Recheck observed files</Button>
      <Button variant="secondary" disabled={!cursor || files.isFetching} onClick={() => setCursor(null)}>First file page</Button>
      <Button variant="secondary" disabled={files.isFetching || files.isError || !files.data?.next_cursor} onClick={() => setCursor(files.data?.next_cursor ?? null)}>Next file page</Button>
    </div>
  </section>;
}
