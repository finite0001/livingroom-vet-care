import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationWeightApi } from "./migration-weight-api";
import type { MigrationBinding, MigrationCursor, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationWeightEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationWeightApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [cursor, setCursor] = useState<MigrationCursor | null>(null);
  const [previous, setPrevious] = useState<(MigrationCursor | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-weight-evidence", actor, binding.id, item.evidence_hash, cursor], retry: false,
    queryFn: () => api.list(binding, item, cursor) });
  return <section aria-label="Weight review evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Weight review evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh weight evidence</Button></div>
    <p className="text-xs text-muted-foreground">The original scan saved this source snapshot without its source-head version. A snapshot match cannot establish which historical source version was observed.</p>
    {query.isFetching ? <p role="status">Loading weight evidence…</p> : query.isError ? <p role="alert">Weight evidence could not be loaded. Refresh to try again.</p> : query.data && <>
      <p className="text-xs text-muted-foreground">Checked {new Date(query.data.observed_at).toLocaleString()}. Complete migration coverage is not assessed here.</p>
      {query.data.approval ? <div className="space-y-1 rounded-md border p-3">
        <p className="font-medium">{query.data.approval.action === "create" ? "Approved imported weight" : "Approved link to an existing weight"}</p>
        <p>{query.data.approval.relationship === "exact_snapshot" ? "Approval matches this source snapshot." : "Approval refers to a different snapshot of this source record."}</p>
        <p>{query.data.approval.source_current ? "Approved source snapshot and head are current." : "Approved source snapshot or head has changed."}</p>
        <p>{query.data.approval.local_weight_matches ? "Saved local weight still matches the approved values." : "Saved local weight no longer matches the approved values."}</p>
        {!query.data.approval.household_current && <p>The patient’s household no longer matches the saved migration scope.</p>}
        <p className="text-xs text-muted-foreground break-all">Local weight receipt: {query.data.approval.weight_id}</p>
        <p className="text-xs text-muted-foreground">Approved {new Date(query.data.approval.approved_at).toLocaleString()}</p>
      </div> : <p>No approved weight receipt. Prepared requests are not approvals.</p>}
      <h6 className="font-medium">Source-change acknowledgments</h6>
      <p className="text-xs text-muted-foreground">These acknowledgments record review of changed source data. They do not create another weight or replace the approved local values.</p>
      {query.data.reviews.length === 0 ? <p>No source-change acknowledgments on this page.</p> : <ul className="space-y-2">{query.data.reviews.map(row => <li key={row.id} className="space-y-1 rounded-md border p-3">
        <p>{row.relationship === "exact_snapshot" ? "Acknowledgment matches this source snapshot." : "Acknowledgment refers to a different source snapshot."}</p>
        <p>{row.source_current ? "Acknowledged source snapshot and head are current." : "Acknowledged source snapshot or head has changed."}</p>
        <p className="text-xs text-muted-foreground">Reviewed {new Date(row.reviewed_at).toLocaleString()}</p>
      </li>)}</ul>}
      <nav aria-label="Weight acknowledgment pages" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!previous.length} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous acknowledgments</Button>
        <Button type="button" variant="outline" size="sm" disabled={!query.data.has_more} onClick={() => { setPrevious([...previous, cursor]); setCursor(query.data.next_cursor); }}>Next acknowledgments</Button>
      </nav>
    </>}
  </section>;
}
