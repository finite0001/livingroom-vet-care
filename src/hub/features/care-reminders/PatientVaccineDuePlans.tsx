import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  careDb,
  selectClass,
  messageError,
  type VaccineDuePlan,
  type VaccineDueTemplate,
  type SaveVaccinePlanArgs,
} from "./model";
import { addCareDays, denverCalendarDay } from "./date-tools";
interface PatientVaccineDuePlansProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
export function PatientVaccineDuePlans({
  petId,
  onDirtyChange,
}: PatientVaccineDuePlansProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [record, setRecord] = useState<VaccineDuePlan | null>(null);
  const [form, setForm] = useState<SaveVaccinePlanArgs | null>(null);
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
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const plans = useQuery({
    queryKey: ["vaccine-due-plans", petId],
    queryFn: async () => {
      const { data, error } = await careDb
        .from("patient_vaccine_due_plans")
        .select("*")
        .eq("pet_id", petId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
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
  const treatments = useQuery({
    queryKey: ["care-vaccine-administrations", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_treatments")
        .select("id,product_id,product_name,administered_at,source,historical")
        .eq("pet_id", petId)
        .eq("kind", "vaccine")
        .order("administered_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const corrections = useQuery({
    queryKey: ["care-administration-corrections", petId],
    enabled: Boolean(treatments.data?.length),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_treatment_corrections")
        .select("treatment_id")
        .in(
          "treatment_id",
          treatments.data!.map((t) => t.id),
        );
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["vaccine-due-history", record?.id],
    enabled: Boolean(record),
    queryFn: async () => {
      const { data, error } = await careDb
        .from("care_plan_revisions")
        .select("*")
        .eq("entity", "vaccine_plan")
        .eq("entity_id", record!.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  function adopt(row: VaccineDuePlan | null) {
    const next: SaveVaccinePlanArgs = row
      ? {
          p_id: row.id,
          p_pet_id: petId,
          p_expected_version: row.version,
          p_template_id: row.template_id,
          p_template_version: row.template_version,
          p_product_id: row.product_id,
          p_treatment_id: row.treatment_id,
          p_last_administered_on: row.last_administered_on,
          p_anchor_source: row.anchor_source,
          p_interval_days: row.interval_days,
          p_current_due_on: row.current_due_on,
          p_status: row.status,
          p_reminders_enabled: row.reminders_enabled,
          p_override_reason: row.override_reason,
          p_review_note: row.review_note,
        }
      : {
          p_id: crypto.randomUUID(),
          p_pet_id: petId,
          p_expected_version: null,
          p_template_id: "",
          p_template_version: 0,
          p_product_id: "",
          p_treatment_id: null,
          p_last_administered_on: "",
          p_anchor_source: "",
          p_interval_days: 0,
          p_current_due_on: "",
          p_status: "proposed",
          p_reminders_enabled: false,
          p_override_reason: "",
          p_review_note: "",
        };
    setRecord(row);
    setForm(next);
    setBaseline(JSON.stringify(next));
  }
  function open(row: VaccineDuePlan | null) {
    if (
      lock.current ||
      (dirty && !window.confirm("Discard unsaved vaccine due changes?"))
    )
      return;
    adopt(row);
    setError("");
    setMessage("");
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!session?.user.id) throw new Error("Sign in before saving");
      await action();
    } catch (e) {
      setError(
        `${messageError(e)}. Your plan draft is retained. Retry unchanged after a network error; reload to resolve a version conflict.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function change(key: keyof SaveVaccinePlanArgs, value: unknown) {
    setForm((old) => old && { ...old, [key]: value });
  }
  const selected =
    form &&
    (record &&
    record.template_id === form.p_template_id &&
    record.template_version === form.p_template_version
      ? (record.template_snapshot as unknown as VaccineDueTemplate)
      : templates.data?.find((t) => t.id === form.p_template_id));
  const retired = record?.status === "retired";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vaccine due plans</CardTitle>
        <p className="text-sm text-muted-foreground">
          Reviewed plans are separate from administration history. One current
          or proposed plan is allowed per patient and practice-defined vaccine
          group. Reminder eligibility does not itself send a message; delivery
          is tracked in Care reminders.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {[plans, templates, products, treatments, corrections].some(
          (q) => q.isError,
        ) && (
          <p role="alert">
            Some vaccine planning data could not load.{" "}
            <Button
              onClick={() =>
                void Promise.all([
                  plans.refetch(),
                  templates.refetch(),
                  products.refetch(),
                  treatments.refetch(),
                  ...(treatments.data?.length ? [corrections.refetch()] : []),
                ])
              }
            >
              Retry vaccine planning data
            </Button>
          </p>
        )}
        <Button disabled={busy} onClick={() => open(null)}>
          New vaccine due plan
        </Button>
        <ul className="space-y-2">
          {plans.data?.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap justify-between gap-2 rounded-md border p-3"
            >
              <div>
                <p className="font-medium">
                  {row.group_key} · {row.status}
                </p>
                <p className="text-sm">
                  Last administration anchor: {row.last_administered_on} ·{" "}
                  {row.treatment_id
                    ? "linked administration"
                    : "historical source"}
                </p>
                <p className="text-sm">
                  {row.status === "current"
                    ? "Current next due"
                    : row.status === "retired"
                      ? "Retired due date"
                      : "Proposed patient due"}
                  : {row.current_due_on} · Reminders{" "}
                  {row.reminders_enabled ? "enabled" : "disabled"}
                </p>
              </div>
              <Button variant="outline" onClick={() => open(row)}>
                Open vaccine due plan
              </Button>
            </li>
          ))}
        </ul>
        {form && (
          <fieldset
            disabled={busy || retired}
            className="space-y-4 rounded-md border p-4"
          >
            <legend>
              {record
                ? `Saved plan version ${record.version}`
                : "Proposed vaccine plan"}
            </legend>
            <Label htmlFor="vaccine-group">
              Reviewed vaccine group template
            </Label>
            <select
              id="vaccine-group"
              className={selectClass}
              value={form.p_template_id}
              onChange={(e) => {
                const t = templates.data?.find((t) => t.id === e.target.value);
                setForm({
                  ...form,
                  p_template_id: t?.id || "",
                  p_template_version: t?.version || 0,
                  p_interval_days: t?.interval_days || 0,
                  p_product_id: "",
                  p_treatment_id: null,
                  p_last_administered_on: "",
                  p_current_due_on: "",
                  p_anchor_source: "",
                  p_override_reason: "",
                });
              }}
            >
              <option value="">Select reviewed settings</option>
              {templates.data
                ?.filter(
                  (t) =>
                    (t.active || t.id === form.p_template_id) &&
                    (!record || record.group_key === t.group_key),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.group_key}
                  </option>
                ))}
            </select>
            {selected && (
              <p className="text-sm">
                Using reviewed template version {form.p_template_version} ·
                Standard interval {selected.interval_days} days. Existing plans
                retain their reviewed snapshot.
              </p>
            )}
            {record &&
              templates.data?.some(
                (t) =>
                  t.id === record.template_id &&
                  t.active &&
                  t.version !== form.p_template_version,
              ) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const latest = templates.data!.find(
                      (t) => t.id === record.template_id,
                    )!;
                    setForm({
                      ...form,
                      p_template_version: latest.version,
                      p_interval_days: latest.interval_days,
                      p_current_due_on: "",
                      p_product_id: latest.product_ids.includes(
                        form.p_product_id,
                      )
                        ? form.p_product_id
                        : "",
                      p_treatment_id: latest.product_ids.includes(
                        form.p_product_id,
                      )
                        ? form.p_treatment_id
                        : null,
                      p_review_note: "",
                    });
                  }}
                >
                  Review latest group settings
                </Button>
              )}
            <Label htmlFor="vaccine-product">
              Explicitly mapped vaccine product
            </Label>
            <select
              id="vaccine-product"
              className={selectClass}
              value={form.p_product_id}
              onChange={(e) => {
                change("p_product_id", e.target.value);
                change("p_treatment_id", null);
              }}
            >
              <option value="">Select an explicitly mapped product</option>
              {products.data
                ?.filter((p) => selected?.product_ids.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <Label htmlFor="vaccine-anchor">Administration anchor</Label>
            <select
              id="vaccine-anchor"
              className={selectClass}
              value={form.p_treatment_id || ""}
              disabled={corrections.isError}
              onChange={(e) => {
                const t = treatments.data?.find((t) => t.id === e.target.value);
                setForm({
                  ...form,
                  p_treatment_id: t?.id || null,
                  p_last_administered_on: t
                    ? denverCalendarDay(t.administered_at)
                    : "",
                  p_anchor_source: t
                    ? `Linked administration: ${t.product_name}${t.source ? ` · ${t.source}` : ""}`
                    : "",
                  p_current_due_on: "",
                });
              }}
            >
              <option value="">
                Historical anchor with recorded provenance
              </option>
              {treatments.data
                ?.filter(
                  (t) =>
                    t.product_id === form.p_product_id &&
                    !corrections.data?.some((c) => c.treatment_id === t.id),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {denverCalendarDay(t.administered_at)} · {t.product_name}
                    {t.historical ? " · historical record" : ""}
                  </option>
                ))}
            </select>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="vaccine-last">
                  Last administered date (Denver)
                </Label>
                <Input
                  id="vaccine-last"
                  type="date"
                  readOnly={Boolean(form.p_treatment_id)}
                  value={form.p_last_administered_on}
                  onChange={(e) =>
                    change("p_last_administered_on", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="vaccine-interval">
                  Patient interval in days
                </Label>
                <Input
                  id="vaccine-interval"
                  type="number"
                  min={1}
                  max={36500}
                  step={1}
                  value={form.p_interval_days || ""}
                  onChange={(e) =>
                    change("p_interval_days", Number(e.target.value))
                  }
                />
              </div>
            </div>
            <Label htmlFor="vaccine-provenance">
              Anchor provenance / source
            </Label>
            <Textarea
              id="vaccine-provenance"
              value={form.p_anchor_source}
              maxLength={2000}
              onChange={(e) => change("p_anchor_source", e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => {
                try {
                  change(
                    "p_current_due_on",
                    addCareDays(
                      form.p_last_administered_on,
                      form.p_interval_days,
                    ),
                  );
                  setError("");
                } catch (e) {
                  setError(messageError(e));
                }
              }}
            >
              Calculate proposed patient due date
            </Button>
            <Label htmlFor="vaccine-due">Reviewed patient next due date</Label>
            <Input
              id="vaccine-due"
              type="date"
              value={form.p_current_due_on}
              onChange={(e) => change("p_current_due_on", e.target.value)}
            />
            {record && (
              <p className="text-sm">
                Saved standard-template proposal: {record.proposed_due_on}. This
                is distinct from the reviewed patient due date.
              </p>
            )}
            <Label htmlFor="vaccine-override">
              Patient interval / due override reason
            </Label>
            <Textarea
              id="vaccine-override"
              value={form.p_override_reason}
              maxLength={2000}
              onChange={(e) => change("p_override_reason", e.target.value)}
            />
            <Label htmlFor="vaccine-status">Plan status</Label>
            <select
              id="vaccine-status"
              className={selectClass}
              value={form.p_status}
              onChange={(e) => change("p_status", e.target.value)}
            >
              <option value="proposed">
                Proposed — not a current due plan
              </option>
              <option value="current">Reviewed current due plan</option>
              <option value="retired">Retired — no future jobs</option>
            </select>
            <Label
              className="flex items-center gap-2"
              htmlFor="vaccine-reminders"
            >
              <input
                id="vaccine-reminders"
                type="checkbox"
                checked={form.p_reminders_enabled}
                onChange={(e) =>
                  change("p_reminders_enabled", e.target.checked)
                }
              />{" "}
              Enable reminder eligibility for this plan
            </Label>
            <Label htmlFor="vaccine-review">
              Plan review / correction rationale
            </Label>
            <Textarea
              id="vaccine-review"
              value={form.p_review_note}
              maxLength={2000}
              onChange={(e) => change("p_review_note", e.target.value)}
            />
            <Button
              disabled={
                !form.p_template_id ||
                !form.p_product_id ||
                !form.p_review_note.trim()
              }
              onClick={() =>
                void run(async () => {
                  const { data, error } = await careDb.rpc(
                    "save_patient_vaccine_due_plan",
                    form,
                  );
                  if (error) throw error;
                  adopt(data);
                  setMessage("Reviewed vaccine due plan saved.");
                  await Promise.all([
                    cache.invalidateQueries({
                      queryKey: ["vaccine-due-plans", petId],
                    }),
                    cache.invalidateQueries({
                      queryKey: ["vaccine-due-history", data.id],
                    }),
                  ]);
                })
              }
            >
              Save vaccine due plan
            </Button>
          </fieldset>
        )}
        {record && (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "Discard local edits and reload the saved vaccine plan?",
                  )
                )
                  return;
                void run(async () => {
                  const { data, error } = await careDb
                    .from("patient_vaccine_due_plans")
                    .select("*")
                    .eq("id", record.id)
                    .eq("pet_id", petId)
                    .single();
                  if (error) throw error;
                  adopt(data);
                });
              }}
            >
              Reload vaccine due plan
            </Button>
            <details>
              <summary className="cursor-pointer">
                Vaccine due plan history
              </summary>
              {history.isError && (
                <p role="alert">
                  History could not load.{" "}
                  <Button onClick={() => void history.refetch()}>
                    Retry vaccine plan history
                  </Button>
                </p>
              )}
              {history.data?.map((h) => {
                const snapshot = h.snapshot as unknown as VaccineDuePlan;
                return (
                  <div
                    key={h.id}
                    className="my-2 rounded-md border p-3 text-sm"
                  >
                    <p>
                      Version {h.version} · {snapshot.status} · Staff{" "}
                      {h.actor_id}
                    </p>
                    <p>
                      Last administration anchor {snapshot.last_administered_on}{" "}
                      · Standard proposal {snapshot.proposed_due_on} · Patient
                      due {snapshot.current_due_on}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {snapshot.anchor_source}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {snapshot.override_reason}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {snapshot.review_note}
                    </p>
                  </div>
                );
              })}
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
