import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createMigrationIdentityApi } from "./migration-identity-api";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api";
import type { MigrationItem } from "./migration-items-api";
interface Props { actor: string; binding: MigrationBinding; item: MigrationItem }
export function MigrationIdentityEvidence({ actor, binding, item }: Props) {
  const api = useMemo(() => createMigrationIdentityApi(supabase as unknown as MigrationRpc, actor), [actor]);
  const query = useQuery({ queryKey: ["migration-identity-evidence", actor, binding.id, item.evidence_hash], retry: false, queryFn: () => api.read(binding, item) });
  const receipt = query.data?.approval;
  return <section aria-label="Identity approval evidence" className="mt-3 space-y-3 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium">Identity approval evidence</h5><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh identity evidence</Button></div>
    <p className="text-xs text-muted-foreground">These older observations retain source snapshots but not the version observed on each page. A matching snapshot cannot establish an exact source-version match or complete migration coverage.</p>
    {query.isFetching ? <p role="status">Loading identity evidence…</p> : query.isError ? <p role="alert">Identity evidence could not be loaded. Refresh to try again.</p> : query.data && receipt && <div className="space-y-1 rounded-md border p-3">
      <p className="font-medium">Approved {query.data.resource === "contact" ? "household" : "patient"} mapping · {receipt.action === "create" ? "Created local record" : "Linked existing local record"}</p>
      <p>{receipt.relationship === "same_snapshot_unknown_observed_head" ? "Approval uses the same source snapshot; the observed version is unknown." : "Approval uses a different source snapshot."}</p>
      <p>{receipt.source_current ? "Approved source version is current." : "Approved source version is no longer current."}</p>
      <p>{receipt.local_record_unchanged ? "Local record version is unchanged since approval." : "Local record has changed since approval."}</p>
      <p>{receipt.household_current ? "Household association still matches the approval." : "Household association no longer matches the approval."}</p>
      <p className="text-xs text-muted-foreground">Approved {new Date(receipt.approved_at).toLocaleString()}. Checked {new Date(query.data.observed_at).toLocaleString()}.</p>
    </div>}
  </section>;
}
