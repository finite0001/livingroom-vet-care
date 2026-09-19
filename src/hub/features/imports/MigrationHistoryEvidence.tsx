import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationHistoryApi } from "./migration-history-api";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationHistoryEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationHistoryApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [before, setBefore] = useState<number | null>(null);
  const [previous, setPrevious] = useState<(number | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-history-evidence", actor, binding.id, item.evidence_hash, before], retry: false,
    queryFn: () => api.list(binding, item, before) });
  return <section aria-label="History review evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">History review evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh history evidence</Button></div>
    <p className="text-xs text-muted-foreground">Approved outside history for this patient and source identity, including reviews by other staff. An outside history approval is separate from a veterinarian’s local finding.</p>
    {query.isFetching ? <p role="status">Loading history evidence…</p> : query.isError ? <p role="alert">History evidence could not be loaded. Refresh to try again.</p> : query.data && <>
      <p className="text-xs text-muted-foreground">Checked {new Date(query.data.observed_at).toLocaleString()}. Discrepancy decisions and complete coverage are not assessed here.</p>
      {query.data.approvals.length === 0 ? <p>No approved history versions on this page. Pending review is not included.</p> : <ul className="space-y-3">{query.data.approvals.map(row => <li key={row.id} className="space-y-1 rounded-md border p-3">
        <p className="font-medium">Outside history approval · Version {row.version}{row.superseded ? " · Replaced by a later approval" : ""}</p>
        <p>{row.relationship === "exact_source_version" ? "Matches this observed source version." : "Reviews a different version of the same source record."}</p>
        <p>{row.source_current ? "Approved source context is current." : "Approved source context is no longer current."}</p>
        {row.consult_status === "unresolved" && <p>The approval retains an unresolved consult reference.</p>}
        <p>Local finding extraction receipts: {row.extraction_receipts}. Edited since extraction: {row.locally_edited_receipts}.</p>
        <p className="text-xs text-muted-foreground">Receipts can refer to the same local finding; these are not unique diagnosis counts. Existing chart edits are preserved.</p>
        <p className="text-xs text-muted-foreground">Approved {new Date(row.approved_at).toLocaleString()}</p>
      </li>)}</ul>}
      <nav aria-label="History evidence pages" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!previous.length} onClick={() => { setBefore(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous history evidence</Button>
        <Button type="button" variant="outline" size="sm" disabled={!query.data.has_more} onClick={() => { setPrevious([...previous, before]); setBefore(query.data.next_before_version); }}>Next history evidence</Button>
      </nav>
    </>}
  </section>;
}
