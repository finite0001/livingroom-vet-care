import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationWeightApi } from "./migration-weight-api";
import type { MigrationWeightCursor } from "./migration-weight-api";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationWeightEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationWeightApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [before, setBefore] = useState<MigrationWeightCursor | null>(null);
  const query = useQuery({ queryKey: ["migration-weight-evidence", actor, binding.id, item.evidence_hash, before], retry: false, queryFn: () => api.read(binding, item, before) });
  const data = query.data;
  return <section aria-label="Weight approval evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Weight approval evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh weight evidence</Button></div>
    <p className="text-xs text-muted-foreground">These observations retain snapshots without the source version observed on each page. Snapshot agreement cannot establish exact version matching or complete migration coverage. Source-change acknowledgments do not create or replace local weights.</p>
    {query.isFetching ? <p role="status">Loading weight evidence…</p> : query.isError ? <p role="alert">Weight evidence could not be loaded. Refresh to try again.</p> : data && <>
      {data.approval ? <div className="space-y-1 rounded-md border p-3">
        <p className="font-medium">{data.approval.action === "create" ? "Created local weight" : "Linked existing local weight"}</p>
        <p>{data.approval.relationship === "same_snapshot_unknown_observed_head" ? "Approval uses the same snapshot; the observed version is unknown." : "Approval uses a different source snapshot."}</p>
        <p>{data.approval.source_current ? "Approved source version is current." : "Approved source version is no longer current."}</p>
        <p>{data.approval.local_weight_matches_review ? "Local measurement still matches the approved values." : "Local measurement no longer matches the approved values."}</p>
        <p>{data.approval.patient_version_unchanged ? "Patient version is unchanged since approval." : "Patient record has changed since approval."}</p>
        <p>{data.approval.household_current ? "Household association still matches." : "Household association no longer matches."}</p>
        <p className="text-xs text-muted-foreground">Approved {new Date(data.approval.approved_at).toLocaleString()}.</p>
      </div> : <p>No approved local weight matches this source identity and patient mapping.</p>}
      <h6 className="font-medium">Source-change acknowledgments</h6>
      {data.source_reviews.length === 0 ? <p>No acknowledgments on this page.</p> : data.source_reviews.map(review => <div key={review.id} className="space-y-1 rounded-md border p-3">
        <p>{review.relationship === "same_snapshot_unknown_observed_head" ? "Acknowledged snapshot matches; the observed version is unknown." : "Acknowledgment concerns a different snapshot."}</p>
        <p>{review.source_current ? "Acknowledged source version is current." : "Acknowledged source version is no longer current."}</p>
        <p className="text-xs text-muted-foreground">Acknowledged {new Date(review.created_at).toLocaleString()}. This did not promote or replace a local measurement.</p>
      </div>)}
      <div className="flex flex-wrap gap-2">{before && <Button type="button" size="sm" variant="outline" onClick={() => setBefore(null)}>Newest acknowledgments</Button>}{data.has_more && data.next_cursor && <Button type="button" size="sm" variant="outline" onClick={() => setBefore(data.next_cursor)}>Older acknowledgments</Button>}</div>
      <p className="text-xs text-muted-foreground">Checked {new Date(data.observed_at).toLocaleString()}. Each page is a live view, not a frozen report.</p>
    </>}
  </section>;
}
