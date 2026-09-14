import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationPrescriptionApi } from "./migration-prescription-api";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationPrescriptionEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationPrescriptionApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [before, setBefore] = useState<number | null>(null);
  const [previous, setPrevious] = useState<(number | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-prescription-evidence", actor, binding.id, item.evidence_hash, before], retry: false,
    queryFn: () => api.list(binding, item, before) });
  return <section aria-label="Prescription review evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Prescription review evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh prescription evidence</Button></div>
    <p className="text-xs text-muted-foreground">Approved outside prescription for this patient and source identity, including reviews by other staff. These reviews do not prescribe or dispense medication here. Header matches do not establish individual item coverage.</p>
    {query.isFetching ? <p role="status">Loading prescription evidence…</p> : query.isError ? <p role="alert">Prescription evidence could not be loaded. Refresh to try again.</p> : query.data && <>
      <p className="text-xs text-muted-foreground">Checked {new Date(query.data.observed_at).toLocaleString()}. Local prescribing, individual item coverage and complete migration coverage are not assessed here.</p>
      {query.data.approvals.length === 0 ? <p>No approved prescription versions on this page. Pending review is not included.</p> : <ul className="space-y-3">{query.data.approvals.map(row => <li key={row.id} className="space-y-1 rounded-md border p-3">
        <p className="font-medium">Outside prescription approval · Version {row.version}{row.superseded ? " · Replaced by a later approval" : ""}</p>
        <p>{row.relationship === "exact_source_version" ? "Matches this observed prescription header." : "Reviews a different header version for the same source record."}</p>
        <p>{row.source_current ? "Approved source context is current." : "Approved source context is no longer current."}</p>
        <p>Outside status: {row.outside_status}. Review completeness: {row.completeness}.</p>
        <p>Prescription date: {row.prescription_date_status === "date" ? "Date interpreted" : row.prescription_date_status === "unknown" ? "Unknown" : "Not interpreted"}. Consultation: {row.consult_status === "resolved" ? "Resolved at approval" : "Not supplied"}.</p>
        <p>Items selected: {row.selected_items}. Observations omitted: {row.omitted_items}.</p>
        <p>Source references: {row.reference_status}. Source list: {row.source_list_present ? "Supplied" : "Not supplied"}. Item scan: {row.scan_complete ? "Traversal ended" : "Incomplete"}.</p>
        <p>Distinct expected items: {row.expected_items}. Distinct observed items: {row.observed_items}. Missing: {row.missing_items}. Unexpected: {row.unexpected_items}.</p>
        <p>Duplicate source IDs: {row.duplicate_source_ids}. Duplicate observed IDs: {row.duplicate_observed_ids}. Invalid source references: {row.invalid_source_references}. Invalid observed references: {row.invalid_observed_references}.</p>
        <p className="text-xs text-muted-foreground">Approved {new Date(row.approved_at).toLocaleString()}</p>
      </li>)}</ul>}
      <nav aria-label="Prescription evidence pages" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!previous.length} onClick={() => { setBefore(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous prescription evidence</Button>
        <Button type="button" variant="outline" size="sm" disabled={!query.data.has_more} onClick={() => { setPrevious([...previous, before]); setBefore(query.data.next_before_version); }}>Next prescription evidence</Button>
      </nav>
    </>}
  </section>;
}
