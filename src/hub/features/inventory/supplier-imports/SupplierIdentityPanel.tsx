import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Search } from "lucide-react";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inventoryIdentityApi } from "./package-api.ts";
import { type IdentityEntry, type IdentityOperation } from "./package-model.ts";
import { normalizedGtin } from "./identifier-model.ts";
import { convertedStockQuantity } from "./quantity-model.ts";
import { IdentityField, IdentityForm, identitySelectClass } from "./IdentityForms.tsx";
import { identityError, inventoryIdentityChanged, useIdentityReview } from "./use-identity-review.ts";
import { IdentityReviewStatus } from "./IdentityReviewDialog.tsx";
interface RecoveryProps { actor: string; operation: IdentityOperation; canReview: boolean; saved: () => void }
function Recovery({ actor, operation, canReview, saved }: RecoveryProps) {
  const action = useIdentityReview(actor, operation, saved);
  if (!action.pending && !action.error) return null;
  return <section className="rounded-xl border p-3 space-y-2" aria-label={operation === "namespace" ? "Supplier scope recovery" : "Product package recovery"}>
    <h3 className="font-display">{operation === "namespace" ? "Supplier scope review" : "Product package review"}</h3>
    <IdentityReviewStatus action={action} canReview={canReview} />
  </section>;
}
interface SummaryProps { entry: IdentityEntry }
function PackageSummary({ entry }: SummaryProps) {
  if (entry.kind !== "package") return null;
  let conversion: string;
  try { conversion = `1 ${entry.definition.purchase_unit} = ${convertedStockQuantity("1", entry.definition.conversion)} ${entry.definition.stock_unit}`; }
  catch { conversion = `Exact conversion: ${entry.definition.conversion.stock_units_numerator} stock units per ${entry.definition.conversion.purchase_units_denominator} purchase units`; }
  return <div className="min-w-0 space-y-1"><p className="font-semibold break-words">{entry.definition.label}</p>
    <p className="text-sm break-words">{entry.definition.manufacturer} · {entry.definition.strength} · {entry.definition.form}</p>
    <p className="text-sm break-words">{conversion}</p>
    <p className="text-xs text-muted-foreground">{entry.definition.active ? "Available for reviewed lookup" : "Inactive package"} · reviewed by {entry.actor_name}</p>
  </div>;
}
interface EditorState { operation: IdentityOperation; entry: IdentityEntry | null }
export function SupplierIdentityPanel() {
  const { session, profile, hasRole } = useAuth(), actor = session?.user.id ?? "";
  const canReview = Boolean(profile?.is_active) && (hasRole("ADMIN") || hasRole("DVM"));
  const cache = useQueryClient();
  const actorRef = useRef(actor); actorRef.current = actor;
  const lookupGeneration = useRef(0);
  const [open, setOpen] = useState(false), [kind, setKind] = useState<IdentityOperation>("namespace"), [search, setSearch] = useState("");
  const [after, setAfter] = useState<string | null>(null), [scopeAfter, setScopeAfter] = useState<string | null>(null);
  const [knownScopes, setKnownScopes] = useState<IdentityEntry[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [lookupKind, setLookupKind] = useState<"supplier_sku" | "supplier_barcode" | "gtin">("supplier_sku"), [code, setCode] = useState(""), [namespaceId, setNamespaceId] = useState("");
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof inventoryIdentityApi.lookup>> | null>(null), [looking, setLooking] = useState(false), [lookupError, setLookupError] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null), [before, setBefore] = useState<number | null>(null);
  const enabled = open && Boolean(actor) && Boolean(profile?.is_active);
  const rows = useQuery({ queryKey: ["inventory-identities", actor, kind, search, after], queryFn: () => inventoryIdentityApi.list(actor, kind, search, after), enabled });
  const scopes = useQuery({ queryKey: ["inventory-identity-scopes", actor, scopeAfter], queryFn: () => inventoryIdentityApi.list(actor, "namespace", "", scopeAfter), enabled });
  const history = useQuery({ queryKey: ["inventory-identity-history", actor, historyId, before], queryFn: () => inventoryIdentityApi.history(actor, historyId!, before), enabled: enabled && Boolean(historyId) });
  useEffect(() => { setKnownScopes([]); setScopeAfter(null); lookupGeneration.current++; setLooking(false); setLookupError(""); setMatches(null); setNamespaceId(""); setEditor(null); }, [actor]);
  useEffect(() => {
    if (!scopes.data) return;
    setKnownScopes((current) => {
      const map = new Map(current.map((scope) => [scope.id, scope]));
      for (const scope of scopes.data.items) map.set(scope.id, scope);
      return [...map.values()];
    });
  }, [scopes.data]);
  function refresh() {
    void cache.invalidateQueries({ queryKey: ["inventory-identities", actor] });
    void cache.invalidateQueries({ queryKey: ["inventory-identity-scopes", actor] });
    void cache.invalidateQueries({ queryKey: ["inventory-identity-history", actor] });
    void cache.invalidateQueries({ queryKey: ["inventory-identity-context", actor] });
    setMatches(null);
  }
  useEffect(() => {
    const change = () => {
      void cache.invalidateQueries({ queryKey: ["inventory-identities", actor] });
      void cache.invalidateQueries({ queryKey: ["inventory-identity-scopes", actor] });
      setMatches(null);
    };
    window.addEventListener(inventoryIdentityChanged, change);
    return () => window.removeEventListener(inventoryIdentityChanged, change);
  }, [actor, cache]);
  function resetLookup() {
    lookupGeneration.current++; setLooking(false); setMatches(null); setLookupError("");
  }
  async function lookup() {
    const generation = ++lookupGeneration.current;
    const current = () => actorRef.current === actor && lookupGeneration.current === generation;
    setLooking(true); setLookupError(""); setMatches(null);
    try { const result = await inventoryIdentityApi.lookup(actor, lookupKind, lookupKind === "gtin" ? normalizedGtin(code) : code, lookupKind === "gtin" ? null : namespaceId || null); if (current()) setMatches(result); }
    catch (cause) { if (current()) setLookupError(identityError(cause)); }
    finally { if (current()) setLooking(false); }
  }
  return <Card className="rounded-2xl shadow-warm" id="supplier-products">
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="font-display flex items-center gap-2"><Boxes className="h-5 w-5" aria-hidden="true" />Supplier products</CardTitle>
      <Button type="button" variant="outline" className="min-h-11" aria-expanded={open} aria-controls="supplier-products-content" onClick={() => setOpen(!open)}>{open ? "Hide supplier products" : "Open supplier products"}</Button>
    </div><p className="text-sm text-muted-foreground">Find reviewed supplier codes and compare purchase packages with stock units</p></CardHeader>
    {open && <CardContent id="supplier-products-content" className="space-y-6 min-w-0">
      <section aria-label="Supplier product lookup" className="rounded-xl border bg-muted/40 p-4 space-y-3">
        <h3 className="font-display flex gap-2 items-center"><Search className="h-4 w-4" aria-hidden="true" />Look up a supplier product</h3>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
          <IdentityField label="Lookup code type"><select className={identitySelectClass} value={lookupKind} onChange={(event) => { setLookupKind(event.target.value as typeof lookupKind); resetLookup(); }}><option value="supplier_sku">Supplier SKU</option><option value="supplier_barcode">Supplier printed barcode</option><option value="gtin">Manufacturer UPC / EAN / GTIN</option></select></IdentityField>
          <IdentityField label="Supplier code or barcode"><Input value={code} onChange={(event) => { setCode(event.target.value); resetLookup(); }} /></IdentityField>
          {lookupKind !== "gtin" && <IdentityField label="Lookup supplier scope"><select className={identitySelectClass} value={namespaceId} onChange={(event) => { setNamespaceId(event.target.value); resetLookup(); }}><option value="">All supplier scopes — show any ambiguity</option>{knownScopes.filter((scope) => scope.kind === "namespace" && scope.definition.active).map((scope) => <option key={scope.id} value={scope.id}>{scope.kind === "namespace" ? `${scope.definition.supplier.toUpperCase()} · ${scope.definition.account_label} · ${scope.definition.catalog_scope}` : ""}</option>)}</select></IdentityField>}
          <Button type="submit" className="min-h-11 md:self-end" disabled={looking || !code || !enabled}>{looking ? "Looking up…" : "Look up reviewed code"}</Button>
        </form>
        {scopes.isError && <p role="alert" className="text-destructive">Supplier scopes could not be loaded. Refresh before choosing an account</p>}
        {lookupError && <p role="alert" className="text-destructive">{lookupError}</p>}
        {matches && <div aria-live="polite" className="space-y-3">
          {matches.items.length === 0 && <p>No reviewed mapping found. Search the inventory catalog manually or ask a reviewer to map this code</p>}
          {(matches.items.length > 1 || matches.more) && <p className="font-semibold">Multiple packages may match. Choose a supplier scope and compare strength, form and package size</p>}
          {matches.more && <p>More matches exist. Narrow the supplier scope before using a result</p>}
          {matches.items.map((entry) => <div className="rounded-xl border bg-background p-3" key={entry.id}><PackageSummary entry={entry} /></div>)}
        </div>}
      </section>
      {!editor && <><Recovery actor={actor} operation="namespace" canReview={canReview} saved={refresh} /><Recovery actor={actor} operation="package" canReview={canReview} saved={refresh} /></>}
      <section aria-label="Reviewed supplier mappings" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display">Reviewed mappings</h3>{canReview && <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={() => setEditor({ operation: "namespace", entry: null })}>New supplier scope</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => setEditor({ operation: "package", entry: null })}>New product package</Button></div>}</div>
        <div className="grid gap-3 md:grid-cols-2"><IdentityField label="Mapping list type"><select className={identitySelectClass} value={kind} onChange={(event) => { setKind(event.target.value as IdentityOperation); setAfter(null); }}><option value="namespace">Supplier scopes</option><option value="package">Product packages</option></select></IdentityField><IdentityField label="Search reviewed mappings"><Input value={search} onChange={(event) => { setSearch(event.target.value); setAfter(null); }} /></IdentityField></div>
        <Button type="button" variant="outline" className="min-h-11" onClick={refresh}>Refresh supplier mappings</Button>
        {rows.isPending && <p role="status">Loading reviewed mappings…</p>}
        {rows.isError && <p role="alert" className="text-destructive">Unable to load reviewed mappings. Refresh or sign in with current staff access</p>}
        {rows.data?.items.length === 0 && <p>No reviewed mappings on this page</p>}
        <ul className="space-y-3">{rows.data?.items.map((entry) => <li key={entry.id} className="rounded-xl border p-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          {entry.kind === "namespace" ? <div className="min-w-0"><p className="font-semibold break-words">{entry.definition.supplier.toUpperCase()} · {entry.definition.account_label}</p><p className="text-sm break-words">{entry.definition.catalog_scope} · {entry.definition.active ? "Active scope" : "Inactive scope"}</p><p className="text-xs text-muted-foreground">Reviewed by {entry.actor_name}</p></div> : <PackageSummary entry={entry} />}
          <div className="flex flex-wrap gap-2 shrink-0">{canReview && <Button type="button" className="min-h-11" variant="outline" onClick={() => setEditor({ operation: entry.kind, entry })}>Review {entry.kind === "namespace" ? "supplier scope" : "product package"}</Button>}<Button type="button" className="min-h-11" variant="outline" onClick={() => { setHistoryId(entry.id); setBefore(null); }}>Review history</Button></div>
        </li>)}</ul>
        <div className="flex flex-wrap gap-2">{after && <Button type="button" variant="outline" className="min-h-11" onClick={() => setAfter(null)}>First mapping page</Button>}{rows.data?.next && <Button type="button" variant="outline" className="min-h-11" onClick={() => setAfter(rows.data!.next)}>Next mapping page</Button>}{scopes.data?.next && <Button type="button" variant="outline" className="min-h-11" onClick={() => setScopeAfter(scopes.data!.next)}>Load more supplier scopes</Button>}</div>
      </section>
      {historyId && <section aria-label="Supplier mapping history" className="rounded-xl border p-3 space-y-3"><h3 className="font-display">Mapping history</h3>
        {history.isPending && <p role="status">Loading mapping history…</p>}{history.isError && <p role="alert" className="text-destructive">Unable to read mapping history</p>}
        {history.data?.history.map((entry) => <div key={entry.version_id} className="border-t pt-3"><p className="text-sm">Version {entry.version} · {entry.actor_name} · {new Date(entry.created_at).toLocaleString()}</p>{entry.kind === "package" ? <PackageSummary entry={entry} /> : <p className="break-words">{entry.definition.account_label} · {entry.definition.catalog_scope} · {entry.definition.active ? "active" : "inactive"}</p>}</div>)}
        <div className="flex gap-2 flex-wrap">{before && <Button type="button" variant="outline" className="min-h-11" onClick={() => setBefore(null)}>Newest mapping history</Button>}{history.data?.next && <Button type="button" variant="outline" className="min-h-11" onClick={() => setBefore(history.data!.next)}>Older mapping history</Button>}<Button type="button" variant="outline" className="min-h-11" onClick={() => setHistoryId(null)}>Close mapping history</Button></div>
      </section>}
      {editor && <IdentityForm key={`${actor}:${editor.operation}:${editor.entry?.id ?? "new"}`} operation={editor.operation} entry={editor.entry} scopes={knownScopes} close={() => setEditor(null)} saved={refresh} />}
    </CardContent>}
  </Card>;
}
