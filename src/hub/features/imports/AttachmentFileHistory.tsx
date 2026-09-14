import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { listAttachmentFileHistory, recoverAttachmentFile, recoverAttachmentFileScan } from "./attachment-file-api";
import type { AttachmentFileIntent } from "./attachment-file-state";
import type { AttachmentMapping, AttachmentRun, AttachmentHistoryCursor } from "./attachment-discovery-state";
interface Props { actor: string; mapping: AttachmentMapping; disabled: boolean; onLocked: (locked: boolean) => void; onOpen: (run: AttachmentRun, intent: AttachmentFileIntent) => void; }
export function AttachmentFileHistory({ actor, mapping, disabled, onLocked, onOpen }: Props) {
  const [cursor, setCursor] = useState<AttachmentHistoryCursor | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const lock = useRef(false), alive = useRef(true);
  const history = useQuery({ queryKey: ["attachment-file-history", actor, mapping.pet_id, mapping.link_id, cursor], queryFn: () => listAttachmentFileHistory(actor, mapping, cursor), retry: false });
  useEffect(() => { alive.current = true; return () => { alive.current = false; onLocked(false); }; }, [onLocked]);
  useEffect(() => { onLocked(busy); }, [busy, onLocked]);
  async function open(intent: AttachmentFileIntent) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      const recovered = await recoverAttachmentFile(intent);
      if (!recovered) throw new Error("Missing request");
      const run = await recoverAttachmentFileScan(intent, mapping);
      if (!alive.current) return;
      const restored = { ...intent, requestHash: recovered.requestHash };
      sessionStorage.setItem(`lrv-attachment-file:${actor}:${mapping.pet_id}:${intent.runId}:${intent.page}:${intent.snapshotId}:${intent.headVersion}`, JSON.stringify(restored));
      onOpen(run, restored);
      setNotice(recovered.captured ? "Captured source request verified and reopened. Clinical review remains required." : "Saved file request verified and reopened at its original source page.");
    } catch { if (alive.current) setNotice("The full file request could not be verified or reopened. Keep its saved reference and recheck; no capture was requested."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section aria-label="Saved attachment file requests" className="space-y-3 rounded border p-3">
    <h3 className="font-semibold">Saved file requests</h3>
    <p className="text-sm text-muted-foreground">Recover your prepared, captured or abandoned copies for this patient. Captured copies still require clinical review.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {history.isFetching && <p role="status">Loading saved file requests…</p>}
    {history.isError && <p role="alert">Saved file requests are unavailable. Recheck before continuing.</p>}
    {!history.isError && history.data?.requests.length === 0 && <p>No saved file requests on this page.</p>}
    {!history.isError && history.data?.requests.map(item => <div key={item.id} className="space-y-2 rounded border p-3">
      <p className="text-sm">{item.intent?.name ?? "Abandoned before source preparation"} · saved status: {item.status}</p>
      <p className="break-all text-xs text-muted-foreground">{item.id} · {new Date(item.createdAt).toLocaleString()}</p>
      {item.intent && !item.sameMapping && <p className="text-sm">This request belongs to another source mapping for this patient. Select that mapping to reopen it.</p>}
      <Button variant="secondary" disabled={disabled || busy || !item.intent || !item.sameMapping} onClick={() => item.intent && void open(item.intent)}>Recover file request {item.id.slice(0, 8)}</Button>
    </div>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={disabled || busy || history.isFetching} onClick={() => void history.refetch()}>Refresh saved file requests</Button>
      <Button variant="secondary" disabled={disabled || busy || history.isFetching || !cursor} onClick={() => setCursor(null)}>Newest file requests</Button>
      <Button variant="secondary" disabled={disabled || busy || history.isFetching || history.isError || !history.data?.next_cursor} onClick={() => setCursor(history.data?.next_cursor ?? null)}>Older file requests</Button>
    </div>
  </section>;
}
