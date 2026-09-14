import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { createMigrationResumeApi } from "./migration-resume-api";
import type { MigrationResumeIdentity, MigrationResumeState } from "./migration-resume-api";
import type { MigrationRpc } from "./migration-run-api";
interface Props extends MigrationResumeIdentity { actor: string; onDirtyChange: (dirty: boolean) => void; onUpdated: () => void }
export function MigrationResume({ actor, manifest_id, scope_id, binding_id, onDirtyChange, onUpdated }: Props) {
  const api = useMemo(() => createMigrationResumeApi({
    rpc: (name, args) => (supabase as unknown as MigrationRpc).rpc(name, args),
    async readGenericRun(id, owner) {
      const { data, error } = await supabase.from("ezyvet_import_runs").select("id,requested_by,source_origin,source_site_uid,resource,status,next_page,retry_after,lease_until").eq("id", id).eq("requested_by", owner).maybeSingle();
      if (error) throw error; return data;
    },
    async invoke(body) { return await supabase.functions.invoke("ezyvet-import", { body }); },
  }, actor), [actor]);
  const [state, setState] = useState<MigrationResumeState | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(busy || uncertain); }, [busy, uncertain, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  async function recover() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setConfirmed(false); setNotice("");
    try {
      const saved = await api.recover({ manifest_id, scope_id, binding_id });
      if (!alive.current) return;
      setState(saved); setUncertain(false); onUpdated();
      setNotice("Saved run recovered. Review its current status before requesting another page.");
    } catch { if (alive.current) { setState(null); setError("Run recovery is unavailable. No resume request was sent. Check this same binding again."); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function resume() {
    if (lock.current || !state || uncertain || !confirmed || state.blockers.length) return;
    lock.current = true; setBusy(true); setUncertain(true); setError(""); setNotice(""); setConfirmed(false);
    try {
      await api.resume(state, () => alive.current);
      if (alive.current) { setNotice("One importer request returned. Recover the saved run to verify its current page and status."); onUpdated(); }
    } catch { if (alive.current) setError("Resume was not confirmed or the run changed. Recover this exact run before trying again."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section aria-label="Resume saved migration run" className="space-y-3 border-t pt-3">
    <h5 className="font-medium">Continue this source run</h5>
    <p className="text-sm text-muted-foreground">Each explicit request continues only the saved run through the existing importer. Other resources stay unchanged. Source coverage and clinical acceptance remain separate.</p>
    <Button type="button" variant="outline" disabled={busy} onClick={() => void recover()}>{busy ? "Checking run…" : "Recover run before resume"}</Button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {state && <>
      {["contact", "animal"].includes(state.resource) && <p className="text-sm">This identity run scans the source list and may fetch other source records. Reconciliation counts only the identity selected in this scope.</p>}
      <p className="break-words text-sm">{state.source_site_uid} · source parent #{state.parent_external_id} · next page {state.next_page}</p>
      {state.retry_after && <p className="text-sm">Retry after {new Date(state.retry_after).toLocaleString()}</p>}
      {state.blockers.length > 0 ? <ul className="space-y-1 text-sm">{state.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy || uncertain} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed this saved source run and want to request one more page.</label>}
      <Button type="button" disabled={busy || uncertain || !confirmed || state.blockers.length > 0} onClick={() => void resume()}>Resume one page</Button>
    </>}
  </section>;
}
