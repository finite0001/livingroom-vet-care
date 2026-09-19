import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClinicalProblemDraft } from "./history-fields";
interface Props {
  value: ClinicalProblemDraft;
  onChange: (value: ClinicalProblemDraft) => void;
  disabled: boolean;
}
export function ClinicalProblemFields({ value, onChange, disabled }: Props) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-medium">Locally authored finding</legend>
      <p>
        Review the source evidence and author the local finding. Source text
        does not establish a diagnosis, status or importance automatically.
      </p>
      <label className="block">
        Reviewed problem title
        <Input
          maxLength={250}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label className="block">
        Reviewed problem notes
        <Textarea
          maxLength={10000}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </label>
      <label className="block">
        Known onset date (leave blank when unknown)
        <Input
          type="date"
          value={value.onset}
          onChange={(e) => onChange({ ...value, onset: e.target.value })}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          Reviewed problem status
          <select
            className="block w-full rounded border bg-background p-2"
            value={value.status}
            onChange={(e) =>
              onChange({
                ...value,
                status: e.target.value as ClinicalProblemDraft["status"],
              })
            }
          >
            <option value="">Select status</option>
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <label>
          Reviewed problem importance
          <select
            className="block w-full rounded border bg-background p-2"
            value={value.importance}
            onChange={(e) =>
              onChange({
                ...value,
                importance: e.target
                  .value as ClinicalProblemDraft["importance"],
              })
            }
          >
            <option value="">Select importance</option>
            <option value="routine">Routine</option>
            <option value="high">Important — red alert</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}
