import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { createMigrationResolutionApi } from "./migration-resolution-api";
import type { MigrationResolutionTarget } from "./migration-resolution-api";
import type { MigrationCursor, MigrationManifest, MigrationRpc } from "./migration-run-api";
interface Props { actor: string; manifest: MigrationManifest; scopeId: string; target: MigrationResolutionTarget | null }
export function MigrationResolutionHistory({ actor, manifest, scopeId, target }: Props) {
  const api = useMemo(() => createMigrationResolutionApi(supabase as unknown as MigrationRpc, actor, manifest), [actor, manifest]);
  const [opened, setOpened] = useState(false);
  const [cursor, setCursor] = useState<MigrationCursor | null>(null);
  const [previous, setPrevious] = useState<(MigrationCursor | null)[]>([]);
  const query = useQuery({ queryKey: ["migration-resolution-history", actor, manifest.run.id, scopeId, target, cursor], enabled: opened, retry: false, queryFn: () => api.history(scopeId, target, cursor) });
  return <section aria-label="Operational decision history" className="space-y-2 border-t pt-3">
    <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => { setOpened(true); if (opened) void query.refetch(); }}>{opened ? "Refresh decision history" : "Show decision history"}</Button>
    {opened && (query.isFetching ? <p role="status">Loading decision history…</p> : query.isError ? <p role="alert">Decision history could not be loaded. Refresh to try again.</p> : query.data && <>
      <p className="text-xs text-muted-foreground">Operational decisions do not hide approved clinical records. Currentness is checked independently of the original receipt.</p>
      {query.data.resolutions.length === 0 ? <p className="text-sm">No decisions on this history page.</p> : <ol className="space-y-2">{query.data.resolutions.map(row => <li key={row.receipt.id} className="rounded-md border p-3 text-sm">
        <p className="font-medium">{row.receipt.action === "exclude" ? "Excluded operationally" : "Operational review reopened"} · Version {row.receipt.version}</p>
        <p>{row.receipt.target_kind === "scope" ? "Scope exception" : `Exact observation · Page ${row.receipt.page} · Ordinal ${row.receipt.ordinal}`}</p>
        <p>{new Date(row.receipt.created_at).toLocaleString()} · {row.superseded ? "Superseded decision" : "Latest decision for this target"}</p>
        <p>{row.context_current ? "Reviewed context matches this check." : "Reviewed context has changed; historical decision retained."}</p>
        <p className="break-words">{row.receipt.reason}</p>
        <details><summary>Decision references</summary><dl className="space-y-1 break-all text-xs"><dt>Request</dt><dd>{row.receipt.id}</dd><dt>Predecessor</dt><dd>{row.receipt.replaces_id ?? "First decision"}</dd><dt>Receipt hash</dt><dd>{row.receipt.record_hash}</dd></dl></details>
      </li>)}</ol>}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={!previous.length} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>Previous decision page</Button><Button type="button" variant="outline" size="sm" disabled={!query.data.has_more} onClick={() => { setPrevious([...previous, cursor]); setCursor(query.data.next_cursor); }}>Next decision page</Button></div>
    </>)}
  </section>;
}
