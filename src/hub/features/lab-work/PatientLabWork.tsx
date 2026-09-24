import { refreshPatientReleases } from "../record-releases/refresh";
import { useEffect, useRef, useState } from "react";
import { PatientLabResults } from "./PatientLabResults";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  emptyLab,
  labValues,
  dueFromInterval,
  type LabDatabase,
  type LabOrder,
  type LabValues,
  type LabTemplate,
} from "./model";
const db = supabase as unknown as SupabaseClient<LabDatabase>;
interface PatientLabWorkProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function PatientLabWork({ petId, onDirtyChange }: PatientLabWorkProps) {
  const { session, hasRole } = useAuth();
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [record, setRecord] = useState<LabOrder | null>(null);
  const [form, setForm] = useState<LabValues | null>(null);
  const [baseline, setBaseline] = useState("");
  const [requestId, setRequestId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [templateRecord, setTemplateRecord] = useState<LabTemplate | null>(
    null,
  );
  const [templateActive, setTemplateActive] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [templateDays, setTemplateDays] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const templateId = useRef<string>(crypto.randomUUID());
  const [resultDirty, setResultDirty] = useState(false);
  const nativeDirty =
    Boolean(form && JSON.stringify(form) !== baseline) ||
    Boolean(reason.trim() || templateName || templateDays || reviewNote) ||
    busy;
  const dirty = nativeDirty || resultDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const orders = useQuery({
    queryKey: ["lab-orders", petId, page],
    queryFn: async () => {
      const { data, error } = await db
        .from("patient_lab_orders")
        .select("*")
        .eq("pet_id", petId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 20);
      if (error) throw error;
      return data;
    },
  });
  const templates = useQuery({
    queryKey: ["lab-templates"],
    queryFn: async () => {
      const { data, error } = await db
        .from("lab_due_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const documents = useQuery({
    queryKey: ["lab-documents", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_documents")
        .select("id,file_name")
        .eq("pet_id", petId)
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["lab-history", record?.id],
    enabled: Boolean(record),
    queryFn: async () => {
      const { data, error } = await db
        .from("lab_work_revisions")
        .select("*")
        .eq("entity", "order")
        .eq("entity_id", record!.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  function open(row: LabOrder | null) {
    if (
      busyRef.current ||
      resultDirty ||
      (dirty && !window.confirm("Discard unsaved lab work changes?"))
    )
      return;
    const values = row ? labValues(row) : emptyLab();
    setRecord(row);
    setForm(values);
    setBaseline(JSON.stringify(values));
    setRequestId(row?.id || crypto.randomUUID());
    setReason("");
    setError("");
    setMessage("");
  }
  function update(key: keyof LabValues, value: string | number | null) {
    setForm((previous) => previous && { ...previous, [key]: value });
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current || resultDirty) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!session?.user.id) throw new Error("Sign in before saving.");
      await action();
    } catch (caught) {
      setError(
        `${caught instanceof Error ? caught.message : typeof caught === "object" && caught && "message" in caught ? String(caught.message) : "Save failed."} Your draft is retained. Retry unchanged after a network error; reload before resolving a version conflict.`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (!form) return;
    await run(async () => {
      const { data, error } = await db.rpc("save_patient_lab_order", {
        p_id: requestId,
        p_pet_id: petId,
        p_expected_version: record?.version ?? null,
        p_values: form as unknown as Json,
        p_correction_reason: reason,
      });
      if (error) throw error;
      setRecord(data);
      setForm(labValues(data));
      setBaseline(JSON.stringify(labValues(data)));
      setReason("");
      setMessage("Lab work saved.");
      await Promise.all([
        refreshPatientReleases(cache, petId),
        cache.invalidateQueries({ queryKey: ["lab-orders", petId] }),
        cache.invalidateQueries({ queryKey: ["lab-history", data.id] }),
      ]);
    });
  }
  async function reload() {
    if (
      !record ||
      busy ||
      (dirty &&
        !window.confirm("Discard local lab edits and reload saved record?"))
    )
      return;
    await run(async () => {
      const { data, error } = await db
        .from("patient_lab_orders")
        .select("*")
        .eq("id", record.id)
        .eq("pet_id", petId)
        .single();
      if (error) throw error;
      setRecord(data);
      setForm(labValues(data));
      setBaseline(JSON.stringify(labValues(data)));
      setReason("");
    });
  }
  const historical =
    record &&
    (record.status === "resulted" ||
      record.status === "cancelled" ||
      record.result_date ||
      record.result_document_id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab work</CardTitle>
        <p className="text-sm text-muted-foreground">
          Antech selected · connection not configured. Orders and results below
          are recorded manually. No orders, reminders or interpretations are
          sent automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {orders.isLoading && <p role="status">Loading lab work…</p>}
        {orders.isError && (
          <p role="alert">
            Lab orders could not load.{" "}
            <Button variant="outline" onClick={() => void orders.refetch()}>
              Retry lab orders
            </Button>
          </p>
        )}
        <Button disabled={busy || resultDirty} onClick={() => open(null)}>
          New lab order
        </Button>
        <ul className="space-y-2">
          {orders.data?.slice(0, 20).map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{row.test_name}</p>
                <p className="text-sm">
                  {row.status} · Due {row.due_date || "not set"} · Result{" "}
                  {row.result_date || "not recorded"}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy || resultDirty}
                onClick={() => open(row)}
              >
                Open lab order
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={dirty || page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous lab orders
          </Button>
          <Button
            variant="outline"
            disabled={dirty || (orders.data?.length ?? 0) <= 20}
            onClick={() => setPage(page + 1)}
          >
            Next lab orders
          </Button>
        </div>
        {form && (
          <fieldset
            disabled={busy || resultDirty}
            className="space-y-4 rounded-md border p-4"
          >
            <legend className="px-1 font-medium">
              {record ? "Edit saved lab work" : "New lab work"}
              {record ? ` · version ${record.version}` : ""}
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="lab-test">Test name</Label>
                <Input
                  id="lab-test"
                  value={form.test_name}
                  maxLength={160}
                  onChange={(e) => update("test_name", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lab-status">Lab status</Label>
                <select
                  id="lab-status"
                  className={selectClass}
                  value={form.status}
                  onChange={(e) => update("status", e.target.value)}
                >
                  {[
                    "planned",
                    "ordered",
                    "collected",
                    "resulted",
                    "cancelled",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>
            {templates.isError && (
              <p role="alert">
                Standard intervals could not load.{" "}
                <Button onClick={() => void templates.refetch()}>
                  Retry intervals
                </Button>
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="lab-template">
                  Reviewed interval template (optional)
                </Label>
                <select
                  id="lab-template"
                  className={selectClass}
                  value={form.template_id || ""}
                  onChange={(e) => {
                    const t = templates.data?.find(
                      (row) => row.id === e.target.value,
                    );
                    setForm({
                      ...form,
                      template_id: t?.id ?? null,
                      template_version: t?.version ?? null,
                      interval_days: t?.interval_days ?? null,
                      interval_anchor: null,
                      due_date: null,
                      override_reason: "",
                    });
                  }}
                >
                  <option value="">Patient-specific date</option>
                  {templates.data
                    ?.filter((t) => t.active || t.id === form.template_id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.interval_days} days · v{t.version}
                        {!t.active ? " (retired)" : ""}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <Label htmlFor="lab-due">Lab due date</Label>
                <Input
                  id="lab-due"
                  type="date"
                  value={form.due_date || ""}
                  onChange={(e) => update("due_date", e.target.value || null)}
                />
              </div>
            </div>
            {form.template_id && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm">
                  Recorded template version {form.template_version}. Review the
                  interval and anchor for this patient, then calculate the due
                  date. Standard settings never update existing orders.
                </p>
                <Label htmlFor="lab-interval">Patient interval in days</Label>
                <Input
                  id="lab-interval"
                  type="number"
                  min={1}
                  max={36500}
                  step={1}
                  value={form.interval_days ?? ""}
                  onChange={(e) =>
                    update(
                      "interval_days",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                />
                <Label htmlFor="lab-anchor">Interval anchor date</Label>
                <Input
                  id="lab-anchor"
                  type="date"
                  value={form.interval_anchor || ""}
                  onChange={(e) =>
                    update("interval_anchor", e.target.value || null)
                  }
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    try {
                      update(
                        "due_date",
                        dueFromInterval(
                          form.interval_anchor || "",
                          form.interval_days ?? 0,
                        ),
                      );
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Calculate reviewed due date
                </Button>
                <Label htmlFor="lab-override">
                  Patient interval override reason
                </Label>
                <Input
                  id="lab-override"
                  value={form.override_reason}
                  onChange={(e) => update("override_reason", e.target.value)}
                />
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {(["collected_date", "result_date"] as const).map((key) => (
                <div key={key}>
                  <Label htmlFor={`lab-${key}`}>
                    {key === "collected_date"
                      ? "Collection date"
                      : "Result date"}
                  </Label>
                  <Input
                    id={`lab-${key}`}
                    type="date"
                    value={form[key] || ""}
                    onChange={(e) => update(key, e.target.value || null)}
                  />
                </div>
              ))}
            </div>
            <Label htmlFor="lab-accession">External accession (optional)</Label>
            <Input
              id="lab-accession"
              value={form.accession}
              maxLength={200}
              onChange={(e) => update("accession", e.target.value)}
            />
            {documents.isError && (
              <p role="alert">
                Patient documents could not load.{" "}
                <Button onClick={() => void documents.refetch()}>
                  Retry lab documents
                </Button>
              </p>
            )}
            <Label htmlFor="lab-document">
              Ready private result document (optional)
            </Label>
            <select
              id="lab-document"
              className={selectClass}
              value={form.result_document_id || ""}
              onChange={(e) =>
                update("result_document_id", e.target.value || null)
              }
            >
              <option value="">No document linked</option>
              {form.result_document_id &&
                !documents.data?.some(
                  (d) => d.id === form.result_document_id,
                ) && (
                  <option value={form.result_document_id}>
                    Previously linked document unavailable / void
                  </option>
                )}
              {documents.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Upload and privately download files in Patient documents. Linking
              does not share or send the file.
            </p>
            <Label htmlFor="lab-notes">Lab observations / notes</Label>
            <Textarea
              id="lab-notes"
              value={form.notes}
              maxLength={20000}
              onChange={(e) => update("notes", e.target.value)}
            />
            {historical && (
              <>
                <p className="text-sm">
                  This order has historical results or is cancelled. Changes
                  require a correction reason; all prior versions remain
                  available.
                </p>
                <Label htmlFor="lab-correction">Lab correction reason</Label>
                <Textarea
                  id="lab-correction"
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  !form.test_name.trim() ||
                  Boolean(historical && !reason.trim())
                }
                onClick={() => void save()}
              >
                Save lab work
              </Button>
              {record && (
                <Button variant="outline" onClick={() => void reload()}>
                  Reload saved lab work
                </Button>
              )}
            </div>
          </fieldset>
        )}
        {record && (
          <PatientLabResults
            order={record}
            disabled={nativeDirty}
            onDirtyChange={setResultDirty}
          />
        )}
        {record && (
          <details>
            <summary className="cursor-pointer">Lab version history</summary>
            {history.isError && (
              <p role="alert">
                History could not load.{" "}
                <Button onClick={() => void history.refetch()}>
                  Retry lab history
                </Button>
              </p>
            )}
            {history.data?.map((revision) => (
              <div key={revision.id} className="my-2 rounded-md border p-3">
                <p>
                  Version {revision.version} · {dateTime(revision.recorded_at)}{" "}
                  Denver · Staff {revision.actor_id}
                </p>
                <p>{revision.reason || "Recorded update"}</p>
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(revision.snapshot, null, 2)}
                </pre>
              </div>
            ))}
          </details>
        )}
        {hasRole("ADMIN") && (
          <details>
            <summary className="cursor-pointer">
              Reviewed standard lab intervals
            </summary>
            <p className="my-2 text-sm">
              No default intervals are supplied. An administrator records
              clinician-reviewed settings here; staff explicitly select them per
              order. Existing orders retain their interval and version.
            </p>
            <ul>
              {templates.data?.map((t) => (
                <li key={t.id}>
                  {t.name} · {t.interval_days} days · v{t.version} ·{" "}
                  {t.active ? "active" : "retired"}{" "}
                  <Button
                    variant="outline"
                    disabled={busy || resultDirty}
                    onClick={() => {
                      if (
                        (templateName || templateDays || reviewNote) &&
                        !window.confirm("Discard unsaved standard settings?")
                      )
                        return;
                      setTemplateRecord(t);
                      templateId.current = t.id;
                      setTemplateName(t.name);
                      setTemplateDays(String(t.interval_days));
                      setTemplateActive(t.active);
                      setReviewNote("");
                    }}
                  >
                    Review standard {t.name}
                  </Button>
                </li>
              ))}
            </ul>
            <fieldset disabled={busy || resultDirty} className="space-y-2">
              <p>
                {templateRecord
                  ? `Reviewing standard version ${templateRecord.version}`
                  : "New reviewed standard"}
              </p>
              <Label htmlFor="lab-template-active">
                <input
                  id="lab-template-active"
                  type="checkbox"
                  checked={templateActive}
                  onChange={(e) => setTemplateActive(e.target.checked)}
                />{" "}
                Active standard interval
              </Label>
              <Label htmlFor="lab-template-name">Standard interval name</Label>
              <Input
                id="lab-template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <Label htmlFor="lab-template-days">Reviewed standard days</Label>
              <Input
                id="lab-template-days"
                type="number"
                min={1}
                step={1}
                max={36500}
                value={templateDays}
                onChange={(e) => setTemplateDays(e.target.value)}
              />
              <Label htmlFor="lab-template-review">
                Clinical reviewer and rationale
              </Label>
              <Textarea
                id="lab-template-review"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
              <Button
                disabled={
                  !templateName.trim() || !reviewNote.trim() || !templateDays
                }
                onClick={() =>
                  void run(async () => {
                    const { error } = await db.rpc("save_lab_due_template", {
                      p_id: templateId.current,
                      p_expected_version: templateRecord?.version ?? null,
                      p_name: templateName,
                      p_interval_days: Number(templateDays),
                      p_active: templateActive,
                      p_review_note: reviewNote,
                    });
                    if (error) throw error;
                    templateId.current = crypto.randomUUID();
                    setTemplateRecord(null);
                    setTemplateActive(true);
                    setTemplateName("");
                    setTemplateDays("");
                    setReviewNote("");
                    setMessage("Reviewed standard interval saved.");
                    await cache.invalidateQueries({
                      queryKey: ["lab-templates"],
                    });
                  })
                }
              >
                Save reviewed standard interval
              </Button>
            </fieldset>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
