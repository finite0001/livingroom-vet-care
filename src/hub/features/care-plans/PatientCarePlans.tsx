import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { selectClass } from "@/hub/features/care-reminders/model";
import { denverCalendarDay } from "@/hub/features/care-reminders/date-tools";
import { RecurrenceFields } from "./RecurrenceFields";
import { calendarDue } from "./calendar";
import { careHistory, completionSources, patientPlansPage, previewCompletion, readPlan, templatesPage } from "./api";
import { careActionError, useCareAction } from "./use-care-action";
import { kindLabels, statusLabels, planValues, planCycle, planValuesSchema, planStatusSchema, sourceKindFor, sourceCursorSchema,
  type CarePlan, type CareTemplate, type CompletionSource, type PlanValues } from "./model";
import type { z } from "zod";

interface PatientCarePlansProps { petId: string; inactive: boolean; disabled?: boolean; onDirtyChange: (dirty: boolean) => void }
interface PlanForm { id: string; original: CarePlan | null; values: PlanValues; reviewed: boolean }
interface CompletionForm { plan: CarePlan; source: CompletionSource | null; review: string; reviewed: boolean }
interface PatientSessionProps extends PatientCarePlansProps { actorId: string; canReview: boolean }

export function PatientCarePlans(props: PatientCarePlansProps) {
  const { session, hasRole, profile } = useAuth();
  return <PatientSession key={`${session?.user.id}:${props.petId}`} actorId={session?.user.id ?? ""}
    canReview={hasRole("DVM") && !!profile?.full_name?.trim()} {...props} />;
}

function PatientSession({ actorId, canReview, petId, inactive, disabled = false, onDirtyChange }: PatientSessionProps) {
  const cache = useQueryClient(), action = useCareAction(actorId);
  const [form, setForm] = useState<PlanForm | null>(null), [completion, setCompletion] = useState<CompletionForm | null>(null);
  const [choosing, setChoosing] = useState(false), [historyId, setHistoryId] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [previewError, setPreviewError] = useState(""), [reloading, setReloading] = useState(false);
  const dirty = !!form || !!completion || action.busy || action.unconfirmed || reloading;
  useEffect(() => { onDirtyChange(dirty);return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const latestInactive = useRef(inactive);latestInactive.current = inactive;
  const frozen = action.busy || action.unconfirmed || reloading;
  const readOnly = inactive || disabled;
  const query = useInfiniteQuery({
    queryKey: ["patient-care-plans", actorId, petId], enabled: !!actorId && !dirty,
    initialPageParam: null as string | null, queryFn: ({ pageParam }) => patientPlansPage(petId, pageParam),
    getNextPageParam: page => page.next ?? undefined, retry: 1, refetchOnWindowFocus: !dirty,
  });
  const defaults = useInfiniteQuery({
    queryKey: ["recurring-care-templates", actorId], enabled: !!actorId && (choosing || !!form),
    initialPageParam: null as string | null, queryFn: ({ pageParam }) => templatesPage(pageParam),
    getNextPageParam: page => page.next ?? undefined, retry: 1, refetchOnWindowFocus: !dirty,
  });
  const templates = defaults.data?.pages.flatMap(page => page.rows) ?? [];
  const history = useInfiniteQuery({
    queryKey: ["care-plan-history", actorId, petId, historyId], enabled: !!actorId && !!historyId && !dirty,
    initialPageParam: null as number | null, queryFn: ({ pageParam }) => careHistory(historyId!, petId, pageParam),
    getNextPageParam: page => page.next ?? undefined, retry: 1,
  });
  const sources = useInfiniteQuery({
    queryKey: ["care-completion-sources", actorId, petId, completion?.plan.id, completion?.plan.version],
    enabled: !!completion && !action.unconfirmed && !action.busy && !inactive,
    initialPageParam: null as z.infer<typeof sourceCursorSchema> | null,
    queryFn: ({ pageParam }) => completionSources(petId, completion!.plan.id, sourceKindFor(completion!.plan.care_kind), pageParam),
    getNextPageParam: page => page.next ?? undefined, retry: 1, refetchOnWindowFocus: false,
  });
  const preview = useQuery({
    queryKey: ["care-completion-preview", actorId, petId, completion?.plan.id, completion?.plan.version,
      completion?.source?.source_kind, completion?.source?.id, completion?.source?.source_version],
    enabled: !!completion?.source && !action.unconfirmed && !action.busy && !inactive,
    queryFn: () => previewCompletion(completion!.plan.id, petId, completion!.plan.version, completion!.source!),
    retry: false, refetchOnWindowFocus: false, staleTime: 0,
  });
  function discard(): boolean {
    return !frozen && (!dirty || window.confirm("Discard this unsaved care-plan review?"));
  }
  function edit(original: CarePlan) {
    if (readOnly || !discard()) return;
    const values = planValues(original);
    if (!canReview && values.status === "current") { values.status = "proposed";values.reminders_enabled = false; }
    setForm({ id: original.id, original, values, reviewed: false });setCompletion(null);setChoosing(false);action.clear();setNotice("");
  }
  function add(template: CareTemplate) {
    if (readOnly || !discard()) return;
    const anchor = denverCalendarDay();
    const values: PlanValues = { template_id: template.id, template_version: template.version, name: template.name,
      interval_amount: template.interval_amount, interval_unit: template.interval_unit, anchor_mode: template.anchor_mode,
      month_end: template.month_end, anchor_on: anchor, due_on: calendarDue(anchor, template), status: "proposed",
      reminders_enabled: false, review_note: "", override_reason: "", replace_anchor_evidence: false };
    setForm({ id: crypto.randomUUID(), original: null, values, reviewed: false });setCompletion(null);setChoosing(false);action.clear();setNotice("");
  }
  function change(values: Partial<PlanValues>) {
    if (!form) return;
    const next = { ...form.values, ...values };
    if (next.status !== "current") next.reminders_enabled = false;
    setForm({ ...form, values: next, reviewed: false });
  }
  let calculated: string | null = null;
  if (form) { try { calculated = calendarDue(form.values.anchor_on, form.values, planCycle(form.original, form.values)); } catch { /* The form shows an incomplete-calendar message below. */ } }
  const template = form ? templates.find(row => row.id === form.values.template_id && row.version === form.values.template_version)
    ?? (form.original?.template_version === form.values.template_version ? form.original.template_snapshot : null) : null;
  const override = !!form && !!template && (form.values.name !== template.name || form.values.interval_amount !== template.interval_amount
    || form.values.interval_unit !== template.interval_unit || form.values.anchor_mode !== template.anchor_mode
    || form.values.month_end !== template.month_end || form.values.due_on !== calculated);
  async function saved(receipt: unknown) {
    if (!receipt) return;
    setForm(null);setCompletion(null);setChoosing(false);setNotice("Care plan saved. Its next due date and reminder eligibility have been refreshed.");
    await Promise.all([...["patient-care-plans", "recurring-care-due", "care-plan-history", "care-completion-sources", "care-reminder-jobs", "patient-360", "household-360", "daily-communications"]
      .map(key => cache.invalidateQueries({ queryKey: [key] }))]);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (action.unconfirmed) { await saved(await action.retry());return; }
    if (!form || latestInactive.current || disabled || form.values.status === "current" && (!canReview || !form.reviewed)) return;
    const parsed = planValuesSchema.safeParse(form.values);
    if (!parsed.success) { action.setError(parsed.error.issues[0].message);return; }
    if (override && !parsed.data.override_reason) { action.setError("Explain the patient-specific override before saving.");return; }
    await saved(await action.save({ kind: "plan", entityId: form.id, petId, expectedVersion: form.original?.version ?? null, values: parsed.data }));
  }
  async function reload() {
    const id = form?.original?.id ?? completion?.plan.id;
    if (!id || frozen || !window.confirm("Replace this draft after loading the latest saved care plan?")) return;
    setReloading(true);
    try {
      const latest = await readPlan(id, petId);if (!latest) throw new Error();
      const values = planValues(latest.plan);
      if (!canReview && values.status === "current") { values.status = "proposed";values.reminders_enabled = false; }
      setForm({ id, original: latest.plan, values, reviewed: false });setCompletion(null);action.clear();setPreviewError("");
      setNotice("Loaded the latest plan. Review it and select completed care again if needed.");
    } catch { action.setError("Could not load the latest care plan. Your draft is retained."); }
    finally { setReloading(false); }
  }
  function startCompletion(plan: CarePlan) {
    if (readOnly || !canReview || !discard()) return;
    setCompletion({ plan, source: null, review: "", reviewed: false });setForm(null);setChoosing(false);setPreviewError("");action.clear();setNotice("");
  }
  async function complete(event: React.FormEvent) {
    event.preventDefault();
    if (action.unconfirmed) { await saved(await action.retry());return; }
    if (!completion?.source || !completion.reviewed || !completion.review.trim() || !preview.data || preview.isError
      || preview.isFetching || !canReview || latestInactive.current || disabled) return;
    await saved(await action.save({ kind: "completion", entityId: completion.plan.id, petId, expectedVersion: completion.plan.version,
      values: { source_kind: completion.source.source_kind, source_id: completion.source.id, source_version: completion.source.source_version, review_note: completion.review } }));
  }
  function close() { if (discard()) { setForm(null);setCompletion(null);action.clear();setPreviewError(""); } }
  const rows = query.data?.pages.flatMap(page => page.rows) ?? [];
  return <section aria-label="Recurring care plans" className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl">Recurring care plans</h2>
      <p className="text-sm text-muted-foreground">Practice defaults with reviewed patient overrides. Record completed care first, then link it here to advance the schedule.</p></div>
      <Button disabled={readOnly || frozen} onClick={() => { if (discard()) { setForm(null);setCompletion(null);setChoosing(true);action.clear(); } }}>Add care plan</Button></header>
    {inactive && <p className="text-sm">This patient is deceased or archived. Care history is retained and routine reminders are stopped. Reactivation requires a fresh veterinarian review.</p>}
    {!canReview && <p className="text-sm text-muted-foreground">You can propose, pause or retire a plan. A named veterinarian approves current clinical plans and completed care.</p>}
    {query.isPending && <p role="status">Loading care plans…</p>}
    {query.isError && <div role="alert"><p>Care plans could not load.</p><Button variant="outline" onClick={() => void query.refetch()} disabled={dirty}>Reload care plans</Button></div>}
    {!query.isPending && !query.isError && !rows.length && <p>No recurring care plans yet.</p>}
    <div className="grid gap-3 md:grid-cols-2">{rows.map(row => <Card key={row.plan.id}><CardHeader><CardTitle className="text-base">{row.plan.name}</CardTitle></CardHeader><CardContent className="space-y-2">
      <Badge variant="outline">{statusLabels[row.plan.status]}</Badge><p>{kindLabels[row.plan.care_kind]} · due {row.plan.due_on}</p>
      <p className="text-sm">Every {row.plan.interval_amount} {row.plan.interval_unit} · {row.plan.anchor_mode === "completed_care" ? "from completed care" : "on the fixed calendar"}</p>
      <p className="text-xs text-muted-foreground">Plan version {row.plan.version} · practice default version {row.plan.template_version}</p>
      {row.plan.override_reason && <p className="text-sm">Patient override: {row.plan.override_reason}</p>}
      <p className="text-sm">{row.reminder_reason}</p>
      {row.next_send_at && <p className="text-sm">Next send window: {new Date(row.next_send_at).toLocaleString("en-US", { timeZone: "America/Denver" })} (Denver)</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={readOnly || frozen || row.plan.status === "retired"} onClick={() => edit(row.plan)}>Review care plan</Button>
        {canReview && row.plan.status === "current" && <Button variant="outline" disabled={readOnly || frozen} onClick={() => startCompletion(row.plan)}>Link completed care</Button>}
        <Button variant="ghost" disabled={dirty} onClick={() => setHistoryId(historyId === row.plan.id ? null : row.plan.id)}>Care plan history</Button></div>
    </CardContent></Card>)}</div>
    {query.hasNextPage && <Button variant="outline" disabled={dirty || query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more care plans</Button>}
    {query.isFetchNextPageError && <p role="alert">Could not load more plans. Loaded results are retained.</p>}
    {choosing && <Card><CardHeader><CardTitle className="text-base">Choose a reviewed practice default</CardTitle></CardHeader><CardContent className="space-y-3">
      {defaults.isPending && <p role="status">Loading defaults…</p>}
      {defaults.isError && <div role="alert"><p>Could not load defaults.</p><Button variant="outline" onClick={() => void defaults.refetch()}>Retry defaults</Button></div>}
      {!defaults.isPending && !defaults.isError && !templates.some(row => row.active) && <p>No active defaults loaded. A veterinarian can configure defaults under Care reminders.</p>}
      <div className="flex flex-wrap gap-2">{templates.filter(row => row.active).map(row => <Button key={row.id} variant="outline" onClick={() => add(row)}>{row.name} · every {row.interval_amount} {row.interval_unit}</Button>)}</div>
      {defaults.hasNextPage && <Button variant="outline" onClick={() => void defaults.fetchNextPage()} disabled={defaults.isFetchingNextPage}>Load more practice defaults</Button>}
      {defaults.isFetchNextPageError && <p role="alert">Could not load more defaults. Loaded defaults are retained.</p>}
      <Button variant="ghost" onClick={() => setChoosing(false)}>Close default chooser</Button>
    </CardContent></Card>}
    {form && <Card><CardHeader><CardTitle className="text-base">{form.original ? "Review patient care plan" : "Propose patient care plan"}</CardTitle></CardHeader><CardContent>
      <form className="space-y-4" onSubmit={event => void submit(event)}>
        <fieldset disabled={frozen || readOnly} className="space-y-3">
          <div><Label htmlFor="patient-care-name">Patient care name</Label><Input id="patient-care-name" value={form.values.name} onChange={e => change({ name: e.target.value })} maxLength={160} /></div>
          <p className="text-xs text-muted-foreground">Reviewed practice snapshot: version {form.values.template_version}. Updates require an explicit review here.</p>
          {templates.find(row => row.id === form.values.template_id && row.version > form.values.template_version && row.active) && <Button type="button" variant="outline" onClick={() => {
            const next = templates.find(row => row.id === form.values.template_id)!;
            change({ template_version: next.version, name: next.name, interval_amount: next.interval_amount, interval_unit: next.interval_unit,
              anchor_mode: next.anchor_mode, month_end: next.month_end, status: "proposed", reminders_enabled: false });
          }}>Use latest practice default for review</Button>}
          <RecurrenceFields values={form.values} onChange={change} disabled={frozen || readOnly} prefix="patient-care" />
          <div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor="patient-care-anchor">Calendar anchor date</Label><Input id="patient-care-anchor" type="date" value={form.values.anchor_on} onChange={e => change({ anchor_on: e.target.value })} /></div>
            <div><Label htmlFor="patient-care-due">Patient care due date</Label><Input id="patient-care-due" type="date" value={form.values.due_on} onChange={e => change({ due_on: e.target.value })} /></div></div>
          <p className="text-sm">{calculated ? `Calendar rule calculates ${calculated}.` : "Complete a valid interval and anchor to preview the due date."} The anchor sets a schedule; it does not record a performed service.</p>
          {calculated && calculated !== form.values.due_on && <Button type="button" variant="outline" onClick={() => change({ due_on: calculated! })}>Use calculated due date</Button>}
          <div><Label htmlFor="patient-care-override">Patient override or replacement-baseline reason</Label><Textarea id="patient-care-override" value={form.values.override_reason} onChange={e => change({ override_reason: e.target.value })} maxLength={2000} /></div>
          {form.original?.last_completion_id && canReview && <label className="flex items-start gap-2"><Checkbox checked={form.values.replace_anchor_evidence} onCheckedChange={value => change({ replace_anchor_evidence: value === true })} /><span>Replace the completed-care baseline after reviewing corrected evidence. Keep the previous completion in history.</span></label>}
          <div><Label htmlFor="patient-care-status">Care plan status</Label><select id="patient-care-status" className={selectClass} value={form.values.status} onChange={e => change({ status: planStatusSchema.parse(e.target.value) })}>
            {planStatusSchema.options.map(status => <option key={status} value={status} disabled={status === "current" && !canReview}>{statusLabels[status]}</option>)}</select></div>
          <label className="flex items-start gap-2"><Checkbox disabled={form.values.status !== "current" || !canReview} checked={form.values.reminders_enabled} onCheckedChange={value => change({ reminders_enabled: value === true })} /><span>Enable routine reminders for this reviewed plan</span></label>
          <div><Label htmlFor="patient-care-review">Care plan review or stop reason</Label><Textarea id="patient-care-review" value={form.values.review_note} onChange={e => change({ review_note: e.target.value })} maxLength={2000} /></div>
          {form.values.status === "current" && <label className="flex items-start gap-2"><Checkbox checked={form.reviewed} onCheckedChange={value => setForm({ ...form, reviewed: value === true })} /><span>I reviewed this patient's interval, due date and reminder eligibility</span></label>}
        </fieldset>
        {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={action.busy || reloading || readOnly || form.values.status === "current" && !form.reviewed}>{action.unconfirmed ? "Retry unchanged care review" : "Save patient care plan"}</Button>
          {action.unconfirmed && <Button type="button" variant="outline" disabled={action.busy} onClick={() => void action.checkSaved().then(saved)}>Check saved action</Button>}
          {form.original && !action.unconfirmed && <Button type="button" variant="outline" disabled={frozen} onClick={() => void reload()}>Reload latest care plan</Button>}
          <Button type="button" variant="ghost" disabled={frozen} onClick={close}>Close care editor</Button></div>
      </form>
    </CardContent></Card>}
    {completion && <Card><CardHeader><CardTitle className="text-base">Link completed care: {completion.plan.name}</CardTitle></CardHeader><CardContent>
      <form onSubmit={event => void complete(event)} className="space-y-4">
        <fieldset disabled={frozen || readOnly} className="space-y-3">
          <p className="text-sm">Choose a recorded {sourceKindFor(completion.plan.care_kind) ?? "service, vaccine or collected lab"} for this patient. The recorded care date determines recurrence.</p>
          {sources.isPending && <p role="status">Loading recorded care…</p>}
          {sources.isError && <div role="alert"><p>Could not load recorded care.</p><Button type="button" variant="outline" onClick={() => void sources.refetch()}>Retry recorded care</Button></div>}
          {!sources.isPending && !sources.isError && !sources.data?.pages.some(page => page.rows.length) && <p>No eligible recorded care after this plan's anchor. Record the service, vaccine administration or collected lab in its clinical section first.</p>}
          <div role="radiogroup" aria-label="Recorded care source" className="space-y-2">{sources.data?.pages.flatMap(page => page.rows).map(source => <label key={`${source.source_kind}:${source.id}`} className="flex items-start gap-3 rounded-md border p-3">
            <input type="radio" name="completed-care-source" checked={completion.source?.id === source.id && completion.source.source_kind === source.source_kind && completion.source.source_version === source.source_version} onChange={() => { setCompletion({ ...completion, source, reviewed: false });setPreviewError(""); }} />
            <span>{source.label}<span className="block text-xs text-muted-foreground">{source.source_kind} · recorded care date {source.completed_on}</span></span></label>)}</div>
          {sources.hasNextPage && <Button type="button" variant="outline" disabled={sources.isFetchingNextPage} onClick={() => void sources.fetchNextPage()}>Load earlier recorded care</Button>}
          {sources.isFetchNextPageError && <p role="alert">Could not load more recorded care. Loaded sources are retained.</p>}
          {completion.source && <p className="text-sm">Selected evidence: {completion.source.label} · {completion.source.completed_on}. This selection stays fixed until you explicitly choose another source.</p>}
          {preview.isFetching && <p role="status">Checking source and calculating next due date…</p>}
          {preview.isError && <div role="alert"><p>{careActionError(preview.error)}</p><Button type="button" variant="outline" onClick={() => { setPreviewError("");void preview.refetch(); }}>Recheck selected source</Button></div>}
          {preview.data && !preview.isError && !preview.isFetching && <p className="rounded-md border bg-muted p-3">Completed care: {preview.data.completed_on} · next due: {preview.data.next_due_on}</p>}
          <div><Label htmlFor="completed-care-review">Completed care clinical review</Label><Textarea id="completed-care-review" value={completion.review} onChange={e => setCompletion({ ...completion, review: e.target.value, reviewed: false })} maxLength={2000} /></div>
          <label className="flex items-start gap-2"><Checkbox checked={completion.reviewed} onCheckedChange={value => setCompletion({ ...completion, reviewed: value === true })} /><span>I reviewed that this recorded care fulfills this plan and its calculated next due date</span></label>
        </fieldset>
        {(action.error || previewError) && <p role="alert" className="text-sm text-destructive">{action.error || previewError}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={action.busy || reloading || readOnly || !completion.reviewed || !completion.review.trim() || !preview.data || preview.isError || preview.isFetching}>{action.unconfirmed ? "Retry unchanged completion" : "Confirm completed care"}</Button>
          {action.unconfirmed && <Button type="button" variant="outline" disabled={action.busy} onClick={() => void action.checkSaved().then(saved)}>Check saved action</Button>}
          {!action.unconfirmed && <Button type="button" variant="outline" disabled={frozen} onClick={() => void reload()}>Reload latest care plan</Button>}
          <Button type="button" variant="ghost" disabled={frozen} onClick={close}>Close completion review</Button></div>
      </form>
    </CardContent></Card>}
    {historyId && <Card><CardHeader><CardTitle className="text-base">Care plan history</CardTitle></CardHeader><CardContent className="space-y-3">
      {history.isPending && <p role="status">Loading care history…</p>}
      {history.isError && <div role="alert"><p>Could not load care history.</p><Button variant="outline" onClick={() => void history.refetch()}>Retry care history</Button></div>}
      {history.data?.pages.flatMap(page => page.rows).map(row => <div key={row.version} className="space-y-1 rounded-md border p-3 text-sm"><p>Version {row.version} · {statusLabels[row.snapshot.status]} · due {row.snapshot.due_on}</p>
        <p>{row.snapshot.review_note}</p><p className="text-xs text-muted-foreground">{new Date(row.recorded_at).toLocaleString("en-US", { timeZone: "America/Denver" })} (Denver) · {row.actor_id ? "Staff action" : "Automatic eligibility update"}</p>
        {row.completion && <p>Completed: {row.completion.source_snapshot.label} · {row.completion.completed_on} · next due {row.completion.next_due_on}</p>}</div>)}
      {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage || dirty} onClick={() => void history.fetchNextPage()}>Load earlier care history</Button>}
      {history.isFetchNextPageError && <p role="alert">Could not load earlier history. Loaded history is retained.</p>}
      <Button variant="ghost" onClick={() => setHistoryId(null)}>Close care history</Button>
    </CardContent></Card>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
