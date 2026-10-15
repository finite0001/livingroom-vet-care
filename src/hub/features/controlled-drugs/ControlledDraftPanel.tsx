import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { products } from "../inventory/api";
import { controlledDraftApi } from "./draft-api.ts";
import { draftCanonical, parseDraftRequest, type DraftDefinition, type DraftEntry } from "./draft-model.ts";
import { controlledDraftChanged, draftError, useDraftReview } from "./use-draft-review.ts";
import { DraftReviewDialog, DraftReviewStatus } from "./DraftReviewDialog.tsx";
const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
interface FieldProps { label: string; children: ReactElement<{ id?: string }> }
function Field({ label, children }: FieldProps) {
  const id = useId(); return <div className="grid min-w-0 gap-1"><Label htmlFor={id}>{label}</Label>{cloneElement(children, { id })}</div>;
}
interface SummaryProps { entry: DraftEntry }
function Summary({ entry }: SummaryProps) {
  return <div className="min-w-0 space-y-1"><p className="break-words font-semibold">{entry.product_snapshot.name}</p>
    <p className="break-words text-sm">{entry.definition.generic_name}{entry.definition.brand_name ? ` · ${entry.definition.brand_name}` : ""} · proposed Schedule {entry.definition.schedule}</p>
    <p className="break-words text-sm">{entry.definition.concentration} · stock unit: {entry.definition.stock_unit}</p>
    <p className="text-sm text-muted-foreground">Draft only · version {entry.version} · reviewed by {entry.actor_name}</p>
  </div>;
}
interface RecoveryProps { actor: string; canReview: boolean; saved(): void }
function Recovery({ actor, canReview, saved }: RecoveryProps) {
  const action = useDraftReview(actor, "draft_configuration", saved);
  if (!action.pending && !action.error) return null;
  return <section aria-label="Controlled-drug draft recovery" className="space-y-2 rounded-xl border p-3"><h3 className="font-display">Original draft review</h3><DraftReviewStatus action={action} canReview={canReview} /></section>;
}
interface DraftFormDefinition extends Omit<DraftDefinition, "schedule"> { schedule: DraftDefinition["schedule"] | "" }
interface FormProps { entry: DraftEntry | null; close(): void; saved(): void }
function DraftForm({ entry, close, saved }: FormProps) {
  const { session, profile, hasRole } = useAuth(), actor = session?.user.id ?? "";
  const canReview = Boolean(profile?.is_active) && (hasRole("ADMIN") || hasRole("DVM"));
  const [id, setId] = useState(entry?.id ?? crypto.randomUUID()), [expected, setExpected] = useState<number | null>(entry?.version ?? null);
  const [definition, setDefinition] = useState<DraftFormDefinition>(entry ? { ...entry.definition, schedule: entry.definition.schedule ?? "" } : {
    product_id: "", product_version: 1, stock_unit: "", generic_name: "", brand_name: null, schedule: "", concentration: "", concentration_source: "", classification_source: "", configuration_note: "",
  });
  const [search, setSearch] = useState(""), [note, setNote] = useState(""), [attest, setAttest] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const candidates = useQuery({ queryKey: ["controlled-draft-products", actor, search], queryFn: () => products(search), enabled: Boolean(actor) && Boolean(profile?.is_active) });
  const context = useQuery({ queryKey: ["controlled-draft-history", actor, entry?.id, null], queryFn: () => controlledDraftApi.history(actor, entry!.id), enabled: Boolean(actor) && Boolean(profile?.is_active) && Boolean(entry) });
  const action = useDraftReview(actor, "draft_configuration", () => { setDone(true); saved(); close(); }, () => { setDone(true); close(); });
  const baseline = useRef(draftCanonical({ id, expected, definition, note, attest }));
  const frozen = action.busy || action.pending;
  const dirty = !done && (action.pending || baseline.current !== draftCanonical({ id, expected, definition, note, attest }));
  useEffect(() => {
    const original = action.recovered;
    if (original) { setId(original.id); setExpected(original.expected_version); setDefinition({ ...original.definition, schedule: original.definition.schedule ?? "" }); setNote(original.review_note); setAttest(original.attest_review); }
  }, [action.recovered]);
  function change(key: keyof DraftDefinition, value: string | null) { setDefinition(current => ({ ...current, [key]: value })); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    try { await action.save(parseDraftRequest("draft_configuration", { id, expected_version: expected, definition, review_note: note, attest_review: attest })); }
    catch (cause) { setError(draftError(cause)); }
  }
  const current = context.data?.current_product;
  return <DraftReviewDialog title={entry ? "Medication draft revision" : "Review a medication draft"} description="Save proposed drug configuration. The controlled-drug register remains inactive" dirty={dirty} busy={action.busy} pending={action.pending} close={close}>
    <form className="min-w-0 space-y-4" onSubmit={event => void submit(event)}>
      <fieldset disabled={frozen || !canReview} className="min-w-0 space-y-4">
        {!entry && <><Field label="Find medication for draft"><Input value={search} onChange={event => { setSearch(event.target.value); setDefinition(value => ({ ...value, product_id: "", stock_unit: "" })); }} /></Field>
          <Field label="Draft stock medication"><select className={selectClass} value={definition.product_id} onChange={event => {
            const product = candidates.data?.find(value => value.id === event.target.value);
            if (product) setDefinition(value => ({ ...value, product_id: product.id, product_version: product.version, stock_unit: product.unit }));
          }}><option value="">Select an active medication</option>{candidates.data?.filter(product => product.kind === "medication" && product.active).map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}</select></Field>
          {(candidates.data?.length ?? 0) >= 101 && <p className="text-sm">More catalog results exist. Narrow the medication search</p>}</>}
        {(candidates.isError || context.isError) && <p role="alert" className="text-destructive">Current medication details could not be loaded. Refresh before reviewing</p>}
        {entry && <><Summary entry={entry} />{current && <p className="text-sm">Current catalog: {current.name} · {current.unit} · version {current.version}{!current.active ? " · inactive" : ""}</p>}
          {current && current.active && current.kind === "medication" && (definition.product_version !== current.version || definition.stock_unit !== current.unit) && <Button type="button" variant="outline" className="min-h-11" onClick={() => setDefinition(value => ({ ...value, product_version: current.version, stock_unit: current.unit }))}>Use current catalog version after review</Button>}</>}
        <p className="text-sm">Selected stock unit: {definition.stock_unit || "Select a medication"}. Concentration is reviewed source text; this draft does not convert a dose or quantity</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Generic drug name"><Input value={definition.generic_name} onChange={event => change("generic_name", event.target.value)} /></Field>
          <Field label="Brand name (optional)"><Input value={definition.brand_name ?? ""} onChange={event => change("brand_name", event.target.value || null)} /></Field>
          <Field label="Proposed controlled schedule"><select className={selectClass} value={definition.schedule} onChange={event => change("schedule", event.target.value)}><option value="">Select a proposed schedule</option>{["II", "III", "IV", "V"].map(schedule => <option key={schedule} value={schedule}>Schedule {schedule}</option>)}</select></Field>
          <Field label="Reviewed strength or concentration"><Input value={definition.concentration} onChange={event => change("concentration", event.target.value)} /></Field>
        </div>
        <Field label="Concentration source"><Textarea value={definition.concentration_source} onChange={event => change("concentration_source", event.target.value)} /></Field>
        <Field label="Classification source"><Textarea value={definition.classification_source} onChange={event => change("classification_source", event.target.value)} /></Field>
        <Field label="Draft configuration note"><Textarea value={definition.configuration_note} onChange={event => change("configuration_note", event.target.value)} /></Field>
        <Field label="Draft review note"><Textarea value={note} onChange={event => setNote(event.target.value)} /></Field>
        <label className="flex min-h-11 items-start gap-3 text-sm"><Checkbox checked={attest} onCheckedChange={value => setAttest(value === true)} /><span>I reviewed this proposed medication configuration and its sources. Saving this draft does not activate a controlled-drug register</span></label>
      </fieldset>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <DraftReviewStatus action={action} canReview={canReview} />
      <Button type="submit" className="min-h-11" disabled={frozen || !canReview || !attest || !definition.product_id}>Save draft configuration</Button>
    </form>
  </DraftReviewDialog>;
}
export function ControlledDraftPanel() {
  const { session, profile, hasRole } = useAuth(), actor = session?.user.id ?? "";
  const canReview = Boolean(profile?.is_active) && (hasRole("ADMIN") || hasRole("DVM")), cache = useQueryClient();
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [after, setAfter] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ entry: DraftEntry | null } | null>(null), [historyId, setHistoryId] = useState<string | null>(null), [before, setBefore] = useState<number | null>(null);
  const enabled = open && Boolean(actor) && Boolean(profile?.is_active);
  const rows = useQuery({ queryKey: ["controlled-drafts", actor, search, after], queryFn: () => controlledDraftApi.list(actor, search, after), enabled });
  const history = useQuery({ queryKey: ["controlled-draft-history", actor, historyId, before], queryFn: () => controlledDraftApi.history(actor, historyId!, before), enabled: enabled && Boolean(historyId) });
  useEffect(() => { setEditor(null); setHistoryId(null); setBefore(null); setAfter(null); setSearch(""); }, [actor]);
  function refresh() { void cache.invalidateQueries({ queryKey: ["controlled-drafts", actor] }); void cache.invalidateQueries({ queryKey: ["controlled-draft-history", actor] }); }
  useEffect(() => {
    const changed = () => { void cache.invalidateQueries({ queryKey: ["controlled-drafts", actor] }); void cache.invalidateQueries({ queryKey: ["controlled-draft-history", actor] }); };
    window.addEventListener(controlledDraftChanged, changed); return () => window.removeEventListener(controlledDraftChanged, changed);
  }, [actor, cache]);
  return <Card className="rounded-2xl shadow-warm" id="controlled-drug-drafts"><CardHeader>
    <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="font-display flex items-center gap-2"><ClipboardList className="h-5 w-5" aria-hidden="true" />Controlled-drug drafts</CardTitle>
      <Button type="button" variant="outline" className="min-h-11" aria-expanded={open} aria-controls="controlled-drug-drafts-content" onClick={() => setOpen(value => !value)}>{open ? "Hide controlled-drug drafts" : "Open controlled-drug drafts"}</Button></div>
    <p className="text-sm text-muted-foreground">Proposed medication configuration · register not active</p>
  </CardHeader>{enabled && <CardContent id="controlled-drug-drafts-content" className="min-w-0 space-y-4">
    {!editor && <Recovery key={actor} actor={actor} canReview={canReview} saved={refresh} />}
    <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Field label="Search medication drafts"><Input value={search} onChange={event => { setSearch(event.target.value); setAfter(null); }} /></Field></div>
      {canReview && <Button type="button" className="min-h-11" onClick={() => setEditor({ entry: null })}>New medication draft</Button>}
      <Button type="button" variant="outline" className="min-h-11" onClick={refresh}>Refresh medication drafts</Button></div>
    {rows.isPending && <p role="status">Loading medication drafts…</p>}{rows.isError && <p role="alert" className="text-destructive">{draftError(rows.error)}</p>}
    {rows.data?.items.length === 0 && <p>No reviewed medication drafts found</p>}
    {rows.data?.items.map(entry => <div key={entry.id} className="min-w-0 space-y-3 rounded-xl border p-4"><Summary entry={entry} /><div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11" onClick={() => { setHistoryId(entry.id); setBefore(null); }}>View medication draft history</Button>
      {canReview && <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditor({ entry })}>Review medication draft revision</Button>}</div></div>)}
    <div className="flex flex-wrap gap-2">{after && <Button type="button" variant="outline" className="min-h-11" onClick={() => setAfter(null)}>First medication drafts</Button>}{rows.data?.next && <Button type="button" variant="outline" className="min-h-11" onClick={() => setAfter(rows.data!.next)}>More medication drafts</Button>}</div>
    {historyId && <section aria-label="Medication draft history" className="min-w-0 space-y-3 rounded-xl border p-4">
      {history.isPending && <p role="status">Loading draft history…</p>}{history.isError && <p role="alert" className="text-destructive">{draftError(history.error)}</p>}
      {history.data?.history.map(entry => <div key={entry.version_id} className="min-w-0 space-y-2 border-t pt-3"><Summary entry={entry} /><p className="text-sm">{new Date(entry.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-sm">Classification source: {entry.definition.classification_source}</p><p className="whitespace-pre-wrap break-words text-sm">Concentration source: {entry.definition.concentration_source}</p><p className="whitespace-pre-wrap break-words text-sm">{entry.definition.configuration_note}</p></div>)}
      <div className="flex flex-wrap gap-2">{before && <Button type="button" variant="outline" className="min-h-11" onClick={() => setBefore(null)}>Newest draft history</Button>}{history.data?.next && <Button type="button" variant="outline" className="min-h-11" onClick={() => setBefore(history.data!.next)}>Older draft history</Button>}<Button type="button" variant="outline" className="min-h-11" onClick={() => setHistoryId(null)}>Close draft history</Button></div>
    </section>}
    {editor && <DraftForm key={`${actor}:${editor.entry?.id ?? "new"}`} entry={editor.entry} close={() => setEditor(null)} saved={refresh} />}
  </CardContent>}</Card>;
}
