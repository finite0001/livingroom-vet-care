import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { selectClass } from "@/hub/features/care-reminders/model";
import { RecurrenceFields } from "./RecurrenceFields";
import { readTemplate, templatesPage } from "./api";
import { templateValuesSchema, careKindSchema, kindLabels, type CareTemplate, type TemplateValues } from "./model";
import { useCareAction } from "./use-care-action";
interface RecurringCareTemplatesProps { onDirtyChange: (value: boolean) => void }
interface TemplateForm { id: string; original: CareTemplate | null; values: TemplateValues; reviewed: boolean }
export function RecurringCareTemplates(props: RecurringCareTemplatesProps) {
  const { session, hasRole, profile } = useAuth();
  return <TemplateSession key={session?.user.id ?? ""} actorId={session?.user.id ?? ""} canReview={hasRole("DVM") && !!profile?.full_name?.trim()} {...props} />;
}
interface TemplateSessionProps extends RecurringCareTemplatesProps { actorId: string; canReview: boolean }
function TemplateSession({ actorId, canReview, onDirtyChange }: TemplateSessionProps) {
  const cache = useQueryClient(), action = useCareAction(actorId);
  const [form, setForm] = useState<TemplateForm | null>(null), [notice, setNotice] = useState("");
  const baseline = useRef("");
  const dirty = action.busy || action.unconfirmed || (!!form && JSON.stringify(form) !== baseline.current);
  useEffect(() => { onDirtyChange(dirty);return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const query = useInfiniteQuery({
    queryKey: ["recurring-care-templates", actorId], enabled: !!actorId && !dirty,
    initialPageParam: null as string | null, queryFn: ({ pageParam }) => templatesPage(pageParam),
    getNextPageParam: page => page.next ?? undefined, retry: 1, refetchOnWindowFocus: !dirty,
  });
  const rows = query.data?.pages.flatMap(page => page.rows) ?? [];
  function open(original: CareTemplate | null) {
    if (action.busy || action.unconfirmed || dirty && !window.confirm("Discard this unsaved clinical default?")) return;
    const id = original?.id ?? crypto.randomUUID();
    const values: TemplateValues = original ? {
      care_key: original.care_key, name: original.name, care_kind: original.care_kind,
      interval_amount: original.interval_amount, interval_unit: original.interval_unit,
      anchor_mode: original.anchor_mode, month_end: original.month_end, active: original.active, review_note: "",
    } : { care_key: "care-" + id, name: "", care_kind: "wellness", interval_amount: 0, interval_unit: "months", anchor_mode: "completed_care", month_end: "clamp", active: true, review_note: "" };
    const next = { id, original, values, reviewed: false };
    setForm(next);baseline.current = JSON.stringify(next);action.clear();setNotice("");
  }
  function change(values: Partial<TemplateValues>) { if (form) setForm({ ...form, values: { ...form.values, ...values } }); }
  async function saved(receipt: unknown) {
    if (!receipt) return;
    setForm(null);baseline.current = "";setNotice("Clinical default saved. Existing patient plans keep their reviewed snapshots.");
    await cache.invalidateQueries({ queryKey: ["recurring-care-templates", actorId] });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (action.unconfirmed) { await saved(await action.retry());return; }
    if (!form || !canReview || !form.reviewed) return;
    const parsed = templateValuesSchema.safeParse(form.values);
    if (!parsed.success) { action.setError(parsed.error.issues[0].message);return; }
    await saved(await action.save({ kind: "template", entityId: form.id, petId: null, expectedVersion: form.original?.version ?? null, values: parsed.data }));
  }
  async function reload() {
    if (!form?.original || action.unconfirmed || action.busy || !window.confirm("Discard this draft after successfully loading the latest saved default?")) return;
    try { const latest = await readTemplate(form.id);if (!latest) throw new Error();
      const next: TemplateForm = { id: latest.id, original: latest, reviewed: false, values: { ...form.values,
        care_key: latest.care_key, name: latest.name, care_kind: latest.care_kind, interval_amount: latest.interval_amount,
        interval_unit: latest.interval_unit, anchor_mode: latest.anchor_mode, month_end: latest.month_end, active: latest.active, review_note: "" } };
      setForm(next);baseline.current = JSON.stringify(next);action.clear();
    } catch { action.setError("Could not load the latest default. Your draft is retained."); }
  }
  return <section aria-label="Recurring care defaults" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl">Recurring care defaults</h2>
      <p className="text-sm text-muted-foreground">Reviewed practice rules for wellness, bloodwork, vaccine follow-up and custom care.</p></div>
      {canReview && <Button onClick={() => open(null)} disabled={action.busy || action.unconfirmed}>New care default</Button>}</header>
    {!canReview && <p className="text-sm text-muted-foreground">An active named veterinarian reviews these clinical intervals. Administrators configure delivery separately.</p>}
    {query.isError && <div role="alert"><p>Could not load recurring care defaults.</p><Button variant="outline" onClick={() => void query.refetch()}>Reload defaults</Button></div>}
    {query.isPending && <p role="status">Loading recurring care defaults…</p>}
    {!query.isPending && !query.isError && !rows.length && <p>No clinical intervals have been configured yet.</p>}
    <div className="grid gap-3 md:grid-cols-2">{rows.map(row => <Card key={row.id}><CardHeader><CardTitle className="text-base">{row.name}</CardTitle></CardHeader><CardContent className="space-y-2">
      <p>{kindLabels[row.care_kind]} · every {row.interval_amount} {row.interval_unit}</p>
      <p className="text-sm text-muted-foreground">Reviewed version {row.version} · {row.active ? "Available for new plans" : "Retired default"}</p>
      <p className="text-sm">{row.review_note}</p>
      {canReview && <Button variant="outline" onClick={() => open(row)} disabled={action.busy || action.unconfirmed}>Review default</Button>}
    </CardContent></Card>)}</div>
    {query.hasNextPage && <Button variant="outline" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage || dirty}>Load more defaults</Button>}
    {query.isFetchNextPageError && <p role="alert">Could not load more defaults. Loaded defaults are retained.</p>}
    {form && <Card><CardHeader><CardTitle>{form.original ? "Review clinical default" : "New clinical default"}</CardTitle></CardHeader><CardContent>
      <form onSubmit={event => void submit(event)} className="space-y-4">
        <fieldset disabled={action.busy || action.unconfirmed || !canReview} className="space-y-3">
          <div><Label htmlFor="recurring-default-name">Care name</Label><Input id="recurring-default-name" value={form.values.name} onChange={e => change({ name: e.target.value })} maxLength={160} /></div>
          <div><Label htmlFor="recurring-default-kind">Care category</Label><select id="recurring-default-kind" className={selectClass} value={form.values.care_kind} disabled={!!form.original} onChange={e => change({ care_kind: careKindSchema.parse(e.target.value) })}>
            {careKindSchema.options.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
          </select></div>
          <RecurrenceFields values={form.values} onChange={change} disabled={action.busy || action.unconfirmed} prefix="recurring-default" />
          <label className="flex items-center gap-2"><Checkbox checked={form.values.active} onCheckedChange={value => change({ active: value === true })} />Available for new patient plans</label>
          <div><Label htmlFor="recurring-default-review">Default clinical review</Label><Textarea id="recurring-default-review" value={form.values.review_note} onChange={e => change({ review_note: e.target.value })} maxLength={2000} /></div>
          <label className="flex items-center gap-2"><Checkbox checked={form.reviewed} onCheckedChange={value => setForm({ ...form, reviewed: value === true })} />I reviewed this clinical interval and calendar rule</label>
        </fieldset>
        {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={action.busy || !form.reviewed}>{action.busy ? "Saving…" : action.unconfirmed ? "Retry unchanged review" : "Save reviewed default"}</Button>
          {action.unconfirmed && <Button type="button" variant="outline" onClick={() => void action.checkSaved().then(saved)} disabled={action.busy}>Check saved action</Button>}
          {form.original && !action.unconfirmed && <Button type="button" variant="outline" onClick={() => void reload()} disabled={action.busy}>Reload latest saved default</Button>}
          <Button type="button" variant="ghost" disabled={action.busy || action.unconfirmed} onClick={() => { if (!dirty || window.confirm("Discard this clinical-default draft?")) { setForm(null);action.clear(); } }}>Close editor</Button>
        </div>
      </form>
    </CardContent></Card>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
