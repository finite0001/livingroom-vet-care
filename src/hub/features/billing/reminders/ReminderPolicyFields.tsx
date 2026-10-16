import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { policySchema } from "./model";
interface ReminderPolicyFieldsProps {
  prefix: string;
  policy: z.infer<typeof policySchema>;
  days: string;
  disabled: boolean;
  canSave: boolean;
  onPolicyChange: (policy: z.infer<typeof policySchema>) => void;
  onDaysChange: (days: string) => void;
  onSave: () => void;
}
export function ReminderPolicyFields({
  prefix,
  policy,
  days,
  disabled,
  canSave,
  onPolicyChange,
  onDaysChange,
  onSave,
}: ReminderPolicyFieldsProps) {
  return (
    <fieldset disabled={disabled} className="space-y-3 pt-3">
      <p className="text-sm text-muted-foreground">
        These settings apply to enrolled invoices. Turning practice reminders
        off blocks unattempted sends. Automatic scheduling and email/text
        delivery must also be activated before reminders can send.
      </p>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={(e) =>
            onPolicyChange({ ...policy, enabled: e.target.checked })
          }
        />
        Enable practice invoice reminders
      </label>
      <div>
        <Label htmlFor={`${prefix}-terms`}>
          Default days until due (0 = due on receipt)
        </Label>
        <Input
          id={`${prefix}-terms`}
          type="number"
          min={0}
          max={365}
          value={policy.default_due_days}
          onChange={(e) =>
            onPolicyChange({
              ...policy,
              default_due_days: Number(e.target.value),
            })
          }
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-days`}>Reminder days after due date</Label>
        <Input
          id={`${prefix}-days`}
          value={days}
          onChange={(e) => onDaysChange(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-contact`}>
          Practice payment/contact instructions
        </Label>
        <Input
          id={`${prefix}-contact`}
          maxLength={200}
          value={policy.practice_contact}
          onChange={(e) =>
            onPolicyChange({ ...policy, practice_contact: e.target.value })
          }
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-subject`}>Email subject</Label>
        <Input
          id={`${prefix}-subject`}
          value={policy.email_subject}
          maxLength={200}
          onChange={(e) =>
            onPolicyChange({ ...policy, email_subject: e.target.value })
          }
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-body`}>Email reminder wording</Label>
        <Textarea
          id={`${prefix}-body`}
          value={policy.email_body}
          maxLength={6000}
          onChange={(e) =>
            onPolicyChange({ ...policy, email_body: e.target.value })
          }
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-sms`}>Text reminder wording</Label>
        <Textarea
          id={`${prefix}-sms`}
          value={policy.sms_body}
          maxLength={800}
          onChange={(e) =>
            onPolicyChange({ ...policy, sms_body: e.target.value })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Supported placeholders:{" "}
        {
          "{{invoice_reference}}, {{amount_due}}, {{due_date}}, {{practice_contact}}"
        }
        . Amount is USD without the dollar symbol. Review wording before saving.
      </p>
      <Button onClick={onSave} disabled={!canSave}>
        Save practice reminder policy
      </Button>
    </fieldset>
  );
}
