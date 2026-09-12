import { AnesthesiaHistorySnapshot } from "./AnesthesiaHistorySnapshot";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  anesthesiaDraft,
  anesthesiaValues,
  emptyAnesthesia,
  type AnesthesiaDatabase,
  type AnesthesiaDraft,
  type AnesthesiaRecord,
} from "./model";
const db = supabase as unknown as SupabaseClient<AnesthesiaDatabase>;
interface PatientAnesthesiaRecordsProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function PatientAnesthesiaRecords({
  petId,
  onDirtyChange,
}: PatientAnesthesiaRecordsProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [record, setRecord] = useState<AnesthesiaRecord | null>(null);
  const [form, setForm] = useState<AnesthesiaDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmSign, setConfirmSign] = useState(false);
  const [addendum, setAddendum] = useState("");
  const addendumId = useRef<string>(crypto.randomUUID());
  const draftDirty = Boolean(form && JSON.stringify(form) !== baseline);
  const dirty = draftDirty || Boolean(addendum.trim()) || busy;
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
  const records = useQuery({
    queryKey: ["anesthesia", petId, page],
    queryFn: async () => {
      const { data, error } = await db
        .from("patient_anesthesia_records")
        .select("*")
        .eq("pet_id", petId)
        .order("started_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 20);
      if (error) throw error;
      return data;
    },
  });
  const documents = useQuery({
    queryKey: ["anesthesia-documents", petId],
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
    queryKey: ["anesthesia-history", record?.id],
    enabled: Boolean(record),
    queryFn: async () => {
      const { data, error } = await db
        .from("anesthesia_record_revisions")
        .select("*")
        .eq("record_id", record!.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const addenda = useQuery({
    queryKey: ["anesthesia-addenda", record?.id],
    enabled: Boolean(record),
    queryFn: async () => {
      const { data, error } = await db
        .from("anesthesia_record_addenda")
        .select("*")
        .eq("record_id", record!.id)
        .order("recorded_at");
      if (error) throw error;
      return data;
    },
  });
  const authors = useQuery({
    queryKey: ["anesthesia-authors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name");
      if (error) throw error;
      return data;
    },
  });
  const author = (actor: string | null) =>
    authors.data?.find((p) => p.id === actor)?.full_name ||
    (actor ? `Staff ${actor}` : "Unknown staff");
  function adopt(row: AnesthesiaRecord) {
    const draft = anesthesiaDraft(row);
    setRecord(row);
    setForm(draft);
    setBaseline(JSON.stringify(draft));
    setId(row.id);
  }
  function open(row: AnesthesiaRecord | null) {
    if (
      busyRef.current ||
      (dirty && !window.confirm("Discard unsaved anesthesia changes?"))
    )
      return;
    if (row) adopt(row);
    else {
      const draft = emptyAnesthesia();
      setRecord(null);
      setForm(draft);
      setBaseline(JSON.stringify(draft));
      setId(crypto.randomUUID());
    }
    setAddendum("");
    addendumId.current = crypto.randomUUID();
    setError("");
    setMessage("");
  }
  function change(key: keyof AnesthesiaDraft, value: unknown) {
    setForm((previous) => previous && { ...previous, [key]: value });
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!session?.user.id) throw new Error("Sign in before saving.");
      await action();
    } catch (caught) {
      const detail =
        caught && typeof caught === "object" && "message" in caught
          ? String(caught.message)
          : "Request failed";
      setError(
        `${detail}. Your draft is retained. Retry unchanged after a network failure; reload to resolve a version conflict.`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refresh(recordId: string) {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["anesthesia", petId] }),
      cache.invalidateQueries({ queryKey: ["anesthesia-history", recordId] }),
      cache.invalidateQueries({ queryKey: ["anesthesia-addenda", recordId] }),
    ]);
  }
  async function save() {
    if (!form) return;
    await run(async () => {
      const { data, error } = await db.rpc("save_patient_anesthesia_record", {
        p_id: id,
        p_pet_id: petId,
        p_expected_version: record?.version ?? null,
        p_values: anesthesiaValues(form) as unknown as Json,
      });
      if (error) throw error;
      adopt(data);
      setMessage("Anesthesia draft saved.");
      await refresh(data.id);
    });
  }
  async function reload() {
    if (
      !record ||
      busy ||
      (dirty &&
        !window.confirm(
          "Discard local anesthesia edits and reload saved record?",
        ))
    )
      return;
    await run(async () => {
      const { data, error } = await db
        .from("patient_anesthesia_records")
        .select("*")
        .eq("id", record.id)
        .eq("pet_id", petId)
        .single();
      if (error) throw error;
      adopt(data);
      setAddendum("");
    });
  }
  const signed = record?.status === "signed";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Anesthesia records</CardTitle>
        <p className="text-sm text-muted-foreground">
          Manually recorded or transcribed from an original patient file.
          Automatic vendor import is not configured. Monitoring entries do not
          calculate doses, interpret findings or create inventory charges.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {authors.isError && (
          <p role="alert">
            Author names could not load; staff IDs remain available.{" "}
            <Button onClick={() => void authors.refetch()}>
              Retry anesthesia authors
            </Button>
          </p>
        )}
        {records.isLoading && <p role="status">Loading anesthesia records…</p>}
        {records.isError && (
          <p role="alert">
            Anesthesia records could not load.{" "}
            <Button onClick={() => void records.refetch()}>
              Retry anesthesia records
            </Button>
          </p>
        )}
        <Button disabled={busy} onClick={() => open(null)}>
          New anesthesia record
        </Button>
        <ul className="space-y-2">
          {records.data?.slice(0, 20).map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{row.procedure_name}</p>
                <p className="text-sm">
                  {when(row.started_at)} Denver · {row.status} ·{" "}
                  {row.source === "manual"
                    ? "Manually recorded"
                    : "Transcribed from document"}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => open(row)}
              >
                Open anesthesia record
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            Previous anesthesia records
          </Button>
          <Button
            variant="outline"
            disabled={(records.data?.length ?? 0) <= 20}
            onClick={() => setPage(page + 1)}
          >
            Next anesthesia records
          </Button>
        </div>
        {form && (
          <div className="space-y-4 rounded-md border p-4">
            <p className="font-medium">
              {record ? `Version ${record.version}` : "New draft"}
              {signed
                ? ` · Signed by ${author(record.signed_by)} · ${when(record.signed_at!)} Denver`
                : ""}
            </p>
            <fieldset disabled={busy || signed} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="anesthesia-procedure">
                    Anesthesia procedure
                  </Label>
                  <Input
                    id="anesthesia-procedure"
                    value={form.procedure_name}
                    maxLength={200}
                    onChange={(e) => change("procedure_name", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="anesthesia-team">
                    Procedure team / roles
                  </Label>
                  <Input
                    id="anesthesia-team"
                    value={form.team}
                    maxLength={2000}
                    onChange={(e) => change("team", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {(["started_at", "ended_at"] as const).map((key) => (
                  <div key={key}>
                    <Label htmlFor={`anesthesia-${key}`}>
                      {key === "started_at"
                        ? "Procedure start (Denver)"
                        : "Procedure end (Denver)"}
                    </Label>
                    <Input
                      id={`anesthesia-${key}`}
                      type="datetime-local"
                      value={form[key] || ""}
                      onChange={(e) => change(key, e.target.value || null)}
                    />
                  </div>
                ))}
              </div>
              {(["assessment", "plan", "recovery_notes"] as const).map(
                (key) => (
                  <div key={key}>
                    <Label htmlFor={`anesthesia-${key}`}>
                      {key === "assessment"
                        ? "Preanesthetic assessment notes"
                        : key === "plan"
                          ? "Anesthesia plan notes"
                          : "Recovery observations"}
                    </Label>
                    <Textarea
                      id={`anesthesia-${key}`}
                      value={form[key]}
                      maxLength={20000}
                      onChange={(e) => change(key, e.target.value)}
                    />
                  </div>
                ),
              )}
              <div>
                <Label htmlFor="anesthesia-source">Record source</Label>
                <select
                  id="anesthesia-source"
                  className={selectClass}
                  value={form.source}
                  onChange={(e) => change("source", e.target.value)}
                >
                  <option value="manual">Manually recorded</option>
                  <option value="transcribed_from_document">
                    Manually transcribed from original document
                  </option>
                </select>
              </div>
              <Label htmlFor="anesthesia-source-detail">
                Source / transcription detail
              </Label>
              <Input
                id="anesthesia-source-detail"
                value={form.source_description}
                maxLength={2000}
                onChange={(e) => change("source_description", e.target.value)}
              />
              {documents.isError && (
                <p role="alert">
                  Original files could not load.{" "}
                  <Button onClick={() => void documents.refetch()}>
                    Retry anesthesia files
                  </Button>
                </p>
              )}
              <Label htmlFor="anesthesia-file">
                Original anesthesia file (private)
              </Label>
              <select
                id="anesthesia-file"
                className={selectClass}
                value={form.original_document_id || ""}
                onChange={(e) =>
                  change("original_document_id", e.target.value || null)
                }
              >
                <option value="">No original file linked</option>
                {form.original_document_id &&
                  !documents.data?.some(
                    (d) => d.id === form.original_document_id,
                  ) && (
                    <option value={form.original_document_id}>
                      Previously linked file unavailable / void
                    </option>
                  )}
                {documents.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.file_name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Use Patient documents to upload or privately download the
                original. Linking does not import, interpret, send or share it.
              </p>
              <div className="space-y-3">
                <h3 className="font-medium">
                  Timestamped monitoring observations
                </h3>
                <p className="text-sm text-muted-foreground">
                  Enter the observed label, value and unit explicitly. No normal
                  values or monitoring schedule are prefilled. Times must fall
                  within the procedure.
                </p>
                {form.observations.map((o, index) => (
                  <fieldset
                    key={index}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <legend>Observation {index + 1}</legend>
                    {(["at", "label", "value", "unit", "notes"] as const).map(
                      (key) => (
                        <div key={key}>
                          <Label htmlFor={`obs-${index}-${key}`}>
                            {key === "at"
                              ? "Observation time (Denver)"
                              : key === "label"
                                ? "Observed parameter"
                                : key === "value"
                                  ? "Recorded value"
                                  : key === "unit"
                                    ? "Recorded unit"
                                    : "Observation notes"}{" "}
                            {index + 1}
                          </Label>
                          <Input
                            id={`obs-${index}-${key}`}
                            type={key === "at" ? "datetime-local" : "text"}
                            inputMode={key === "value" ? "decimal" : undefined}
                            value={o[key]}
                            onChange={(e) =>
                              change(
                                "observations",
                                form.observations.map((item, i) =>
                                  i === index
                                    ? { ...item, [key]: e.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </div>
                      ),
                    )}
                    <Button
                      variant="outline"
                      onClick={() =>
                        change(
                          "observations",
                          form.observations.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove observation {index + 1} from draft
                    </Button>
                  </fieldset>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    change("observations", [
                      ...form.observations,
                      { at: "", label: "", value: "", unit: "", notes: "" },
                    ])
                  }
                >
                  Add monitoring observation
                </Button>
              </div>
              <div className="space-y-3">
                <h3 className="font-medium">Medication and procedure events</h3>
                <p className="text-sm text-muted-foreground">
                  Document what occurred, including any administered amount and
                  unit in your description. These entries do not dispense stock
                  or create charges.
                </p>
                {form.events.map((event, index) => (
                  <fieldset
                    key={index}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <legend>Event {index + 1}</legend>
                    <Label htmlFor={`event-${index}-at`}>
                      Event time (Denver) {index + 1}
                    </Label>
                    <Input
                      id={`event-${index}-at`}
                      type="datetime-local"
                      value={event.at}
                      onChange={(e) =>
                        change(
                          "events",
                          form.events.map((item, i) =>
                            i === index
                              ? { ...item, at: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <Label htmlFor={`event-${index}-kind`}>
                      Event type {index + 1}
                    </Label>
                    <select
                      id={`event-${index}-kind`}
                      className={selectClass}
                      value={event.kind}
                      onChange={(e) =>
                        change(
                          "events",
                          form.events.map((item, i) =>
                            i === index
                              ? { ...item, kind: e.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="other">Other documented event</option>
                      <option value="medication">Medication documented</option>
                      <option value="procedure">Procedure documented</option>
                    </select>
                    <Label htmlFor={`event-${index}-notes`}>
                      Event description {index + 1}
                    </Label>
                    <Textarea
                      id={`event-${index}-notes`}
                      value={event.description}
                      maxLength={4000}
                      onChange={(e) =>
                        change(
                          "events",
                          form.events.map((item, i) =>
                            i === index
                              ? { ...item, description: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      onClick={() =>
                        change(
                          "events",
                          form.events.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove event {index + 1} from draft
                    </Button>
                  </fieldset>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    change("events", [
                      ...form.events,
                      { at: "", kind: "other", description: "" },
                    ])
                  }
                >
                  Add documentary event
                </Button>
              </div>
            </fieldset>
            {!signed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy || !form.procedure_name.trim() || !form.team.trim()
                  }
                  onClick={() => void save()}
                >
                  Save anesthesia draft
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || draftDirty || !record}
                  onClick={() => setConfirmSign(true)}
                >
                  Review and sign anesthesia record
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              disabled={busy || !record}
              onClick={() => void reload()}
            >
              Reload saved anesthesia record
            </Button>
            {signed && (
              <div className="space-y-2">
                <Label htmlFor="anesthesia-addendum">
                  Anesthesia correction / addendum
                </Label>
                <Textarea
                  id="anesthesia-addendum"
                  disabled={busy}
                  value={addendum}
                  maxLength={10000}
                  onChange={(e) => setAddendum(e.target.value)}
                />
                <Button
                  disabled={busy || !addendum.trim()}
                  onClick={() =>
                    void run(async () => {
                      const { error } = await db.rpc(
                        "add_anesthesia_record_addendum",
                        {
                          p_id: addendumId.current,
                          p_record_id: record.id,
                          p_pet_id: petId,
                          p_content: addendum,
                        },
                      );
                      if (error) throw error;
                      setAddendum("");
                      addendumId.current = crypto.randomUUID();
                      setMessage("Anesthesia addendum saved.");
                      await refresh(record.id);
                    })
                  }
                >
                  Save anesthesia addendum
                </Button>
              </div>
            )}
            {addenda.isError && (
              <p role="alert">
                Addenda could not load.{" "}
                <Button onClick={() => void addenda.refetch()}>
                  Retry anesthesia addenda
                </Button>
              </p>
            )}
            {addenda.data?.map((a) => (
              <div key={a.id} className="rounded-md border p-3">
                <p className="text-sm">
                  {author(a.actor_id)} · {when(a.recorded_at)} Denver
                </p>
                <p className="whitespace-pre-wrap">{a.content}</p>
              </div>
            ))}
            {record && (
              <details>
                <summary className="cursor-pointer">
                  Anesthesia version history
                </summary>
                {history.isError && (
                  <p role="alert">
                    History could not load.{" "}
                    <Button onClick={() => void history.refetch()}>
                      Retry anesthesia history
                    </Button>
                  </p>
                )}
                {history.data?.map((h) => (
                  <div key={h.id} className="my-2 rounded-md border p-3">
                    <p>
                      Version {h.version} · {author(h.actor_id)} ·{" "}
                      {when(h.recorded_at)} Denver
                    </p>
                    <AnesthesiaHistorySnapshot
                      record={h.snapshot as unknown as AnesthesiaRecord}
                    />
                  </div>
                ))}
              </details>
            )}
          </div>
        )}
        <AlertDialog open={confirmSign} onOpenChange={setConfirmSign}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign saved anesthesia record?</AlertDialogTitle>
              <AlertDialogDescription>
                Review the saved procedure, times, assessment, plan,
                observations, source and team. Signing preserves this version;
                later corrections must be appended. No clinical completeness or
                safety judgment is made by this form.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                Keep reviewing
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    if (!record || draftDirty)
                      throw new Error(
                        "Save and review the latest draft before signing",
                      );
                    const { data, error } = await db.rpc(
                      "sign_patient_anesthesia_record",
                      {
                        p_id: record.id,
                        p_pet_id: petId,
                        p_expected_version: record.version,
                      },
                    );
                    if (error) throw error;
                    adopt(data);
                    setConfirmSign(false);
                    setMessage("Anesthesia record signed.");
                    await refresh(data.id);
                  });
                }}
              >
                Sign saved anesthesia record
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
