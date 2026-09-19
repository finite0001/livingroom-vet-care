import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationPrescriptionItemApi } from "./migration-prescription-item-api";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationPrescriptionItemEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationPrescriptionItemApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [before, setBefore] = useState<number | null>(null);
  const [previous, setPrevious] = useState<(number | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-prescription-item-evidence", actor, binding.id, item.evidence_hash, before], retry: false,
    queryFn: () => api.list(binding, item, before) });
  return <section aria-label="Prescription item review evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Prescription item review evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh prescription item evidence</Button></div>
    <p className="text-xs text-muted-foreground">Approved outside prescription for this patient and source identity, including reviews by other staff. These reviews do not prescribe or dispense medication here. Each receipt distinguishes item selection from omitted or differently versioned source observations.</p>
    {query.isFetching ? <p role="status">Loading prescription item evidence…</p> : query.isError ? <p role="alert">Prescription item evidence could not be loaded. Refresh to try again.</p> : query.data && <>
      <p className="text-xs text-muted-foreground">Checked {new Date(query.data.observed_at).toLocaleString()}. Local prescribing and complete migration coverage are not assessed here.</p>
      {query.data.approvals.length === 0 ? <p>No approved prescription versions on this page. Pending review is not included.</p> : <ul className="space-y-3">{query.data.approvals.map(row => <li key={row.id} className="space-y-1 rounded-md border p-3">
        <p className="font-medium">Outside prescription approval · Version {row.version}{row.superseded ? " · Replaced by a later approval" : ""}</p>
        <p>{row.disposition === "selected" ? "This item source version was selected." : row.disposition === "omitted" ? "This item source version was omitted." : row.disposition === "different_source_version" ? "A different source version of this item was observed." : "This item was not observed in this approval."}</p>
        <p>{row.parent_matches ? "Matches this prescription header version." : "Uses a different prescription header version."} {row.exact_occurrence ? "Includes this exact run and page observation." : "Does not include this exact run and page observation."}</p>
        <p>Observations of this item: {row.identity_observations}. Matching source version: {row.matching_source_observations}. Repeated observations do not represent additional medications.</p>
        {row.disposition === "selected" && <p>Start date: {row.start_date_status === "date" ? "Date interpreted" : row.start_date_status === "unknown" ? "Unknown" : "Not interpreted"}. Catalog match: {row.catalog_matched ? "Matched at approval" : "Unmatched"}.</p>}
        <p>{row.source_current ? "Approved source context is current." : "Approved source context is no longer current."} Review completeness: {row.completeness}.</p>
        <p className="text-xs text-muted-foreground">Approved {new Date(row.approved_at).toLocaleString()}</p>
      </li>)}</ul>}
      <nav aria-label="Prescription item evidence pages" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!previous.length} onClick={() => { setBefore(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous prescription item evidence</Button>
        <Button type="button" variant="outline" size="sm" disabled={!query.data.has_more} onClick={() => { setPrevious([...previous, before]); setBefore(query.data.next_before_version); }}>Next prescription item evidence</Button>
      </nav>
    </>}
  </section>;
}
