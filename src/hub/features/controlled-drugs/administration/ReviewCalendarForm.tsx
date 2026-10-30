import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { SelectField, TextField } from "./FormFields";
import { explicitBoolean, yesNoChoices } from "./form-values.ts";
import { calendarBodyFromProjection, calendarDateLabels, calendarProjectionValues, type CalendarDayDraft, type CalendarProjection } from "./calendar-projection.ts";
import { reviewConfigurationDefinitionSchema, type ReviewConfigurationDefinition, type ReviewConfigurationScope } from "./review-configuration-definition.ts";
import type { AdministrationConfiguration } from "./configuration-query.ts";
interface ReviewCalendarFormProps { readonly scope: ReviewConfigurationScope; readonly current: AdministrationConfiguration; readonly disabled: boolean; readonly project: (zone: string, localValues: readonly string[]) => Promise<Readonly<CalendarProjection>>; readonly onSubmit: (definition: ReviewConfigurationDefinition) => Promise<void>; readonly onDirtyChange: () => void }
export function ReviewCalendarForm({ scope, current, disabled, project, onSubmit, onDirtyChange }: ReviewCalendarFormProps) {
  const old = current.data.current;
  const [zone, setZone] = useState(""), [first, setFirst] = useState(""), [last, setLast] = useState(""), [enabled, setEnabled] = useState(old ? old.enabled ? "yes" : "no" : ""), [reference, setReference] = useState("");
  const [days, setDays] = useState<readonly CalendarDayDraft[]>([]), [projection, setProjection] = useState<CalendarProjection | null>(null), [error, setError] = useState("");
  const [projecting, setProjecting] = useState(false), [attempted, setAttempted] = useState(false), sent = useRef(false), projectFlight = useRef(false);
  function changed() { setProjection(null); setError(""); onDirtyChange(); }
  function day(at: number, patch: Partial<CalendarDayDraft>) { changed(); setDays(rows => rows.map((row, index) => index === at ? { ...row, ...patch } : row)); }
  function dates() { if (disabled || projecting || attempted) return; try { const labels = calendarDateLabels(first, last); changed(); setDays(labels.map(date => ({ date, staffed: "", closeLocal: "", closeFold: "" }))); } catch { setError("Choose one through thirty-one consecutive dates."); } }
  async function projectTimes() {
    if (disabled || projectFlight.current || attempted) return;
    let values: readonly string[]; try { values = calendarProjectionValues(days); } catch (cause) { setError(cause instanceof Error ? cause.message : "Complete every day."); return; }
    projectFlight.current = true; setProjecting(true); setError("");
    try { const result = await project(zone, values); setProjection(result); } catch { setError("Calendar times could not be verified against the backend. Check the zone and your login."); }
    finally { projectFlight.current = false; setProjecting(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || projecting || sent.current) return;
    let definition: ReviewConfigurationDefinition;
    try { if (!projection) throw new Error("Verify the calendar times first."); definition = reviewConfigurationDefinitionSchema.parse({ kind: "calendar", scope,
      expected_predecessor_id: old?.id ?? null, enabled: explicitBoolean(enabled), approval_reference: reference, body: calendarBodyFromProjection(zone, first, last, days, projection) }); }
    catch (cause) { setError(cause instanceof Error && !cause.name.includes("Zod") ? cause.message : "Complete the calendar, enabled status, and approval reference."); return; }
    sent.current = true; setAttempted(true); setError("");
    try { await onSubmit(definition); } catch (cause) { if (cause instanceof ControlledOperationNotSentError) { sent.current = false; setAttempted(false); setError("The preparation was not sent. Your entries are preserved."); } else setError("Check the original operation before submitting again."); }
  }
  return <form className="space-y-5" aria-label="Configure controlled review calendar" onSubmit={event => void submit(event)}><h2 className="font-display text-xl">Staffed review calendar</h2><p className="text-sm text-muted-foreground">Create a complete calendar for the chosen dates. The backend verifies time-zone changes and repeated or missing local times.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<fieldset disabled={disabled || projecting || attempted} className="space-y-4"><SelectField label="Enable this calendar?" value={enabled} onChange={value => { changed(); setEnabled(value); }} choices={yesNoChoices} /><TextField label="Time zone" value={zone} hint="Use a named zone, for example America/Denver." onChange={value => { changed(); setZone(value); setDays([]); }} maxLength={100} /><div className="grid gap-3 md:grid-cols-2"><TextField label="First date" value={first} type="date" onChange={value => { changed(); setFirst(value); setDays([]); }} /><TextField label="Last date" value={last} type="date" onChange={value => { changed(); setLast(value); setDays([]); }} /></div><Button type="button" variant="outline" className="min-h-11" onClick={dates}>Set calendar dates</Button>
    {days.map((row, index) => { const local = row.date + "T" + (row.closeLocal.length === 5 ? row.closeLocal + ":00" : row.closeLocal), candidates = projection?.local_values.find(item => item.local_timestamp === local)?.candidates; return <fieldset key={row.date} className="space-y-3 rounded-xl border p-4"><legend className="px-1 font-medium">{row.date}</legend><SelectField label="Is this a staffed day?" value={row.staffed} onChange={value => day(index, { staffed: value as CalendarDayDraft["staffed"], closeLocal: "", closeFold: "" })} choices={yesNoChoices} />{row.staffed === "yes" && <><TextField label="Local closing time" type="time" value={row.closeLocal} onChange={value => day(index, { closeLocal: value, closeFold: "" })} />{candidates?.length === 0 && <p role="alert">This closing time does not exist. Choose another time and verify again.</p>}{candidates?.length === 2 && <SelectField label="Which occurrence of this closing time?" value={row.closeFold} onChange={value => { setError(""); onDirtyChange(); setDays(rows => rows.map((item, at) => at === index ? { ...item, closeFold: value as CalendarDayDraft["closeFold"] } : item)); }} choices={candidates.map((candidate, at) => ({ value: String(at), label: `${at === 0 ? "First" : "Later"} occurrence · ${candidate.utc}` }))} />}</>}</fieldset>; })}
    <Button type="button" variant="outline" className="min-h-11" disabled={!days.length} onClick={() => void projectTimes()}>Verify calendar times</Button>{projection && <p role="status" className="text-sm">Backend times loaded. Resolve any missing or repeated closing time before preparing.</p>}<TextField label="Approval reference" maxLength={200} value={reference} onChange={value => { setError(""); onDirtyChange(); setReference(value); }} /><Button type="submit" className="min-h-11" disabled={!projection}>Prepare calendar for review</Button></fieldset></form>;
}
