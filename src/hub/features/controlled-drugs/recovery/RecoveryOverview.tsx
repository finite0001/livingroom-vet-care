import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { CountClient } from "../count/count-client.ts";
import type { CountScopeItem } from "../count/count-admin-schema.ts";
import { AuthorizedScopeChooser } from "./AuthorizedScopeChooser";
import type { RecoveryClient } from "./client.ts";
import type { RecoveryOperations } from "./operation-controller.ts";
import type { RecoveryAgreement } from "./RecoveryPage";
import type { RecoveryPreflight, RecoveryReceipt, RecoveryStatus } from "./schema.ts";

interface RecoveryOverviewProps {
  readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly status: RecoveryStatus;
  readonly client: RecoveryClient; readonly operations: RecoveryOperations; readonly countClient: CountClient;
  readonly busy: boolean; readonly locked: boolean; readonly receipt: RecoveryReceipt | null; readonly agreements: readonly RecoveryAgreement[];
  readonly work: (task: () => Promise<void>) => Promise<void>; readonly save: (input: unknown) => Promise<void>;
}
function saveFile(bytes: Uint8Array, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime })), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.rel = "noopener"; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function occurred(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("Enter the reported date and time in UTC.");
  const date = new Date(value + "Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== (value.length === 16 ? value + ":00" : value)) throw new Error("Enter a valid reported time.");
  return date.toISOString();
}
export function RecoveryOverview({ sessions, identity, status, client, countClient, busy, locked, receipt, agreements, work, save }: RecoveryOverviewProps) {
  const [ready, setReady] = useState<RecoveryPreflight | null>(null), [armAcknowledged, setArmAcknowledged] = useState(false);
  const [markerId, setMarkerId] = useState(""), [markerHash, setMarkerHash] = useState(""), [capsuleHash, setCapsuleHash] = useState(""), [archiveHash, setArchiveHash] = useState("");
  const [scope, setScope] = useState<CountScopeItem | null>(null), [file, setFile] = useState<File | null>(null), [claim, setClaim] = useState("");
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 16)), [downloaded, setDownloaded] = useState<string[]>([]), [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<string[]>([]), [historyNote, setHistoryNote] = useState(""), [releaseAcknowledged, setReleaseAcknowledged] = useState(false);
  const [markerDraft, setMarkerDraft] = useState(false);
  const alive = useRef(true), fileInput = useRef<HTMLInputElement>(null);
  const dirty = markerDraft || !!file || claim !== "" || Object.values(notes).some(Boolean) || historyNote !== "" || releaseAcknowledged || armAcknowledged || capsuleHash !== "" || archiveHash !== "";
  const guard = useUnsavedChanges(dirty, "Your recovery notes, selected file or review draft have not been recorded. Pending saves remain recoverable.");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setReviewed([]); setDownloaded([]); }, [status.epoch_id]);
  useEffect(() => {
    if (receipt?.action === "backup_prepare") { setMarkerId(receipt.data.marker.marker_id); setMarkerHash(receipt.data.marker_hash); }
    if (receipt?.action === "arm") { setArmAcknowledged(false); setReady(null); }
    if (receipt?.action === "begin_epoch") { setCapsuleHash(""); setArchiveHash(""); setMarkerDraft(false); }
    if (receipt?.action === "preserve_evidence") { setFile(null); setClaim(""); if (fileInput.current) fileInput.current.value = ""; }
    if (receipt?.action === "acknowledge_evidence") {
      setNotes(previous => ({ ...previous, [receipt.data.evidence_id]: "" }));
      setReviewed(previous => previous.filter(id => id !== receipt.data.evidence_id));
    }
    if (receipt?.action === "release") { setHistoryNote(""); setReleaseAcknowledged(false); }
  }, [receipt]);
  const active = () => alive.current && sessions.isCurrent(identity);
  const fresh = status.mode === "armed" && !!status.epoch_id && status.fresh_session && !status.needs_new_epoch;
  function request(action: string, data: unknown, selectedHead = status) {
    return { schema_version: 1, actor_id: identity.actorId, operation_id: crypto.randomUUID(), action, expected_head_id: selectedHead.head_id, expected_head_hash: selectedHead.head_hash, data };
  }
  async function preserve() {
    if (!scope || !file || file.size < 1 || file.size > 2097152) throw new Error("Choose the medication and a supported original file up to 2 MiB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!active()) return;
    if (bytes.length !== file.size) throw new Error("The selected file changed.");
    const pieces: string[] = []; for (let index = 0; index < bytes.length; index += 4096) pieces.push(String.fromCharCode(...bytes.subarray(index, index + 4096)));
    await save(request("preserve_evidence", { product_id: scope.product_id, site_id: scope.site_id, reported_occurred_at: occurred(at), claim,
      filename: file.name, mime: file.type, base64: btoa(pieces.join("")) }));
    if (active()) { setFile(null); setClaim(""); if (fileInput.current) fileInput.current.value = ""; }
  }
  const everyCount = status.scopes.every(item => agreements.some(agreement => agreement.product_id === item.product_id && agreement.site_id === item.site_id));
  const everyReview = status.evidence.every(item => item.acknowledgment !== null);
  return <div className="space-y-6">{guard}
    {status.is_admin && status.mode === "idle" && <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-display text-xl">Prepare a protected backup</h2>
      <p className="text-sm text-muted-foreground">Check every registered medication and site before pausing recording. This control records preparation; your backup operator still creates and verifies the actual backup file.</p>
      <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => void work(async () => { const value = await client.preflight(identity); if (active()) setReady(value); })}>Check backup readiness</Button>
      {ready && <><p>{ready.inventory.products.length} medications · {ready.inventory.scopes.length} medication and site combinations.</p>
        <Label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={armAcknowledged} disabled={locked} onChange={event => setArmAcknowledged(event.target.checked)} />I am ready to pause normal recording while this backup is prepared.</Label>
        <Button type="button" className="min-h-11" disabled={locked || !armAcknowledged} onClick={() => void work(async () => {
          await save({ ...request("arm", { capture_hash: ready.capture_hash }), expected_head_id: ready.head_id, expected_head_hash: ready.head_hash });
          if (active()) { setArmAcknowledged(false); setReady(null); }
        })}>Pause recording and arm backup</Button></>}
    </section>}
    {status.is_admin && status.mode === "armed" && !status.epoch_id && <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-display text-xl">On the original server</h2>
      <p className="text-sm text-muted-foreground">Record a preparation marker before taking the backup. Resume the original server only if its stock history is unchanged.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={locked} onClick={() => void work(() => save(request("backup_prepare", {})))}>Record backup preparation</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => void work(() => save(request("source_resume", {})))}>Resume unchanged original server</Button></div>
    </section>}
    {receipt && <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Verified saved control"><h2 className="font-display text-xl">Saved recovery receipt</h2>
      <p>The saved result has been verified. Keep its receipt with the backup records.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => {
        if (active()) saveFile(new TextEncoder().encode(JSON.stringify(receipt, null, 2) + "\n"), "application/json", "narcotics-recovery-receipt.json");
      }}>Download saved receipt</Button></section>}
    {status.is_admin && status.mode === "armed" && (!status.epoch_id || status.needs_new_epoch) && <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-display text-xl">Begin on the restored server</h2>
      <p className="text-sm text-muted-foreground">Use the verified backup records supplied by your backup operator. Sign in again after the restored server starts. After an interruption, use the same original backup references.</p>
      <div className="grid gap-4 md:grid-cols-2">{([
        ["marker-id", "Backup preparation ID", markerId, setMarkerId], ["marker-hash", "Preparation verification hash", markerHash, setMarkerHash],
        ["archive-hash", "Backup file SHA-256", archiveHash, setArchiveHash], ["capsule-hash", "Backup inventory SHA-256", capsuleHash, setCapsuleHash],
      ] as const).map(([id, label, value, change]) => <div key={id} className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} className="min-h-11" value={value} disabled={locked} onChange={event => { change(event.target.value); setMarkerDraft(true); }} autoComplete="off" spellCheck={false} /></div>)}</div>
      <Button type="button" className="min-h-11" disabled={locked || !markerId || !markerHash || !capsuleHash || !archiveHash} onClick={() => void work(async () => {
        await save(request("begin_epoch", { marker_id: markerId, marker_hash: markerHash, external_capsule_sha256: capsuleHash, external_archive_sha256: archiveHash }));
        if (active()) { setCapsuleHash(""); setArchiveHash(""); setMarkerDraft(false); }
      })}>Begin recovery attempt</Button>
    </section>}
    {fresh && status.is_admin && <section className="space-y-4 rounded-xl border bg-card p-4"><h2 className="font-display text-xl">Retain evidence of missing history</h2>
      <p className="text-sm text-muted-foreground">Attach the original file and explain what staff report happened after the backup. It is retained as supporting evidence, not inserted as an original stock event.</p>
      <AuthorizedScopeChooser sessions={sessions} identity={identity} client={countClient} allowed={status.scopes} selected={scope} onSelect={setScope} />
      {scope && <p className="font-medium">{scope.product_name} · {scope.site_name}</p>}
      <div className="space-y-2"><Label htmlFor="recovery-time">Reported occurrence (UTC)</Label><Input id="recovery-time" className="min-h-11" type="datetime-local" value={at} disabled={locked} onChange={event => setAt(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="recovery-claim">Staff-reported account</Label><Textarea id="recovery-claim" value={claim} maxLength={4000} disabled={locked} onChange={event => setClaim(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="recovery-file">Original supporting file (up to 2 MiB)</Label><Input id="recovery-file" ref={fileInput} className="min-h-11" type="file" accept="application/json,text/plain,application/pdf,image/png,image/jpeg" disabled={locked} onChange={event => setFile(event.target.files?.[0] ?? null)} /></div>
      <Button type="button" className="min-h-11" disabled={locked || !file || !scope || !claim.trim()} onClick={() => void work(preserve)}>Record supporting evidence</Button>
    </section>}
    {status.evidence.length > 0 && <section className="space-y-4" aria-label="Independent evidence reviews"><h2 className="font-display text-xl">Independent evidence review</h2>
      <p className="text-sm text-muted-foreground">Review each exact file and staff account. The acknowledgment confirms that review; it does not certify a recovered original database event.</p>
      {status.evidence.map(({ evidence, acknowledgment }) => <article key={evidence.evidence_id} className="space-y-3 rounded-xl border bg-card p-4"><h3 className="break-words font-medium">{evidence.filename}</h3>
        <p className="whitespace-pre-wrap break-words">{evidence.claim}</p><p className="text-sm text-muted-foreground">Reported: {evidence.reported_occurred_at} · Recorded: {evidence.recorded_at}</p>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void work(async () => {
          const value = await client.download(evidence.evidence_id, identity); if (!active()) return;
          saveFile(value.bytes, value.evidence.mime, value.evidence.filename); setDownloaded(previous => [...new Set([...previous, evidence.evidence_id])]);
        })}>Download verified original file</Button>
        {acknowledgment && <p role="status">A review is recorded for this recovery attempt. A new login can record a replacement review if the earlier login is no longer valid.</p>}
        {fresh && evidence.actor_id !== identity.actorId && acknowledgment?.session_id !== identity.sessionId && <>
          <Label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={reviewed.includes(evidence.evidence_id)} disabled={locked || !downloaded.includes(evidence.evidence_id)}
            onChange={event => setReviewed(previous => event.target.checked ? [...new Set([...previous, evidence.evidence_id])] : previous.filter(id => id !== evidence.evidence_id))} />I reviewed this original file and the staff-reported account.</Label>
          <Label htmlFor={`review-${evidence.evidence_id}`}>Independent review note</Label><Textarea id={`review-${evidence.evidence_id}`} value={notes[evidence.evidence_id] ?? ""} maxLength={2000} disabled={locked} onChange={event => setNotes(previous => ({ ...previous, [evidence.evidence_id]: event.target.value }))} />
          <Button type="button" className="min-h-11" disabled={locked || !reviewed.includes(evidence.evidence_id) || !notes[evidence.evidence_id]?.trim()} onClick={() => void work(async () => {
            await save(request("acknowledge_evidence", { evidence_id: evidence.evidence_id, evidence_hash: evidence.record_hash, acknowledged: true, review_note: notes[evidence.evidence_id] }));
            if (active()) { setNotes(previous => ({ ...previous, [evidence.evidence_id]: "" })); setReviewed(previous => previous.filter(id => id !== evidence.evidence_id)); }
          })}>Sign independent review</Button>
        </>}
      </article>)}
    </section>}
    {fresh && status.is_admin && <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-display text-xl">Review and resume normal recording</h2>
      <p>{agreements.length} of {status.scopes.length} captured medication and site combinations have a selected fresh agreement. Open each completed agreement in its count screen to select it.</p>
      <p className="text-sm text-muted-foreground">The server checks every count, current stock, independent signature, and unresolved discrepancy again before release. Other stock restrictions stay in force.</p>
      <div className="space-y-2"><Label htmlFor="recovery-history-note">History review and recovery note</Label><Textarea id="recovery-history-note" value={historyNote} maxLength={4000} disabled={locked} onChange={event => setHistoryNote(event.target.value)} /></div>
      <Label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={releaseAcknowledged} disabled={locked} onChange={event => setReleaseAcknowledged(event.target.checked)} />I reviewed the restored history, missing-history evidence, and the selected independent counts.</Label>
      <Button type="button" className="min-h-11" disabled={locked || !everyCount || !everyReview || !releaseAcknowledged || !historyNote.trim()} onClick={() => void work(async () => {
        await save(request("release", { agreements: status.scopes.map(scope => agreements.find(item => item.product_id === scope.product_id && item.site_id === scope.site_id)),
          acknowledgments: status.evidence.map(item => ({ evidence_id: item.evidence.evidence_id, acknowledgment_id: item.acknowledgment?.acknowledgment_id })), history_review_note: historyNote }));
        if (active()) { setHistoryNote(""); setReleaseAcknowledged(false); }
      })}>Verify recovery and resume recording</Button>
    </section>}
  </div>;
}
