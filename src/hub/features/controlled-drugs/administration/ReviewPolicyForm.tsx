import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { reviewEventLabels } from "../record-review/review-labels.ts";
import { countObservationTime } from "../count/count-entry.ts";
import { LocalInstantField, SelectField, TextField } from "./FormFields";
import { explicitBoolean, yesNoChoices } from "./form-values.ts";
import { sourceReviewPolicyRule, reviewConfigurationDefinitionSchema, type NativeDeadlineKind, type ReviewConfigurationDefinition, type ReviewConfigurationScope } from "./review-configuration-definition.ts";
import type { AdministrationConfiguration } from "./configuration-query.ts";
interface ReviewPolicyFormProps { readonly scope: ReviewConfigurationScope; readonly current: AdministrationConfiguration; readonly calendar: AdministrationConfiguration; readonly routing: AdministrationConfiguration; readonly disabled: boolean; readonly onSubmit: (definition: ReviewConfigurationDefinition) => Promise<void>; readonly onDirtyChange: () => void }
export function ReviewPolicyForm({ scope, current, calendar, routing, disabled, onSubmit, onDirtyChange }: ReviewPolicyFormProps) {
  const old = current.data.current, oldBody = old && "rules" in old.body ? old.body : null;
  const [enabled, setEnabled] = useState(old ? old.enabled ? "yes" : "no" : ""), [reference, setReference] = useState(""), [mode, setMode] = useState("");
  const [at, setAt] = useState({ local: "", offset: "" }), [nativeKind, setNativeKind] = useState(oldBody ? oldBody.native_deadline_kind ?? "none" : "");
  const [calendarId, setCalendarId] = useState(""), [routingId, setRoutingId] = useState("");
  const [rules, setRules] = useState<Readonly<Record<string, string>>>(() => Object.fromEntries(reviewEventKindSchema.options.map(kind => [kind, oldBody ? oldBody.rules[kind]!.enabled ? "yes" : "no" : ""])));
  const [error, setError] = useState(""), [attempted, setAttempted] = useState(false), sent = useRef(false);
  function changed() { setError(""); onDirtyChange(); }
  function native(): NativeDeadlineKind { if (nativeKind === "none") return null; if (nativeKind !== "record_native_dispense" && nativeKind !== "record_native_pickup") throw new Error("Choose the native deadline action."); return nativeKind; }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || sent.current) return;
    let definition: ReviewConfigurationDefinition;
    try {
      const selectedNative = native();
      if (mode !== "now" && mode !== "at" || calendarId !== "none" && calendarId !== calendar.data.current?.id || routingId !== "none" && routingId !== routing.data.current?.id) throw new Error("Choose current published dependencies and an effective time.");
      definition = reviewConfigurationDefinitionSchema.parse({ kind: "policy", scope, expected_predecessor_id: old?.id ?? null, enabled: explicitBoolean(enabled), approval_reference: reference,
        body: { effective_from: { mode, at: mode === "now" ? null : countObservationTime(at.local, at.offset) }, calendar_id: calendarId === "none" ? null : calendarId, routing_id: routingId === "none" ? null : routingId,
          native_deadline_kind: selectedNative, rules: Object.fromEntries(reviewEventKindSchema.options.map(kind => [kind, sourceReviewPolicyRule(kind, explicitBoolean(rules[kind]), selectedNative)])) } });
    } catch { setError("Complete every review rule, effective time, and required published calendar or escalation route. The selected native deadline action must be enabled."); return; }
    sent.current = true; setAttempted(true); setError("");
    try { await onSubmit(definition); } catch (cause) { if (cause instanceof ControlledOperationNotSentError) { sent.current = false; setAttempted(false); setError("The preparation was not sent. Your entries are preserved."); } else setError("Check the original operation before submitting again."); }
  }
  const dependencyChoices = (source: AdministrationConfiguration) => [{ value: "none", label: "No dependency" }, ...(source.data.current?.enabled ? [{ value: source.data.current.id!, label: `Published version ${source.data.current.version}` }] : [])];
  return <form className="space-y-5" aria-label="Configure controlled record review policy" onSubmit={event => void submit(event)}><h2 className="font-display text-xl">Independent record-review policy</h2><p className="text-sm text-muted-foreground">Choose which movements need review. Timing and escalation follow the source-defined action rules shown below.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<fieldset disabled={disabled || attempted} className="space-y-4"><SelectField label="Enable this policy?" value={enabled} onChange={value => { changed(); setEnabled(value); }} choices={yesNoChoices} /><SelectField label="When should the policy take effect?" value={mode} onChange={value => { changed(); setMode(value); }} choices={[{ value: "now", label: "At publication" }, { value: "at", label: "At an explicit time" }]} />{mode === "at" && <LocalInstantField label="Effective time" value={at} onChange={value => { changed(); setAt(value); }} />}<SelectField label="Staffed calendar" value={calendarId} onChange={value => { changed(); setCalendarId(value); }} choices={dependencyChoices(calendar)} /><SelectField label="Escalation recipients" value={routingId} onChange={value => { changed(); setRoutingId(value); }} choices={dependencyChoices(routing)} /><SelectField label="Native medication action with a staffed-day deadline" value={nativeKind} onChange={value => { changed(); setNativeKind(value); }} choices={[{ value: "none", label: "Neither native action" }, { value: "record_native_dispense", label: "Medication dispensed" }, { value: "record_native_pickup", label: "Medication picked up" }]} />
    {reviewEventKindSchema.options.map(kind => { let timing = "Choose this rule and the native deadline action."; try { const row = sourceReviewPolicyRule(kind, explicitBoolean(rules[kind]), native()); timing = !row.enabled ? "Review disabled" : row.deadline_mode === "next_staffed_day_close" ? "Review by next staffed-day close; escalate when overdue" : row.escalation_mode === "immediate_on_record" ? "Escalate when recorded; no staffed-day deadline" : "Review required; no configured deadline or escalation"; } catch { /* Incomplete choices remain visible. */ } return <div key={kind} className="rounded-xl border p-4"><SelectField label={reviewEventLabels[kind]} value={rules[kind]} onChange={value => { changed(); setRules(rows => ({ ...rows, [kind]: value })); }} choices={yesNoChoices} hint={timing} /></div>; })}
    <TextField label="Approval reference" value={reference} maxLength={200} onChange={value => { changed(); setReference(value); }} /><Button type="submit" className="min-h-11">Prepare review policy</Button></fieldset></form>;
}
