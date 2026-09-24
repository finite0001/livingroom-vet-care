import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { careDb, selectClass, messageError } from "./model";
interface Policy {
  id: string;
  source_kind: string;
  channel: string;
  message_template_id: string;
  message_template_version: number;
  subject: string;
  enabled: boolean;
  review_note: string;
  version: number;
  approved_by: string;
  approved_at: string;
}
interface SavePolicy {
  p_id: string;
  p_expected_version: number | null;
  p_source_kind: string;
  p_channel: string;
  p_message_template_id: string;
  p_message_template_version: number;
  p_subject: string;
  p_enabled: boolean;
  p_review_note: string;
}
interface PolicyDatabase {
  public: {
    Tables: {
      reminder_automation_policies: {
        Row: { [K in keyof Policy]: Policy[K] };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      save_reminder_automation_policy: {
        Args: { [K in keyof SavePolicy]: SavePolicy[K] };
        Returns: Policy;
      };
      disable_reminder_automation_policy: {
        Args: {
          p_id: string;
          p_expected_version: number;
          p_review_note: string;
        };
        Returns: Policy;
      };
    };
  };
}
interface PolicyForm {
  id: string;
  existing: Policy | null;
  source: string;
  channel: string;
  templateId: string;
  subject: string;
  enabled: boolean;
  review: string;
}
interface ReminderDeliverySettingsProps {
  onDirtyChange: (dirty: boolean) => void;
}
const db = supabase as unknown as SupabaseClient<PolicyDatabase>;
const sources = [
  { value: "appointment", label: "Appointments" },
  { value: "vaccine", label: "Vaccines" },
  { value: "lab", label: "Lab work" },
];
export function ReminderDeliverySettings({
  onDirtyChange,
}: ReminderDeliverySettingsProps) {
  const { session, hasRole } = useAuth();
  const admin = hasRole("ADMIN");
  const cache = useQueryClient();
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = busy || (!!form && JSON.stringify(form) !== baseline);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const policies = useQuery({
    queryKey: ["reminder-delivery-policies", session?.user.id],
    enabled: admin,
    queryFn: async () => {
      const { data, error } = await db
        .from("reminder_automation_policies")
        .select("*")
        .order("source_kind")
        .order("channel")
        .limit(7);
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 6)
        throw new Error("Unexpected policy response");
      return data;
    },
  });
  const wording = useQuery({
    queryKey: ["care-message-templates"],
    enabled: admin,
    queryFn: async () => {
      const { data, error } = await careDb
        .from("care_message_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  function open(source: string, channel: string, row: Policy | null) {
    if (
      lock.current ||
      (dirty && !window.confirm("Discard unsaved delivery policy?"))
    )
      return;
    const next = {
      id: row?.id ?? crypto.randomUUID(),
      existing: row,
      source,
      channel,
      templateId: row?.message_template_id ?? "",
      subject: row?.subject ?? "",
      enabled: row?.enabled ?? false,
      review: "",
    };
    setForm(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setNotice("");
  }
  const template = wording.data?.find((t) => t.id === form?.templateId);
  const stopping = !!form?.existing && !form.enabled;
  async function save() {
    if (!form || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!session?.user.id || !admin)
        throw new Error("Active administrator required");
      if (!form.review.trim())
        throw new Error("Enter the reason for this policy review");
      if (stopping && form.existing) {
        const { error } = await db.rpc("disable_reminder_automation_policy", {
          p_id: form.id,
          p_expected_version: form.existing.version,
          p_review_note: form.review,
        });
        if (error) throw error;
      } else {
        if (
          !template?.active ||
          template.channel.toUpperCase() !== form.channel
        )
          throw new Error("Select current active wording for this channel");
        if (form.channel === "EMAIL" && !form.subject.trim())
          throw new Error("Enter an email subject");
        const { error } = await db.rpc("save_reminder_automation_policy", {
          p_id: form.id,
          p_expected_version: form.existing?.version ?? null,
          p_source_kind: form.source,
          p_channel: form.channel,
          p_message_template_id: template.id,
          p_message_template_version: template.version,
          p_subject: form.channel === "EMAIL" ? form.subject : "",
          p_enabled: form.enabled,
          p_review_note: form.review,
        });
        if (error) throw error;
      }
      setForm(null);
      setBaseline("");
      setNotice(
        "Delivery policy saved. Provider delivery is configured separately.",
      );
      await cache.invalidateQueries({
        queryKey: ["reminder-delivery-policies"],
      });
    } catch (e) {
      setError(
        `${messageError(e)}. Your policy draft is retained. Retry unchanged after an unconfirmed response, or reload the saved policy before revising it.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (
      !form ||
      lock.current ||
      !window.confirm("Replace this draft with the currently saved policy?")
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await policies.refetch();
      if (result.error) throw result.error;
      const row =
        result.data?.find(
          (p) => p.source_kind === form.source && p.channel === form.channel,
        ) ?? null;
      const next = {
        ...form,
        id: row?.id ?? form.id,
        existing: row,
        templateId: row?.message_template_id ?? "",
        subject: row?.subject ?? "",
        enabled: row?.enabled ?? false,
        review: "",
      };
      setForm(next);
      setBaseline(JSON.stringify(next));
      setNotice(
        "Loaded the currently saved policy. Review it before making another change.",
      );
    } catch (e) {
      setError(messageError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!admin) return null;
  return (
    <section
      aria-label="Reminder delivery policies"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-lg font-semibold">Reminder delivery policies</h2>
      <p className="text-sm text-muted-foreground">
        Choose reviewed wording separately for appointment, vaccine and lab
        reminders by email or text. Policies start off. Delivery also requires
        the configured scheduler and provider; saving here does not send a
        message.
      </p>
      {policies.isLoading && <p role="status">Loading delivery policies…</p>}
      {(policies.isError || wording.isError) && (
        <p role="alert">
          Delivery settings could not load.{" "}
          <Button
            variant="outline"
            onClick={() =>
              void Promise.all([policies.refetch(), wording.refetch()])
            }
          >
            Retry delivery settings
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {sources.flatMap((source) =>
          ["EMAIL", "SMS"].map((channel) => {
            const row = policies.data?.find(
              (p) => p.source_kind === source.value && p.channel === channel,
            );
            const current = wording.data?.find(
              (t) => t.id === row?.message_template_id,
            );
            return (
              <li
                key={`${source.value}-${channel}`}
                className="space-y-2 rounded-md border p-3"
              >
                <h3 className="font-medium">
                  {source.label} · {channel === "EMAIL" ? "Email" : "Text"}
                </h3>
                <p className="text-sm">
                  {policies.isLoading
                    ? "Loading policy…"
                    : policies.isError
                      ? "Policy status unavailable"
                      : row
                        ? `${row.enabled ? "Enabled policy" : "Off"} · revision ${row.version}`
                        : "Off · not configured"}
                </p>
                {row && (
                  <p className="text-sm text-muted-foreground">
                    {current?.name ?? "Wording unavailable"} · reviewed wording
                    revision {row.message_template_version}
                    {!current?.active ||
                    current.version !== row.message_template_version
                      ? " · needs a new wording review before delivery"
                      : ""}
                  </p>
                )}
                <Button
                  variant="outline"
                  disabled={busy || policies.isLoading || policies.isError}
                  onClick={() => open(source.value, channel, row ?? null)}
                >
                  Review {source.label.toLowerCase()} {channel.toLowerCase()}{" "}
                  policy
                </Button>
              </li>
            );
          }),
        )}
      </ul>
      {form && (
        <form
          className="space-y-4 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3 className="font-semibold">
            Review {form.source} {form.channel.toLowerCase()} delivery
          </h3>
          <fieldset disabled={busy} className="space-y-4">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) =>
                  setForm({ ...form, enabled: e.target.checked })
                }
              />
              <span>Enable this reviewed delivery policy</span>
            </label>
            {stopping && (
              <p className="text-sm">
                Saving turns this policy off and keeps its previously reviewed
                wording. Messages already accepted by a provider cannot be
                recalled.
              </p>
            )}
            <div>
              <Label htmlFor="delivery-wording">Reviewed message wording</Label>
              <select
                id="delivery-wording"
                className={selectClass}
                value={form.templateId}
                disabled={stopping || wording.isLoading || wording.isError}
                onChange={(e) =>
                  setForm({ ...form, templateId: e.target.value })
                }
              >
                <option value="">Choose reviewed wording</option>
                {wording.data
                  ?.filter(
                    (t) =>
                      t.channel.toUpperCase() === form.channel &&
                      (t.active || t.id === form.templateId),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id} disabled={!t.active}>
                      {t.name} · revision {t.version}
                      {t.active ? "" : " · retired"}
                    </option>
                  ))}
              </select>
            </div>
            {template && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="whitespace-pre-wrap text-sm">{template.body}</p>
                <p className="text-xs text-muted-foreground">
                  {form.source === "appointment"
                    ? "Appointment reminders use the time selected in the schedule. The wording offset is not applied again."
                    : `${template.days_before} days before the due date. Patient-specific due plans and consent are rechecked before delivery.`}
                </p>
              </div>
            )}
            {form.channel === "EMAIL" && (
              <div>
                <Label htmlFor="delivery-subject">Reminder email subject</Label>
                <Input
                  id="delivery-subject"
                  value={form.subject}
                  disabled={stopping}
                  maxLength={500}
                  required={!stopping}
                  onChange={(e) =>
                    setForm({ ...form, subject: e.target.value })
                  }
                />
              </div>
            )}
            <div>
              <Label htmlFor="delivery-review">Policy review reason</Label>
              <Textarea
                id="delivery-review"
                value={form.review}
                maxLength={2000}
                required
                onChange={(e) => setForm({ ...form, review: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save reviewed delivery policy</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void reload()}
              >
                Reload saved delivery policy
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
