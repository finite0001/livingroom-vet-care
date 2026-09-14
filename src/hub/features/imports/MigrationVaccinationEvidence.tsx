import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationVaccinationApi } from "./migration-vaccination-api";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationVaccinationEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationVaccinationApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const [before, setBefore] = useState<number | null>(null);
  const [previous, setPrevious] = useState<(number | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-vaccination-evidence", actor, binding.id, item.evidence_hash, before], retry: false,
    queryFn: () => api.list(binding, item, before) });
  return <section aria-label="Vaccination review evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Vaccination review evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh vaccination evidence</Button></div>
    <p className="text-xs text-muted-foreground">Approved outside vaccination for this patient and source identity, including reviews by other staff. These reviews do not record a vaccination administered here or activate a due plan.</p>
    {query.isFetching ? <p role="status">Loading vaccination evidence…</p> : query.isError ? <p role="alert">Vaccination evidence could not be loaded. Refresh to try again.</p> : query.data && <>
      <p className="text-xs text-muted-foreground">Checked {new Date(query.data.observed_at).toLocaleString()}. Local administration, due-plan adoption and complete coverage are not assessed here.</p>
      {query.data.approvals.length === 0 ? <p>No approved vaccination versions on this page. Pending review is not included.</p> : <ul className="space-y-3">{query.data.approvals.map(row => <li key={row.id} className="space-y-1 rounded-md border p-3">
        <p className="font-medium">Outside vaccination approval · Version {row.version}{row.superseded ? " · Replaced by a later approval" : ""}</p>
        <p>{row.relationship === "exact_source_version" ? "Matches this observed vaccination and saved consultation." : "Reviews a different vaccination or consultation version for the same source record."}</p>
        <p>{row.source_current ? "Approved source context is current." : "Approved source context is no longer current."}</p>
        <p>Outside administration: {row.outside_status === "administered" ? "Reported as administered" : row.outside_status === "not_administered" ? "Reported as not administered" : "Unknown"}.</p>
        <p>Administration date: {row.administration_date_status === "date" ? "Date interpreted" : row.administration_date_status === "unknown" ? "Unknown" : "Not interpreted"}. Next source date: {row.next_date_status === "date" ? "Date interpreted" : row.next_date_status === "unknown" ? "Unknown" : "Not interpreted"}.</p>
        <p>{row.product_linked ? "Catalog product recorded with this approval." : "No catalog product recorded with this approval."}</p>
        <p className="text-xs text-muted-foreground">Approved {new Date(row.approved_at).toLocaleString()}</p>
      </li>)}</ul>}
      <nav aria-label="Vaccination evidence pages" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!previous.length} onClick={() => { setBefore(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous vaccination evidence</Button>
        <Button type="button" variant="outline" size="sm" disabled={!query.data.has_more} onClick={() => { setPrevious([...previous, before]); setBefore(query.data.next_before_version); }}>Next vaccination evidence</Button>
      </nav>
    </>}
  </section>;
}
