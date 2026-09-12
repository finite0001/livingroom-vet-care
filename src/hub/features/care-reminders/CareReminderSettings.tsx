import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  careDb,
  selectClass,
  messageError,
  type VaccineDueTemplate,
  type CareMessageTemplate,
} from "./model";
interface SettingsForm {
  id: string;
  version: number | null;
  kind: "vaccine" | "message";
  name: string;
  group: string;
  products: string[];
  interval: string;
  channel: string;
  offset: string;
  body: string;
  active: boolean;
  review: string;
}
interface CareReminderSettingsProps {
  onDirtyChange?: (dirty: boolean) => void;
}
export function CareReminderSettings({
  onDirtyChange,
}: CareReminderSettingsProps) {
  const { session, hasRole } = useAuth();
  const cache = useQueryClient();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = Boolean(form && JSON.stringify(form) !== baseline) || busy;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const templates = useQuery({
    queryKey: ["vaccine-due-templates"],
    queryFn: async () => {
      const { data, error } = await careDb
        .from("vaccine_due_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const messages = useQuery({
    queryKey: ["care-message-templates"],
    queryFn: async () => {
      const { data, error } = await careDb
        .from("care_message_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const products = useQuery({
    queryKey: ["care-vaccine-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_products")
        .select("id,name")
        .eq("kind", "vaccine")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  function open(
    kind: "vaccine" | "message",
    row?: VaccineDueTemplate | CareMessageTemplate,
  ) {
    if (
      lock.current ||
      (dirty && !window.confirm("Discard unsaved reminder settings?"))
    )
      return;
    const v = row && "group_key" in row ? row : null;
    const m = row && "channel" in row ? row : null;
    const next: SettingsForm = {
      id: row?.id || crypto.randomUUID(),
      version: row?.version ?? null,
      kind,
      name: row?.name || "",
      group: v?.group_key || "",
      products: v?.product_ids || [],
      interval: v ? String(v.interval_days) : "",
      channel: m?.channel || "email",
      offset: m ? String(m.days_before) : "",
      body: m?.body || "",
      active: row?.active ?? true,
      review: "",
    };
    setForm(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setMessage("");
  }
  async function save() {
    if (!form || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!session?.user.id || !hasRole("ADMIN"))
        throw new Error("Active administrator required");
      if (form.kind === "vaccine") {
        const { error } = await careDb.rpc("save_vaccine_due_template", {
          p_id: form.id,
          p_expected_version: form.version,
          p_group_key: form.group,
          p_name: form.name,
          p_product_ids: form.products,
          p_interval_days: Number(form.interval),
          p_active: form.active,
          p_review_note: form.review,
        });
        if (error) throw error;
      } else {
        if (!form.offset.trim())
          throw new Error(
            "Enter a reviewed scheduling offset, including zero for the due date",
          );
        const { error } = await careDb.rpc("save_care_message_template", {
          p_id: form.id,
          p_expected_version: form.version,
          p_name: form.name,
          p_channel: form.channel,
          p_days_before: Number(form.offset),
          p_body: form.body,
          p_active: form.active,
          p_review_note: form.review,
        });
        if (error) throw error;
      }
      setForm(null);
      setBaseline("");
      setMessage("Reviewed care settings saved.");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["vaccine-due-templates"] }),
        cache.invalidateQueries({ queryKey: ["care-message-templates"] }),
        cache.invalidateQueries({ queryKey: ["care-reminder-jobs"] }),
      ]);
    } catch (e) {
      setError(
        `${messageError(e)}. Draft retained. Retry unchanged after a network error; reopen the latest version to resolve a conflict.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!hasRole("ADMIN"))
    return (
      <p className="text-sm text-muted-foreground">
        An administrator maintains clinician-reviewed vaccine groups and
        reminder wording.
      </p>
    );
  return (
    <section
      aria-label="Reviewed care reminder settings"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-lg font-semibold">Reviewed practice settings</h2>
      <p className="text-sm text-muted-foreground">
        No clinical intervals or product equivalences are supplied. Define
        canonical group keys and explicitly map exact vaccine products after
        clinical review. A group key cannot be renamed. Existing patient plans
        keep their reviewed template snapshot.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {(templates.isError || messages.isError || products.isError) && (
        <p role="alert">
          Settings could not load.{" "}
          <Button
            onClick={() =>
              void Promise.all([
                templates.refetch(),
                messages.refetch(),
                products.refetch(),
              ])
            }
          >
            Retry care settings
          </Button>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => open("vaccine")}>
          New reviewed vaccine group
        </Button>
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => open("message")}
        >
          New reviewed reminder wording
        </Button>
      </div>
      <ul className="space-y-2">
        {templates.data?.map((t) => (
          <li key={t.id}>
            {t.name} · {t.group_key} · {t.interval_days} days · v{t.version} ·{" "}
            {t.active ? "active" : "retired"}{" "}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => open("vaccine", t)}
            >
              Review vaccine settings {t.name}
            </Button>
          </li>
        ))}
        {messages.data?.map((t) => (
          <li key={t.id}>
            {t.name} · {t.channel} · {t.days_before} days before due · v
            {t.version} · {t.active ? "active" : "retired"}{" "}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => open("message", t)}
            >
              Review reminder wording {t.name}
            </Button>
          </li>
        ))}
      </ul>
      {form && (
        <fieldset disabled={busy} className="space-y-3 rounded-md border p-4">
          <legend>
            {form.kind === "vaccine"
              ? "Vaccine group review"
              : "Reminder wording review"}
            {form.version ? ` · version ${form.version}` : ""}
          </legend>
          <Label htmlFor="care-setting-name">Reviewed setting name</Label>
          <Input
            id="care-setting-name"
            value={form.name}
            maxLength={160}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {form.kind === "vaccine" ? (
            <>
              <Label htmlFor="care-group-key">
                Canonical vaccine group key
              </Label>
              <Input
                id="care-group-key"
                readOnly={form.version !== null}
                value={form.group}
                placeholder="Practice-defined key"
                onChange={(e) => setForm({ ...form, group: e.target.value })}
              />
              <p className="text-sm">
                Map every supported exact catalog product deliberately. Similar
                names or brands are not treated as equivalent.
              </p>
              <div className="space-y-2">
                {products.data?.map((p) => (
                  <Label key={p.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.products.includes(p.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          products: e.target.checked
                            ? [...form.products, p.id]
                            : form.products.filter((id) => id !== p.id),
                        })
                      }
                    />
                    {p.name}
                  </Label>
                ))}
              </div>
              <Label htmlFor="care-standard-days">
                Clinician-reviewed standard interval (days)
              </Label>
              <Input
                id="care-standard-days"
                type="number"
                min={1}
                max={36500}
                step={1}
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value })}
              />
            </>
          ) : (
            <>
              <Label htmlFor="care-channel">Reminder channel</Label>
              <select
                id="care-channel"
                className={selectClass}
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <Label htmlFor="care-offset">Reviewed days before due date</Label>
              <Input
                id="care-offset"
                type="number"
                min={0}
                max={3650}
                step={1}
                value={form.offset}
                onChange={(e) => setForm({ ...form, offset: e.target.value })}
              />
              <Label htmlFor="care-body">
                Approved plain-text reminder wording
              </Label>
              <Textarea
                id="care-body"
                maxLength={4000}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Supported placeholders: {"{{patient_name}}"}, {"{{care_name}}"},{" "}
                {"{{due_date}}"}. Templates are plain text; approval does not
                enable sending.
              </p>
            </>
          )}
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />{" "}
            Active setting
          </Label>
          <Label htmlFor="care-review">
            Clinical reviewer / approval rationale
          </Label>
          <Textarea
            id="care-review"
            maxLength={2000}
            value={form.review}
            onChange={(e) => setForm({ ...form, review: e.target.value })}
          />
          <Button
            disabled={!form.name.trim() || !form.review.trim()}
            onClick={() => void save()}
          >
            Save reviewed care settings
          </Button>
        </fieldset>
      )}
    </section>
  );
}
