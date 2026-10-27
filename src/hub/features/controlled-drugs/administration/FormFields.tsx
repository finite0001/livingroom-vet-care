import { useId, useMemo, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countObservationChoices } from "../count/count-entry.ts";
export interface SelectChoice { readonly value: string; readonly label: string }
interface SelectFieldProps { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly choices: readonly SelectChoice[]; readonly required?: boolean; readonly hint?: string }
export function SelectField({ label, value, onChange, choices, required = true, hint }: SelectFieldProps) {
  const id = useId();
  return <div className="grid min-w-0 gap-1"><Label htmlFor={id}>{label}</Label><select id={id} value={value} required={required} onChange={event => onChange(event.target.value)} className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose…</option>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}
interface TextFieldProps { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly maxLength?: number; readonly type?: "text" | "date" | "time"; readonly hint?: string }
export function TextField({ label, value, onChange, maxLength = 200, type = "text", hint }: TextFieldProps) {
  const id = useId(); return <div className="grid min-w-0 gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} type={type} step={type === "time" ? "1" : undefined} maxLength={maxLength} required autoComplete="off" />{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}
interface CheckFieldProps { readonly children: ReactNode; readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly required?: boolean }
export function CheckField({ children, checked, onChange, required }: CheckFieldProps) {
  return <label className="flex min-h-11 items-start gap-2 py-2 text-sm"><input className="mt-1 size-4 shrink-0 accent-primary" type="checkbox" checked={checked} required={required} onChange={event => onChange(event.target.checked)} /><span className="min-w-0 break-words">{children}</span></label>;
}
export interface LocalInstantDraft { readonly local: string; readonly offset: string }
interface LocalInstantFieldProps { readonly label: string; readonly value: LocalInstantDraft; readonly onChange: (value: LocalInstantDraft) => void }
export function LocalInstantField({ label, value, onChange }: LocalInstantFieldProps) {
  const id = useId(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const choices = useMemo(() => { try { return value.local ? countObservationChoices(value.local) : []; } catch { return []; } }, [value.local]);
  return <div className="grid min-w-0 gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} type="datetime-local" step="1" required value={value.local} onChange={event => onChange({ local: event.target.value, offset: "" })} /><p className="text-xs text-muted-foreground">Local time: {zone}</p>{choices.length > 1 && <SelectField label="Which occurrence?" value={value.offset} onChange={offset => onChange({ ...value, offset })} choices={choices.map((choice, index) => ({ value: choice.offset, label: `UTC${choice.offset} · ${index === 0 ? "first" : "later"} occurrence` }))} />}</div>;
}
