import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/hub/features/care-reminders/model";
import { anchorModeSchema, intervalUnitSchema, monthEndSchema, type Recurrence } from "./calendar";
interface RecurrenceFieldsProps {
  values: Recurrence;
  onChange: (values: Partial<Recurrence>) => void;
  disabled: boolean;
  prefix: string;
}
export function RecurrenceFields({ values, onChange, disabled, prefix }: RecurrenceFieldsProps) {
  return <fieldset disabled={disabled} className="grid gap-3 md:grid-cols-2">
    <div><Label htmlFor={prefix + "-amount"}>Repeat every</Label><Input id={prefix + "-amount"} type="number" min={1} step={1} value={values.interval_amount || ""} onChange={e => onChange({ interval_amount: Number(e.target.value) })} /></div>
    <div><Label htmlFor={prefix + "-unit"}>Calendar unit</Label><select id={prefix + "-unit"} className={selectClass} value={values.interval_unit} onChange={e => onChange({ interval_unit: intervalUnitSchema.parse(e.target.value) })}>
      <option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option>
    </select></div>
    <div><Label htmlFor={prefix + "-anchor-mode"}>Advance from</Label><select id={prefix + "-anchor-mode"} className={selectClass} value={values.anchor_mode} onChange={e => onChange({ anchor_mode: anchorModeSchema.parse(e.target.value) })}>
      <option value="completed_care">Actual completed care</option><option value="fixed_schedule">Original calendar schedule</option>
    </select></div>
    <div><Label htmlFor={prefix + "-month-end"}>Short-month rule</Label><select id={prefix + "-month-end"} className={selectClass} value={values.month_end} onChange={e => onChange({ month_end: monthEndSchema.parse(e.target.value) })}>
      <option value="clamp">Keep original day; use month-end when needed</option><option value="preserve_end">Keep month-end when the anchor is month-end</option>
    </select></div>
    <p className="text-xs text-muted-foreground md:col-span-2">Clinical due dates use calendar units. The original schedule keeps its anchor; late completion skips past dates without recording care that did not occur.</p>
  </fieldset>;
}
