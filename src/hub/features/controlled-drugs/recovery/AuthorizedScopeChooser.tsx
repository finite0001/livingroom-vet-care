import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { CountClient } from "../count/count-client.ts";
import type { CountScopeItem, CountScopeReply, CountScopeCursor } from "../count/count-admin-schema.ts";

interface AuthorizedScopeChooserProps {
  readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: CountClient;
  readonly allowed?: readonly { product_id?: string; site_id?: string }[];
  readonly selected: CountScopeItem | null; readonly onSelect: (scope: CountScopeItem) => void;
}
export function AuthorizedScopeChooser({ sessions, identity, client, allowed, selected, onSelect }: AuthorizedScopeChooserProps) {
  const [page, setPage] = useState<CountScopeReply | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load(cursor: CountScopeCursor | null = null) {
    if (running.current || !sessions.isCurrent(identity)) return;
    running.current = true; setBusy(true); setError("");
    try {
      const value = await client.scopes({ schema_version: 1, actor_id: identity.actorId, cursor, page_size: 100 }, identity);
      if (alive.current && sessions.isCurrent(identity)) setPage(value);
    } catch { if (alive.current && sessions.isCurrent(identity)) setError("Medication and site access could not be loaded. Check your login and try again."); }
    finally { running.current = false; if (alive.current && sessions.isCurrent(identity)) setBusy(false); }
  }
  const items = page?.items.filter(item => item.capabilities.read && (!allowed || allowed.some(scope => scope.product_id === item.product_id && scope.site_id === item.site_id))) ?? [];
  return <section aria-label="Choose medication and site" className="space-y-3">
    <h2 className="font-display text-xl">Medication and site</h2>
    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Load medications and sites"}</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {page && !items.length && <p role="status">No authorized medications are on this page.</p>}
    <ul className="grid gap-3 md:grid-cols-2">{items.map(item => <li key={`${item.product_id}:${item.site_id}`} className="rounded-xl border bg-card p-4">
      <p className="break-words font-medium">{item.product_name}</p><p className="break-words text-sm text-muted-foreground">{item.site_name}</p>
      <Button type="button" variant={selected?.product_id === item.product_id && selected?.site_id === item.site_id ? "default" : "outline"} className="mt-3 min-h-11"
        onClick={() => { if (sessions.isCurrent(identity)) onSelect(item); }}>Open medication</Button>
    </li>)}</ul>
    {page?.has_more && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load(page.next_cursor)}>More medications and sites</Button>}
  </section>;
}
