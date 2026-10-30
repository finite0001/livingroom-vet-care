import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { RegisterClient } from "./client.ts";
import type { RegisterOperations } from "./operation-controller.ts";
import { parseRegisterPointer, registerFormMetadata, type RegisterDataset, type RegisterListReply, type RegisterReply, type RegisterReportSaved } from "./schema.ts";
import { parseRegisterDataset, registerSha } from "./wire.ts";
import { RegisterReport } from "./RegisterReport";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import "./register-print.css";

interface RegisterWorkspaceProps {
  readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: RegisterClient; readonly operations: RegisterOperations;
  readonly productId: string; readonly siteId: string;
}
function utcInput(at: number) { return new Date(at).toISOString().slice(0, 19); }
function inputInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("Enter a UTC date and time.");
  const result = new Date(value + "Z"); if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 19) !== (value.length === 16 ? value + ":00" : value)) throw new Error("Enter a valid UTC date and time."); return result.toISOString();
}
function download(bytes: Uint8Array, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.rel = "noopener";
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** The parent keys this workspace by the actual staff session and selected scope. */
export function RegisterWorkspace({ sessions, identity, client, operations, productId, siteId }: RegisterWorkspaceProps) {
  const [from, setFrom] = useState(() => utcInput(Date.now() - 86400000)), [until, setUntil] = useState(() => utcInput(Date.now()));
  const [reply, setReply] = useState<RegisterReply | null>(null), [report, setReport] = useState<RegisterReportSaved | null>(null), [dataset, setDataset] = useState<RegisterDataset | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [printing, setPrinting] = useState(false);
  const [kind, setKind] = useState("supplier_receipt"), [title, setTitle] = useState(""), [obtained, setObtained] = useState(() => utcInput(Date.now())), [eventId, setEventId] = useState("");
  const [file, setFile] = useState<File | null>(null); const running = useRef(false), alive = useRef(true), fileInput = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<RegisterListReply | null>(null);
  const guard = useUnsavedChanges(!!file || title !== "" || eventId !== "", "Your supporting-file draft has not been recorded. Pending saves remain recoverable.");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && sessions.isCurrent(identity);
  let pending = false, storageError = false;
  try { pending = Boolean(operations.pending(identity.actorId)); } catch { storageError = true; }
  useEffect(() => {
    if (!printing) return;
    const finish = () => setPrinting(false); window.addEventListener("afterprint", finish);
    const frame = requestAnimationFrame(() => {
      if (!alive.current || !sessions.isCurrent(identity)) { finish(); return; }
      try { window.print(); } catch { finish(); setMessage("Printing could not start. You can still download the verified report."); }
    });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("afterprint", finish); };
  }, [identity, printing, sessions]);
  function accept(result: RegisterReply) {
    if (result.state === "saved" && (result.request_metadata.product_id !== productId || result.request_metadata.site_id !== siteId)) {
      setMessage("The original result was verified for another medication or site. Open that medication to view it."); return;
    }
    setReply(result);
    if (result.state === "saved" && result.kind === "form") { setFile(null); setTitle(""); setEventId(""); if (fileInput.current) fileInput.current.value = ""; }
    if (result.state === "saved" && result.kind === "report") { setReport(result); setDataset(parseRegisterDataset(result.data.dataset_text)); setEventId(""); }
    setMessage(result.state === "saved" ? "Saved and verified." : result.state === "abandoned" ? "The original operation is permanently closed. You can start another." : "No saved result is visible yet. Keep checking, or permanently close this operation before starting another.");
  }
  async function work(task: () => Promise<void>) {
    if (running.current || !current()) return; running.current = true; setBusy(true); setMessage("");
    try { await task(); }
    catch (error) { if (current()) setMessage(error instanceof z.ZodError ? "Check the dates, title and file format, then try again." : error instanceof Error ? error.message : "The result is unconfirmed. Recover the original operation."); }
    finally { running.current = false; if (current()) { setBusy(false); } }
  }
  async function create() {
    const request = { schema_version: 1, actor_id: identity.actorId, operation_id: crypto.randomUUID(), product_id: productId, site_id: siteId, from_at: inputInstant(from), to_at: inputInstant(until) };
    const result = await operations.save("report", request, identity); if (current()) accept(result);
  }
  async function preserve() {
    if (!file || file.size < 1 || file.size > 2097152) throw new Error("Choose a PDF, PNG or JPEG up to 2 MiB.");
    if (eventId && !dataset?.events.some(event => event.event_id === eventId)) throw new Error("Choose a movement from the current report before saving this file.");
    const metadata = registerFormMetadata.parse({ schema_version: 1, actor_id: identity.actorId, operation_id: crypto.randomUUID(), product_id: productId, site_id: siteId,
      event_id: eventId || null, kind, title, filename: file.name, obtained_at: inputInstant(obtained), mime: file.type });
    const bytes = new Uint8Array(await file.arrayBuffer()); if (!current()) return;
    if (bytes.length !== file.size) throw new Error("The selected file changed. Choose it again.");
    const chunks: string[] = []; for (let index = 0; index < bytes.length; index += 4096) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 4096)));
    const result = await operations.save("form", { ...metadata, base64: btoa(chunks.join("")) }, identity);
    if (current()) accept(result);
  }
  async function recover(mode: "read" | "close") { const result = await operations.recover(mode, identity); if (current()) accept(result); }
  async function historyPage(after: string | null = null) {
    const result = await client.list({ schema_version: 1, actor_id: identity.actorId, product_id: productId, site_id: siteId, after_operation_id: after, page_size: 50 }, identity);
    if (current()) setHistory(result);
  }
  async function openReport(operation: string) {
    const result = await client.recover("read", parseRegisterPointer({ schema_version: 1, actor_id: identity.actorId, operation_id: operation, product_id: productId, site_id: siteId, kind: "report" }), identity);
    if (current()) accept(result);
  }
  async function original(form: NonNullable<RegisterDataset["supporting_forms"]>[number]) {
    const result = await client.download(form.form_id!, identity); if (!current()) return;
    if (result.metadata.sha256 !== form.sha256 || result.metadata.document_hash !== form.document_hash || result.metadata.byte_length !== form.byte_length || result.metadata.filename !== form.filename) throw new Error("The original file differs from the selected report. Ask an administrator to review it.");
    download(result.bytes, result.metadata.mime, result.metadata.filename);
  }
  async function exportReport(format: "csv" | "json") {
    if (!report || !dataset || !current()) return;
    const text = format === "csv" ? report.data.csv_text : report.data.dataset_text, expected = format === "csv" ? report.data.csv_hash : report.data.dataset_hash;
    const bytes = new TextEncoder().encode(text); if (await registerSha(bytes) !== expected) throw new Error("The report bytes could not be verified.");
    if (current()) download(bytes, format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8", `narcotics-schedule-${dataset.schedule}-${dataset.report_id}.${format}`);
  }
  return <section className="space-y-6" aria-label="Register exports and supporting files">{guard}
    <header className="space-y-2"><h2 className="font-display text-xl">Register exports and supporting files</h2><p className="text-sm text-muted-foreground">Create a separate report for each medication, registered site and schedule. Administrator audit access is required.</p></header>
    {storageError && <p role="alert" className="text-destructive">Browser recovery storage could not be read. Ask an administrator to review it before saving.</p>}
    {pending && <section className="space-y-3 rounded-xl border p-4"><h3 className="font-medium">An earlier save needs recovery</h3><p className="text-sm">Check its original result. Permanently closing it prevents a delayed request from saving later.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void work(() => recover("read"))}>Check original result</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void work(() => recover("close"))}>Permanently close original operation</Button></div></section>}
    <section className="space-y-3 rounded-xl border p-4"><h3 className="font-display text-lg">Your saved reports</h3>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void work(() => historyPage())}>Load saved reports</Button>
      {history && history.items.length === 0 && <p role="status">You have no saved reports for this medication and site.</p>}
      {history && <ul className="space-y-2">{history.items.map(item => <li key={item.operation_id}><Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal text-left" disabled={busy} onClick={() => void work(() => openReport(item.operation_id!))}>Period {item.from_at} to {item.to_at} · Captured {item.captured_at}</Button></li>)}</ul>}
      {history?.has_more && <Button type="button" variant="outline" disabled={busy} onClick={() => void work(() => historyPage(history.next_operation_id))}>Older reports</Button>}
    </section>
    <form className="space-y-4 rounded-xl border p-4" onSubmit={event => { event.preventDefault(); void work(create); }}>
      <h3 className="font-display text-lg">Create a register report</h3><div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="register-from">From (UTC)</Label><Input className="min-h-11" id="register-from" type="datetime-local" step="1" value={from} onChange={event => setFrom(event.target.value)} required disabled={busy || pending || storageError} /></div>
        <div className="space-y-2"><Label htmlFor="register-until">Until (UTC, end excluded)</Label><Input className="min-h-11" id="register-until" type="datetime-local" step="1" value={until} onChange={event => setUntil(event.target.value)} required disabled={busy || pending || storageError} /></div>
      </div><p className="text-sm text-muted-foreground">Maximum period: 31 days. Evidence that exceeds the export limit requires administrator review; it is never silently omitted.</p>
      <Button className="min-h-11" type="submit" disabled={busy || pending || storageError}>{busy ? "Working…" : "Create and verify report"}</Button>
    </form>
    <form className="space-y-4 rounded-xl border p-4" onSubmit={event => { event.preventDefault(); void work(preserve); }}>
      <h3 className="font-display text-lg">Preserve a supporting original</h3><p className="text-sm text-muted-foreground">Save a supplier receipt, registration or order form. Existing report snapshots stay unchanged; create a new report to include later files.</p>
      <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="register-kind">Document kind</Label><select id="register-kind" className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={kind} onChange={event => setKind(event.target.value)} disabled={busy || pending || storageError}>
        <option value="supplier_receipt">Supplier receipt</option><option value="registration">Registration</option><option value="order_form">Order form</option><option value="other">Other supporting file</option>
      </select></div><div className="space-y-2"><Label htmlFor="register-title">Title</Label><Input className="min-h-11" id="register-title" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} required disabled={busy || pending || storageError} /></div>
      <div className="space-y-2"><Label htmlFor="register-obtained">Obtained at (UTC, staff reported)</Label><Input className="min-h-11" id="register-obtained" type="datetime-local" step="1" value={obtained} onChange={event => setObtained(event.target.value)} required disabled={busy || pending || storageError} /></div>
      <div className="space-y-2"><Label htmlFor="register-event">Related movement</Label><select id="register-event" className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={eventId} onChange={event => setEventId(event.target.value)} disabled={busy || pending || storageError}><option value="">Medication and site document</option>
        {dataset?.events.map(event => <option key={event.event_id} value={event.event_id}>#{event.sequence} · {event.event_kind.replace(/_/g, " ")} · {event.recorded_at}</option>)}</select></div></div>
      <div className="space-y-2"><Label htmlFor="register-file">Original PDF, PNG or JPEG (up to 2 MiB)</Label><Input className="min-h-11" ref={fileInput} id="register-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] ?? null)} required disabled={busy || pending || storageError} /></div>
      <Button type="submit" className="min-h-11" disabled={busy || pending || storageError}>Preserve original file</Button>
    </form>
    {message && <p role="status" className="whitespace-pre-wrap break-words">{message}</p>}
    {reply?.state === "saved" && reply.kind === "form" && <p className="break-all text-sm">Original file saved: {reply.data.filename} · SHA-256 {reply.data.sha256}</p>}
    {report && dataset && <section className="space-y-4"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void work(() => exportReport("csv"))}>Download verified CSV</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void work(() => exportReport("json"))}>Download original evidence</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy || printing} onClick={() => setPrinting(true)}>Print / save PDF</Button></div>
      <RegisterReport dataset={dataset} datasetHash={report.data.dataset_hash} csvHash={report.data.csv_hash} />
      {dataset.supporting_forms.length > 0 && <div className="space-y-2"><h3 className="font-display text-lg">Download supporting originals</h3>{dataset.supporting_forms.map(form => <div key={form.form_id}><Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal text-left" disabled={busy} onClick={() => void work(() => original(form))}>{form.title} · {form.filename}</Button></div>)}</div>}
    </section>}
    {printing && report && dataset && createPortal(<div data-narcotics-print-root="true" className="bg-background p-4 text-foreground"><RegisterReport dataset={dataset} datasetHash={report.data.dataset_hash} csvHash={report.data.csv_hash} /></div>, document.body)}
  </section>;
}
