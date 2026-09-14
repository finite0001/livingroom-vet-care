import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { listClinicalCandidates } from "./clinical-api";
import { getAttachmentAnimalParent, prepareAttachmentScan } from "./attachment-discovery-api";
import { AttachmentPreparationError } from "./attachment-page-errors";
import { attachmentConsultParent, parseAttachmentPreparation } from "./attachment-discovery-state";
import type { AttachmentMapping, AttachmentParent, AttachmentRun, AttachmentPreparation, AttachmentHistoryCursor } from "./attachment-discovery-state";
interface Props {
  actor: string;
  mapping: AttachmentMapping;
  disabled: boolean;
  onLocked: (locked: boolean) => void;
  onCreated: (run: AttachmentRun) => void;
}
export function AttachmentScanPreparation({ actor, mapping, disabled, onLocked, onCreated }: Props) {
  const queryClient = useQueryClient();
  const storageKey = `lrv-attachment-preparation:${actor}:${mapping.link_id}`;
  const [pending, setPending] = useState<AttachmentPreparation | null>(null);
  const [invalidPointer, setInvalidPointer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freshAllowed, setFreshAllowed] = useState(false);
  const [notice, setNotice] = useState("");
  const [cursor, setCursor] = useState<AttachmentHistoryCursor | null>(null);
  const lock = useRef(false), alive = useRef(true);
  const animal = useQuery({ queryKey: ["attachment-new-parent", actor, mapping.link_id], queryFn: () => getAttachmentAnimalParent(mapping), retry: false });
  const consults = useQuery({ queryKey: ["attachment-new-consults", actor, mapping.link_id, cursor], queryFn: () => listClinicalCandidates(mapping, "consult", cursor), retry: false });
  useEffect(() => {
    alive.current = true;
    try {
      const value = sessionStorage.getItem(storageKey);
      if (value) { setPending(parseAttachmentPreparation(JSON.parse(value), actor, mapping)); setNotice("An earlier preparation is retained. Recover it before choosing another source."); }
    } catch { setInvalidPointer(true); setNotice("The local preparation reference could not be read. Use saved scan history to locate any earlier scan before clearing the local reference."); }
    return () => { alive.current = false; onLocked(false); };
  }, [storageKey, actor, mapping, onLocked]);
  useEffect(() => { onLocked(busy || !!pending); }, [busy, pending, onLocked]);
  const blocked = disabled || busy || !!pending || invalidPointer;
  async function prepare(parent?: AttachmentParent) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setFreshAllowed(false);
    try {
      const intent = pending ?? parseAttachmentPreparation({ id: crypto.randomUUID(), actor, parent }, actor, mapping);
      // Persist before RPC. If persistence fails, no new request is sent.
      sessionStorage.setItem(storageKey, JSON.stringify(intent));
      setPending(intent);
      const run = await prepareAttachmentScan(intent.id, actor, mapping, intent.parent);
      try { sessionStorage.removeItem(storageKey); } catch { /* A retained exact ID recovers the same scan on return. */ }
      if (!alive.current) return;
      setPending(null); setNotice("Scan saved. Select Read next attachment page to begin reading source metadata.");
      onCreated(run);
      await queryClient.invalidateQueries({ queryKey: ["attachment-scans", actor, mapping.link_id] });
    } catch (error) {
      if (alive.current) {
        setNotice(error instanceof AttachmentPreparationError ? error.message : "Preparation could not be confirmed. Keep the original reference and recover it before creating another scan.");
        setFreshAllowed(error instanceof AttachmentPreparationError && error.canChooseFreshContext);
      }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function clearLocal() {
    try {
      sessionStorage.removeItem(storageKey); setPending(null); setInvalidPointer(false); setFreshAllowed(false);
      setNotice("Local preparation reference cleared. Refresh source context before choosing a scan.");
      void animal.refetch(); void consults.refetch();
    } catch { setNotice("Local preparation reference could not be cleared. Keep this view open and restore browser storage access."); }
  }
  return <section aria-label="Prepare attachment scan" className="space-y-3 rounded border p-3">
    <h3 className="font-semibold">Create an attachment scan</h3>
    <p className="text-sm text-muted-foreground">Choose patient files or one current consultation. This saves the scan identity; reading files and clinical review are separate steps.</p>
    {notice && <p role={pending || invalidPointer ? "alert" : "status"}>{notice}</p>}
    {pending && <div className="space-y-2"><p className="break-all text-xs">Preparation reference: {pending.id}</p><Button variant="secondary" disabled={busy || disabled} onClick={() => void prepare()}>Recover scan preparation</Button></div>}
    {(freshAllowed || invalidPointer) && <Button variant="secondary" disabled={busy || disabled} onClick={clearLocal}>{invalidPointer ? "Clear unreadable local reference" : "Choose fresh source context"}</Button>}
    {(animal.isFetching || consults.isFetching) && <p role="status">Loading current attachment source context…</p>}
    {animal.isError && <p role="alert">Patient source context is unavailable. Refresh it before preparing a scan.</p>}
    {!animal.isError && !animal.isFetching && !animal.data && <p>No current patient source context is available.</p>}
    <Button variant="secondary" disabled={blocked || animal.isFetching || animal.isError || !animal.data} onClick={() => void prepare(animal.data)}>Create patient attachment scan</Button>
    {consults.isError && <p role="alert">Consultation source history is unavailable.</p>}
    {!consults.isError && consults.data?.candidates.length === 0 && <p>No consultation sources on this page.</p>}
    {!consults.isError && consults.data?.candidates.map(candidate => {
      let parent: AttachmentParent | null = null;
      try { if (animal.data && !animal.isError) parent = attachmentConsultParent(candidate, animal.data, mapping); } catch { /* Historical context stays visible but cannot start a new scan. */ }
      return <div key={candidate.id} className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Consultation {candidate.external_id}{!parent ? " · source requires refresh" : ""}</span>
        <Button variant="secondary" disabled={blocked || animal.isFetching || consults.isFetching || !parent} onClick={() => parent && void prepare(parent)}>Create scan for consultation {candidate.external_id}</Button>
      </div>;
    })}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={blocked || animal.isFetching || consults.isFetching} onClick={() => { void animal.refetch(); void consults.refetch(); }}>Refresh attachment source context</Button>
      <Button variant="secondary" disabled={blocked || consults.isFetching || !cursor} onClick={() => setCursor(null)}>Newest consultation sources</Button>
      <Button variant="secondary" disabled={blocked || consults.isFetching || consults.isError || !consults.data?.next_cursor} onClick={() => setCursor(consults.data?.next_cursor ?? null)}>Older consultation sources</Button>
    </div>
  </section>;
}
