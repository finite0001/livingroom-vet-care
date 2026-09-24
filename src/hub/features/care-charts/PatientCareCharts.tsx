import { useCallback, useEffect, useState } from "react";
import { CareDirtyContext, useCareDirty } from "./dirty-state";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StockField } from "../inventory/InventoryPage";
import { errorMessage, practiceTimestamp } from "../inventory/stock-policy";
import { denverInstant, denverLocal } from "../scheduling/time";
import {
  care,
  type QolRecord,
  type Lesion,
  type LesionObservation,
  type QolArgs,
} from "./api";
import { useCareMutation } from "./useCareMutation";
import { coordinate, measurement, moveCoordinate } from "./policy";
interface PatientCareChartsProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
const domains = [
  ["appetite", "Appetite"],
  ["drinking", "Drinking"],
  ["mobility", "Mobility"],
  ["comfort", "Comfort"],
  ["social_engagement", "Social engagement"],
  ["good_days", "Good and difficult days"],
  ["notes", "Clinical notes"],
] as const;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
function QolEditor({
  petId,
  record,
  close,
  reload,
}: {
  petId: string;
  record: QolRecord | null;
  close: () => void;
  reload: () => void;
}) {
  const state = useCareMutation(`qol:${petId}:${record?.id ?? "new"}`);
  const [initial] = useState(() => ({
    observed: record
      ? denverLocal(record.observed_at)
      : denverLocal(new Date()),
    observer: record?.observer ?? "",
    appetite: record?.appetite ?? "",
    drinking: record?.drinking ?? "",
    mobility: record?.mobility ?? "",
    comfort: record?.comfort ?? "",
    social_engagement: record?.social_engagement ?? "",
    good_days: record?.good_days ?? "",
    notes: record?.notes ?? "",
  }));
  const [form, setForm] = useState(initial);
  const [validation, setValidation] = useState("");
  const signed = record?.status === "signed";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useCareDirty(`qol:${record?.id ?? "new"}`, dirty || state.locked);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setValidation("");
    if (state.uncertain) {
      if (await state.retry()) close();
      return;
    }
    try {
      const args: QolArgs = {
        p_id: record?.id ?? crypto.randomUUID(),
        p_pet_id: petId,
        p_expected_version: record?.version ?? null,
        p_observed_at: denverInstant(form.observed),
        p_observer: form.observer,
        p_appetite: form.appetite,
        p_drinking: form.drinking,
        p_mobility: form.mobility,
        p_comfort: form.comfort,
        p_social_engagement: form.social_engagement,
        p_good_days: form.good_days,
        p_notes: form.notes,
      };
      if (await state.run("save_patient_qol", args)) close();
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  async function sign() {
    if (!record || dirty) return;
    if (
      !window.confirm(
        "Sign the saved observations? This version becomes immutable; later corrections use an addendum.",
      )
    )
      return;
    if (
      await state.run("sign_patient_qol", {
        p_id: record.id,
        p_expected_version: record.version,
      })
    )
      close();
  }
  return (
    <div className="space-y-3">
      <form onSubmit={save} className="space-y-3">
        <fieldset disabled={state.locked} className="grid gap-3 md:grid-cols-2">
          <StockField label="QOL observation date/time (America/Denver)">
            <Input
              type="datetime-local"
              required
              readOnly={signed}
              value={form.observed}
              onChange={(e) => setForm({ ...form, observed: e.target.value })}
            />
          </StockField>
          <StockField label="Observer / source">
            <Input
              required
              maxLength={200}
              readOnly={signed}
              value={form.observer}
              onChange={(e) => setForm({ ...form, observer: e.target.value })}
            />
          </StockField>
          {domains.map(([key, label]) => (
            <StockField key={key} label={label}>
              <Textarea
                readOnly={signed}
                maxLength={key === "notes" ? 20000 : 5000}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </StockField>
          ))}
        </fieldset>
        {validation && (
          <p role="alert" className="text-destructive">
            {validation}
          </p>
        )}
        {state.error && (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        )}
        {!signed && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={state.busy}>
              {state.uncertain ? "Retry same chart request" : "Save QOL draft"}
            </Button>
            {record && (
              <Button
                type="button"
                variant="outline"
                disabled={state.locked || dirty}
                onClick={sign}
              >
                Sign saved observations
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={state.locked}
              onClick={reload}
            >
              Reload latest chart
            </Button>
          </div>
        )}
      </form>
      {signed && (
        <>
          <p className="text-sm text-muted-foreground">
            Signed {practiceTimestamp(record.signed_at!)}. Original observations
            are retained.
          </p>
          <QolAddendum record={record} />
        </>
      )}
      <Button
        variant="ghost"
        disabled={state.locked}
        onClick={() => {
          if (!dirty || window.confirm("Discard unsaved QOL observations?"))
            close();
        }}
      >
        Close chart
      </Button>
    </div>
  );
}
function QolAddendum({ record }: { record: QolRecord }) {
  const state = useCareMutation(`qol-addendum:${record.id}`);
  const [dirty, setDirty] = useState(false);
  useCareDirty(`qol-addendum:${record.id}`, dirty || state.locked);
  const list = useQuery({
    queryKey: ["care-charts", "qol-addenda", record.id],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_qol_addenda")
        .select("*")
        .eq("qol_id", record.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (state.uncertain) {
      if (await state.retry()) {
        form.reset();
        setDirty(false);
      }
      return;
    }
    const v = new FormData(form);
    if (
      await state.run("add_patient_qol_addendum", {
        p_id: crypto.randomUUID(),
        p_qol_id: record.id,
        p_content: String(v.get("content")),
      })
    ) {
      form.reset();
      setDirty(false);
    }
  }
  return (
    <div className="space-y-3">
      {list.error && <p role="alert">{errorMessage(list.error)}</p>}
      {list.data?.map((a) => (
        <p key={a.id} className="rounded-md border p-3 text-sm">
          {practiceTimestamp(a.created_at)} · {a.content}
        </p>
      ))}
      <form
        onChange={() => setDirty(true)}
        onSubmit={save}
        className="space-y-2"
      >
        <StockField label="QOL correction / addendum">
          <Textarea
            name="content"
            required
            maxLength={20000}
            disabled={state.locked}
          />
        </StockField>
        {state.error && <p role="alert">{state.error}</p>}
        <Button disabled={state.busy}>
          {state.uncertain ? "Retry same addendum" : "Append QOL addendum"}
        </Button>
      </form>
    </div>
  );
}
function LesionEditor({
  petId,
  lesion,
  close,
  reload,
}: {
  petId: string;
  lesion: Lesion | null;
  close: () => void;
  reload: () => void;
}) {
  const state = useCareMutation(`lesion:${petId}:${lesion?.id ?? "new"}`);
  const [dirty, setDirty] = useState(false);
  useCareDirty(`lesion:${lesion?.id ?? "new"}`, dirty || state.locked);
  const [x, setX] = useState(String(lesion?.x ?? 0.5));
  const [y, setY] = useState(String(lesion?.y ?? 0.5));
  const [view, setView] = useState(lesion?.body_view ?? "dorsal");
  const [validation, setValidation] = useState("");
  const photos = useQuery({
    queryKey: ["care-charts", "photos", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_documents")
        .select("id,file_name")
        .eq("pet_id", petId)
        .eq("status", "ready")
        .in("mime_type", ["image/png", "image/jpeg"])
        .order("created_at", { ascending: false })
        .limit(101);
      if (error) throw error;
      return data;
    },
  });
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidation("");
    if (state.uncertain) {
      if (await state.retry()) close();
      return;
    }
    const v = new FormData(e.currentTarget);
    try {
      if (
        await state.run("record_lesion_observation", {
          p_id: crypto.randomUUID(),
          p_lesion_id: lesion?.id ?? crypto.randomUUID(),
          p_pet_id: petId,
          p_expected_version: lesion?.version ?? null,
          p_observed_at: denverInstant(String(v.get("observed"))),
          p_label: String(v.get("label")),
          p_body_view: view,
          p_x: coordinate(x),
          p_y: coordinate(y),
          p_length_mm: measurement(String(v.get("length"))),
          p_width_mm: measurement(String(v.get("width"))),
          p_depth_mm: measurement(String(v.get("depth"))),
          p_notes: String(v.get("notes")),
          p_photo_document_id: String(v.get("photo")) || null,
        })
      )
        close();
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  return (
    <form onChange={() => setDirty(true)} onSubmit={save} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Species-neutral schematic for finding a recorded observation. This is
        not an anatomical diagnosis. Click to place a marker, or focus the
        schematic and use arrow keys; numeric coordinates provide the same
        control.
      </p>
      <button
        type="button"
        disabled={state.locked}
        aria-label="Set lesion location on schematic; arrow keys move marker"
        className="block w-full rounded-md border bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(e) => {
          if (e.detail === 0) return;
          setDirty(true);
          const r = e.currentTarget.getBoundingClientRect();
          setX(
            String(Math.round(((e.clientX - r.left) / r.width) * 100) / 100),
          );
          setY(
            String(Math.round(((e.clientY - r.top) / r.height) * 100) / 100),
          );
        }}
        onKeyDown={(e) => {
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            e.preventDefault();
            setDirty(true);
            if (e.key === "ArrowLeft" || e.key === "ArrowRight")
              setX(
                String(
                  moveCoordinate(
                    Number(x),
                    e.key === "ArrowLeft" ? -0.01 : 0.01,
                  ),
                ),
              );
            else
              setY(
                String(
                  moveCoordinate(Number(y), e.key === "ArrowUp" ? -0.01 : 0.01),
                ),
              );
          }
        }}
      >
        <svg
          viewBox="0 0 400 200"
          className="block h-auto w-full"
          aria-hidden="true"
        >
          <ellipse
            cx="200"
            cy="100"
            rx="105"
            ry="68"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="200" cy="25" r="20" fill="none" stroke="currentColor" />
          <text x="12" y="22" className="fill-current text-sm">
            {view} schematic
          </text>
          <circle
            cx={Number(x) * 400}
            cy={Number(y) * 200}
            r="7"
            className="fill-primary"
          />
          <text
            x="200"
            y="193"
            textAnchor="middle"
            className="fill-current text-xs"
          >
            Marker is a reference location only
          </text>
        </svg>
      </button>
      <fieldset disabled={state.locked} className="grid gap-3 md:grid-cols-2">
        <StockField label="Lesion label">
          <Input
            name="label"
            required
            maxLength={200}
            defaultValue={lesion?.label}
          />
        </StockField>
        <StockField label="Body view">
          <select
            className={selectClass}
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            {["dorsal", "ventral", "left", "right"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </StockField>
        <StockField label="Horizontal coordinate (0–1)">
          <Input
            value={x}
            onChange={(e) => setX(e.target.value)}
            type="number"
            min="0"
            max="1"
            step="0.01"
            required
          />
        </StockField>
        <StockField label="Vertical coordinate (0–1)">
          <Input
            value={y}
            onChange={(e) => setY(e.target.value)}
            type="number"
            min="0"
            max="1"
            step="0.01"
            required
          />
        </StockField>
        <StockField label="Lesion observation date/time (America/Denver)">
          <Input
            name="observed"
            type="datetime-local"
            required
            defaultValue={denverLocal(new Date())}
          />
        </StockField>
        {[
          ["length", "Length"],
          ["width", "Width"],
          ["depth", "Depth"],
        ].map(([key, label]) => (
          <StockField key={key} label={`${label} (mm, optional)`}>
            <Input name={key} inputMode="decimal" />
          </StockField>
        ))}
        <StockField label="Linked patient photo (optional)">
          <select name="photo" className={selectClass}>
            <option value="">No photo</option>
            {photos.data?.slice(0, 100).map((p) => (
              <option key={p.id} value={p.id}>
                {p.file_name}
              </option>
            ))}
          </select>
        </StockField>
        <StockField label="Lesion clinical notes">
          <Textarea name="notes" maxLength={20000} />
        </StockField>
      </fieldset>
      {photos.error && (
        <p role="alert">Photos could not load: {errorMessage(photos.error)}</p>
      )}
      {(photos.data?.length ?? 0) > 100 && (
        <p className="text-sm">Showing the 100 most recent patient images.</p>
      )}
      {validation && (
        <p role="alert" className="text-destructive">
          {validation}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={state.busy}>
          {state.uncertain
            ? "Retry same lesion observation"
            : "Save lesion observation"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={state.locked}
          onClick={reload}
        >
          Reload latest body map
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={state.locked}
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Discard unsaved lesion observations?")
            )
              close();
          }}
        >
          Close lesion editor
        </Button>
      </div>
    </form>
  );
}
function ObservationCorrection({ row }: { row: LesionObservation }) {
  const state = useCareMutation(`lesion-correction:${row.id}`);
  const [dirty, setDirty] = useState(false);
  useCareDirty(`lesion-correction:${row.id}`, dirty || state.locked);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.uncertain) {
      await state.retry();
      return;
    }
    const v = new FormData(e.currentTarget);
    await state.run("correct_lesion_observation", {
      p_id: crypto.randomUUID(),
      p_observation_id: row.id,
      p_reason: String(v.get("reason")),
    });
  }
  return (
    <details>
      <summary className="cursor-pointer text-sm">
        Mark this observation entered in error
      </summary>
      <form
        onChange={() => setDirty(true)}
        onSubmit={save}
        className="mt-2 space-y-2"
      >
        <StockField label="Lesion correction reason">
          <Textarea
            name="reason"
            required
            maxLength={20000}
            disabled={state.locked}
          />
        </StockField>
        {state.error && <p role="alert">{state.error}</p>}
        <Button variant="outline" disabled={state.busy}>
          {state.uncertain
            ? "Retry same correction"
            : "Record lesion correction"}
        </Button>
      </form>
    </details>
  );
}
function LesionHistory({ lesion, petId }: { lesion: Lesion; petId: string }) {
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const query = useQuery({
    queryKey: ["care-charts", "lesion-history", lesion.id, page],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_lesion_observations")
        .select("*")
        .eq("lesion_id", lesion.id)
        .order("observed_at", { ascending: false })
        .order("id")
        .range(page * 25, page * 25 + 25);
      if (error) throw error;
      const rows = data.slice(0, 25);
      const corrections = rows.length
        ? await care
            .from("patient_lesion_corrections")
            .select("*")
            .in(
              "observation_id",
              rows.map((r) => r.id),
            )
        : { data: [], error: null };
      if (corrections.error) throw corrections.error;
      return {
        rows,
        corrections: corrections.data ?? [],
        more: data.length > 25,
      };
    },
  });
  async function photo(id: string) {
    setError("");
    setPhotoUrl("");
    try {
      const { data, error } = await supabase
        .from("patient_documents")
        .select("file_path")
        .eq("id", id)
        .eq("pet_id", petId)
        .eq("status", "ready")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error("Photo is no longer available as an active document.");
      const result = await supabase.storage
        .from("patient-documents")
        .createSignedUrl(data.file_path, 60);
      if (result.error) throw result.error;
      setPhotoUrl(result.data.signedUrl);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{lesion.label} observation history</h3>
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      {error && <p role="alert">{error}</p>}
      {photoUrl && (
        <a
          href={photoUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          Open authorized photo (link expires in one minute)
        </a>
      )}
      {query.data?.rows.map((r) => {
        const correction = query.data.corrections.find(
          (c) => c.observation_id === r.id,
        );
        return (
          <article key={r.id} className="space-y-2 rounded-md border p-3">
            <p className="font-medium">
              {practiceTimestamp(r.observed_at)} · {r.label}
            </p>
            <p className="text-sm">
              {r.body_view} · coordinates {r.x}, {r.y} · length{" "}
              {r.length_mm ?? "not recorded"} mm · width{" "}
              {r.width_mm ?? "not recorded"} mm · depth{" "}
              {r.depth_mm ?? "not recorded"} mm
            </p>
            <p className="whitespace-pre-wrap text-sm">{r.notes}</p>
            {r.photo_document_id && (
              <Button
                variant="outline"
                onClick={() => photo(r.photo_document_id!)}
              >
                View linked photo
              </Button>
            )}
            {correction ? (
              <p className="text-sm text-clinical-alert">
                Observation corrected: {correction.reason}. Original retained;
                do not use as a current measurement.
              </p>
            ) : (
              <ObservationCorrection row={r} />
            )}
          </article>
        );
      })}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!page || query.isFetching}
          onClick={() => setPage((p) => p - 1)}
        >
          Newer observations
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.more || query.isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          Older observations
        </Button>
      </div>
    </div>
  );
}
export function PatientCareCharts({
  petId,
  onDirtyChange,
}: PatientCareChartsProps) {
  const [dirtyFlags, setDirtyFlags] = useState<Record<string, boolean>>({});
  const reportDirty = useCallback(
    (id: string, value: boolean) =>
      setDirtyFlags((previous) =>
        previous[id] === value ? previous : { ...previous, [id]: value },
      ),
    [],
  );
  const anyDirty = Object.values(dirtyFlags).some(Boolean);
  useEffect(() => {
    onDirtyChange?.(anyDirty);
    return () => onDirtyChange?.(false);
  }, [anyDirty, onDirtyChange]);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [qolPage, setQolPage] = useState(0);
  const [lesionPage, setLesionPage] = useState(0);
  const [qolOpen, setQolOpen] = useState(false);
  const [selectedQol, setSelectedQol] = useState<QolRecord | null>(null);
  const [qolKey, setQolKey] = useState(0);
  const [lesionOpen, setLesionOpen] = useState(false);
  const [selectedLesion, setSelectedLesion] = useState<Lesion | null>(null);
  const [lesionKey, setLesionKey] = useState(0);
  const qol = useQuery({
    queryKey: ["care-charts", "qol", petId, qolPage],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_qol_records")
        .select("*")
        .eq("pet_id", petId)
        .order("observed_at", { ascending: false })
        .order("id")
        .range(qolPage * 25, qolPage * 25 + 25);
      if (error) throw error;
      return data;
    },
  });
  const lesions = useQuery({
    queryKey: ["care-charts", "lesions", petId, lesionPage],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_lesions")
        .select("*")
        .eq("pet_id", petId)
        .order("created_at")
        .order("id")
        .range(lesionPage * 50, lesionPage * 50 + 50);
      if (error) throw error;
      return data;
    },
  });
  async function reloadQol() {
    setWorkspaceError("");
    try {
      if (selectedQol) {
        const { data, error } = await care
          .from("patient_qol_records")
          .select("*")
          .eq("id", selectedQol.id)
          .eq("pet_id", petId)
          .single();
        if (error) throw error;
        setSelectedQol(data);
      }
      setQolKey((k) => k + 1);
    } catch (error) {
      setWorkspaceError(errorMessage(error));
    }
  }
  async function reloadLesion() {
    setWorkspaceError("");
    try {
      if (selectedLesion) {
        const { data, error } = await care
          .from("patient_lesions")
          .select("*")
          .eq("id", selectedLesion.id)
          .eq("pet_id", petId)
          .single();
        if (error) throw error;
        setSelectedLesion(data);
      }
      setLesionKey((k) => k + 1);
    } catch (error) {
      setWorkspaceError(errorMessage(error));
    }
  }

  return (
    <CareDirtyContext.Provider value={reportDirty}>
      <div className="space-y-5">
        {workspaceError && (
          <p role="alert" className="text-destructive">
            {workspaceError}
          </p>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Quality-of-life observations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Qualitative observation template draft-2026-09-12, pending Dr.
              Susan Edler’s review. This chart does not calculate a validated
              score, prognosis or treatment recommendation.
            </p>
            <Button
              onClick={() => {
                if (
                  Object.entries(dirtyFlags).some(
                    ([key, value]) => key.startsWith("qol:") && value,
                  ) &&
                  !window.confirm("Discard unsaved QOL observations?")
                )
                  return;
                setSelectedQol(null);
                setQolKey((k) => k + 1);
                setQolOpen(true);
              }}
            >
              New QOL observation
            </Button>
            {qol.error && <p role="alert">{errorMessage(qol.error)}</p>}
            {qol.data?.slice(0, 25).map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  {practiceTimestamp(r.observed_at)} · {r.observer} · {r.status}
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      Object.entries(dirtyFlags).some(
                        ([key, value]) => key.startsWith("qol:") && value,
                      ) &&
                      !window.confirm("Discard unsaved QOL observations?")
                    )
                      return;
                    setSelectedQol(r);
                    setQolKey((k) => k + 1);
                    setQolOpen(true);
                  }}
                >
                  Open QOL chart
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!qolPage}
                onClick={() => setQolPage((p) => p - 1)}
              >
                Newer QOL records
              </Button>
              <Button
                variant="outline"
                disabled={(qol.data?.length ?? 0) <= 25}
                onClick={() => setQolPage((p) => p + 1)}
              >
                Older QOL records
              </Button>
            </div>
            {qolOpen && (
              <QolEditor
                key={qolKey}
                petId={petId}
                record={selectedQol}
                close={() => setQolOpen(false)}
                reload={reloadQol}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mass / lesion body map</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Stable lesion labels link successive observations. Updating the
              map appends a dated observation and retains prior locations and
              measurements.
            </p>
            <Button
              onClick={() => {
                if (
                  Object.entries(dirtyFlags).some(
                    ([key, value]) => key.startsWith("lesion:") && value,
                  ) &&
                  !window.confirm("Discard unsaved lesion observations?")
                )
                  return;
                setSelectedLesion(null);
                setLesionKey((k) => k + 1);
                setLesionOpen(true);
              }}
            >
              Add lesion
            </Button>
            {lesions.error && <p role="alert">{errorMessage(lesions.error)}</p>}
            <ul aria-label="Recorded lesions" className="space-y-2">
              {lesions.data?.slice(0, 50).map((r) => (
                <li key={r.id} className="rounded-md border p-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (
                        Object.entries(dirtyFlags).some(
                          ([key, value]) => key.startsWith("lesion:") && value,
                        ) &&
                        !window.confirm("Discard unsaved lesion observations?")
                      )
                        return;
                      setSelectedLesion(r);
                      setLesionKey((k) => k + 1);
                      setLesionOpen(true);
                    }}
                  >
                    Open {r.label}
                  </Button>
                  <p className="text-sm">
                    {r.body_view} reference location {r.x}, {r.y} · revision{" "}
                    {r.version}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!lesionPage}
                onClick={() => setLesionPage((p) => p - 1)}
              >
                Previous lesions
              </Button>
              <Button
                variant="outline"
                disabled={(lesions.data?.length ?? 0) <= 50}
                onClick={() => setLesionPage((p) => p + 1)}
              >
                More lesions
              </Button>
            </div>
            {lesionOpen && (
              <LesionEditor
                key={lesionKey}
                petId={petId}
                lesion={selectedLesion}
                close={() => setLesionOpen(false)}
                reload={reloadLesion}
              />
            )}{" "}
            {selectedLesion && (
              <LesionHistory
                key={selectedLesion.id}
                lesion={selectedLesion}
                petId={petId}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </CareDirtyContext.Provider>
  );
}
