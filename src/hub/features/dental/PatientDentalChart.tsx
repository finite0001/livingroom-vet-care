import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import {
  denverDateTime,
  denverInstant,
  errorText,
} from "@/hub/features/clinical/editor-state";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  dentalSpecies,
  toothQuadrants,
  emptyTooth,
  validateDentalData,
} from "./tooth-chart";
import type { DentalChartData, ToothObservation } from "./tooth-chart";
import type { Tables } from "@/integrations/supabase/types";
interface PatientDentalChartProps {
  petId: string;
  species: string;
  onDirtyChange?: (dirty: boolean) => void;
}
type Chart = Tables<"dental_charts">;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export function PatientDentalChart({
  petId,
  species,
  onDirtyChange,
}: PatientDentalChartProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [chart, setChart] = useState<Chart | null>(null);
  const chartId = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dentition, setDentition] = useState("");
  const [visit, setVisit] = useState(denverDateTime(new Date()));
  const [notes, setNotes] = useState("");
  const [teeth, setTeeth] = useState<DentalChartData>({});
  const [selectedTooth, setSelectedTooth] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [addendum, setAddendum] = useState("");
  const addendumId = useRef<string | null>(null);
  const unsaved = dirty || Boolean(addendum.trim()) || busy;
  useEffect(() => {
    onDirtyChange?.(unsaved);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange, unsaved]);
  useEffect(() => {
    if (!unsaved) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [unsaved]);
  const list = useQuery({
    queryKey: ["dental-charts", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_charts")
        .select("*")
        .eq("pet_id", petId)
        .order("visit_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const authors = useQuery({
    queryKey: ["dental-authors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name");
      if (error) throw error;
      return data;
    },
  });
  const revisions = useQuery({
    queryKey: ["dental-revisions", chart?.id],
    enabled: Boolean(chart),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_chart_revisions")
        .select("*")
        .eq("chart_id", chart.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const addenda = useQuery({
    queryKey: ["dental-addenda", chart?.id],
    enabled: Boolean(chart),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_chart_addenda")
        .select("*")
        .eq("chart_id", chart.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const family = chart?.species_family || dentalSpecies(species);
  const signed = chart?.status === "signed";
  const observation = teeth[selectedTooth] || emptyTooth();
  const author = (id: string) =>
    authors.data?.find((row) => row.id === id)?.full_name || `Staff ${id}`;
  function load(row: Chart) {
    setChart(row);
    chartId.current = row.id;
    setCreating(false);
    setDentition(row.dentition);
    setVisit(denverDateTime(row.visit_at));
    setNotes(row.notes);
    setTeeth(row.teeth as unknown as DentalChartData);
    setSelectedTooth("");
    setDirty(false);
    setError("");
    setNotice("");
    setAddendum("");
    addendumId.current = null;
  }
  function navigate(action: () => void) {
    if (dirty || addendum.trim()) setLeaveAction(() => action);
    else action();
  }
  function create() {
    navigate(() => {
      setChart(null);
      chartId.current = crypto.randomUUID();
      setCreating(true);
      setDentition("");
      setVisit(denverDateTime(new Date()));
      setNotes("");
      setTeeth({});
      setSelectedTooth("");
      setDirty(false);
      setError("");
      setNotice("");
      setAddendum("");
    });
  }
  function updateTooth(patch: Partial<ToothObservation>) {
    setTeeth({ ...teeth, [selectedTooth]: { ...observation, ...patch } });
    setDirty(true);
  }
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["dental-charts", petId] }),
      cache.invalidateQueries({ queryKey: ["dental-revisions"] }),
      cache.invalidateQueries({ queryKey: ["dental-addenda"] }),
    ]);
  }
  async function perform(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!session?.user.id)
        throw new Error("Sign in before saving dental records.");
      await work();
    } catch (failure) {
      setError(
        errorText(
          failure &&
            typeof failure === "object" &&
            "code" in failure &&
            failure.code === "40001"
            ? { message: "Dental chart version conflict" }
            : failure,
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save() {
    await perform(async () => {
      if (!dentition)
        throw new Error("Choose the dentition explicitly before saving.");
      const validation = validateDentalData(teeth);
      if (validation) throw new Error(validation);
      chartId.current ??= crypto.randomUUID();
      const { data, error } = await supabase.rpc("save_dental_chart", {
        p_id: chartId.current,
        p_pet_id: petId,
        p_expected_version: chart?.version ?? null,
        p_dentition: dentition,
        p_visit_at: denverInstant(visit),
        p_notes: notes,
        p_teeth: JSON.parse(JSON.stringify(teeth)),
      });
      if (error) throw error;
      load(data);
      setNotice("Dental draft saved.");
      await refresh();
    });
  }
  async function sign() {
    await perform(async () => {
      const { data, error } = await supabase.rpc("sign_dental_chart", {
        p_id: chart.id,
        p_pet_id: petId,
        p_expected_version: chart.version,
      });
      if (error) throw error;
      load(data);
      setSignOpen(false);
      setNotice("Dental chart signed. Original observations are locked.");
      await refresh();
    });
  }
  async function correct() {
    await perform(async () => {
      addendumId.current ??= crypto.randomUUID();
      const { error } = await supabase.rpc("add_dental_addendum", {
        p_id: addendumId.current,
        p_chart_id: chart.id,
        p_pet_id: petId,
        p_content: addendum,
      });
      if (error) throw error;
      setAddendum("");
      addendumId.current = null;
      setNotice("Dental correction appended. Original chart retained.");
      await refresh();
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dental charting</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Select teeth to record observations. Unrecorded teeth are not assumed
          normal. Templates and forms await Dr. Susan Edler’s clinical approval
          before clinical use.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <Button variant="outline" disabled={busy} onClick={create}>
          New dental chart
        </Button>
        {list.isLoading && <p role="status">Loading dental charts…</p>}
        {list.isError && (
          <p role="alert">
            Dental charts could not be loaded.{" "}
            <Button variant="outline" onClick={() => void list.refetch()}>
              Retry dental charts
            </Button>
          </p>
        )}
        <ul className="flex flex-wrap gap-2">
          {list.data?.map((row) => (
            <li key={row.id}>
              <Button
                variant={chart?.id === row.id ? "secondary" : "outline"}
                disabled={busy}
                onClick={() => navigate(() => load(row))}
              >
                Open {row.dentition} dental chart ·{" "}
                {denverDateTime(row.visit_at).replace("T", " ")} · {row.status}
              </Button>
            </li>
          ))}
        </ul>
        {(creating || chart) && (
          <div className="space-y-4 rounded-md border p-3 md:p-4">
            {chart && (
              <p className="text-sm">
                Version {chart.version} · {chart.status} ·{" "}
                {signed
                  ? `Signed by ${author(chart.signed_by)} at ${denverDateTime(chart.signed_at).replace("T", " ")} Denver time`
                  : `Last saved by ${author(chart.updated_by)}`}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="dental-dentition">Dentition</Label>
                <select
                  id="dental-dentition"
                  className={selectClass}
                  value={dentition}
                  disabled={
                    busy || Boolean(chart) || Object.keys(teeth).length > 0
                  }
                  onChange={(event) => {
                    setDentition(event.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="">Select dentition</option>
                  {family !== "manual" && (
                    <>
                      <option value="adult">
                        Adult (permanent) · {family}
                      </option>
                      <option value="deciduous">Deciduous · {family}</option>
                    </>
                  )}
                  <option value="manual">
                    Manual notes / nonstandard dentition
                  </option>
                </select>
              </div>
              <div>
                <Label htmlFor="dental-visit">Dental visit time (Denver)</Label>
                <Input
                  id="dental-visit"
                  type="datetime-local"
                  value={visit}
                  disabled={busy || signed}
                  onChange={(event) => {
                    setVisit(event.target.value);
                    setDirty(true);
                  }}
                />
              </div>
            </div>
            {dentition === "manual" && (
              <p className="text-sm">
                No automated tooth layout is assigned. Describe the species,
                dentition and tooth identifiers in manual notes.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {toothQuadrants(family, dentition).map((quadrant) => (
                <section
                  key={quadrant.label}
                  aria-label={quadrant.label}
                  className="rounded-md border p-3"
                >
                  <h3 className="mb-2 text-sm font-medium">{quadrant.label}</h3>
                  <div className="flex flex-wrap gap-1">
                    {quadrant.teeth.map((tooth) => (
                      <Button
                        key={tooth}
                        size="sm"
                        variant={
                          selectedTooth === tooth
                            ? "default"
                            : teeth[tooth]
                              ? "secondary"
                              : "outline"
                        }
                        aria-pressed={selectedTooth === tooth}
                        aria-label={`Tooth ${tooth}${teeth[tooth]?.presence && teeth[tooth].presence !== "not_recorded" ? ` · ${teeth[tooth].presence}` : ""}`}
                        onClick={() => setSelectedTooth(tooth)}
                      >
                        {tooth}
                        {teeth[tooth]?.presence === "missing"
                          ? " M"
                          : teeth[tooth]?.presence === "extracted"
                            ? " E"
                            : ""}
                      </Button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {selectedTooth && (
              <fieldset
                disabled={busy || signed}
                className="space-y-3 rounded-md border p-3"
              >
                <legend className="px-1 font-medium">
                  Tooth {selectedTooth}
                </legend>
                <Label htmlFor="dental-presence">Recorded tooth presence</Label>
                <select
                  id="dental-presence"
                  className={selectClass}
                  value={observation.presence}
                  onChange={(event) =>
                    updateTooth({ presence: event.target.value })
                  }
                >
                  <option value="not_recorded">Not recorded</option>
                  <option value="present">
                    Present (not an assessment of health)
                  </option>
                  <option value="missing">Missing</option>
                  <option value="extracted">Extracted</option>
                </select>
                {(["findings", "planned", "performed"] as const).map((key) => (
                  <div key={key}>
                    <Label htmlFor={`dental-${key}`}>
                      {key === "findings"
                        ? "Tooth observations / findings"
                        : key === "planned"
                          ? "Planned procedure notes"
                          : "Performed procedure notes"}
                    </Label>
                    <Textarea
                      id={`dental-${key}`}
                      value={observation[key]}
                      maxLength={5000}
                      onChange={(event) =>
                        updateTooth({ [key]: event.target.value })
                      }
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Optional millimeter measurements are raw observations. No
                  periodontal stage or treatment is calculated.
                </p>
                {observation.measurements.map((measurement, index) => (
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]"
                  >
                    <div>
                      <Label htmlFor={`dental-measurement-label-${index}`}>
                        Measurement site / description {index + 1}
                      </Label>
                      <Input
                        id={`dental-measurement-label-${index}`}
                        value={measurement.label}
                        maxLength={120}
                        onChange={(event) =>
                          updateTooth({
                            measurements: observation.measurements.map(
                              (row, i) =>
                                i === index
                                  ? { ...row, label: event.target.value }
                                  : row,
                            ),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`dental-measurement-value-${index}`}>
                        Millimeters {index + 1}
                      </Label>
                      <Input
                        id={`dental-measurement-value-${index}`}
                        type="number"
                        step="any"
                        value={
                          Number.isFinite(measurement.value_mm) &&
                          measurement.value_mm !== 0
                            ? measurement.value_mm
                            : ""
                        }
                        onChange={(event) =>
                          updateTooth({
                            measurements: observation.measurements.map(
                              (row, i) =>
                                i === index
                                  ? {
                                      ...row,
                                      value_mm: Number(event.target.value),
                                    }
                                  : row,
                            ),
                          })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        updateTooth({
                          measurements: observation.measurements.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      Remove measurement {index + 1}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy || signed || observation.measurements.length >= 12
                  }
                  onClick={() =>
                    updateTooth({
                      measurements: [
                        ...observation.measurements,
                        { label: "", value_mm: 0 },
                      ],
                    })
                  }
                >
                  Add tooth measurement
                </Button>
              </fieldset>
            )}
            <div>
              <Label htmlFor="dental-notes">Dental chart / manual notes</Label>
              <Textarea
                id="dental-notes"
                value={notes}
                maxLength={20000}
                readOnly={signed}
                disabled={busy}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setDirty(true);
                }}
              />
            </div>
            {!signed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !dentition}
                  onClick={() => void save()}
                >
                  Save dental draft
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !chart || dirty}
                  onClick={() => setSignOpen(true)}
                >
                  Review and sign dental chart
                </Button>
                {dirty && chart && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      navigate(() => {
                        void perform(async () => {
                          const { data, error } = await supabase
                            .from("dental_charts")
                            .select("*")
                            .eq("id", chart.id)
                            .eq("pet_id", petId)
                            .single();
                          if (error) throw error;
                          load(data);
                        });
                      })
                    }
                  >
                    Reload saved dental chart
                  </Button>
                )}
              </div>
            )}
            {signed && (
              <div className="space-y-2">
                <Label htmlFor="dental-addendum">
                  Append dental correction or additional information
                </Label>
                <Textarea
                  id="dental-addendum"
                  value={addendum}
                  maxLength={10000}
                  disabled={busy}
                  onChange={(event) => setAddendum(event.target.value)}
                />
                <Button
                  disabled={busy || !addendum.trim()}
                  onClick={() => void correct()}
                >
                  Save dental addendum
                </Button>
                <ul className="space-y-2">
                  {addenda.data?.map((row) => (
                    <li key={row.id} className="rounded-md border p-3">
                      <p className="whitespace-pre-wrap text-sm">
                        {row.content}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {author(row.created_by)} ·{" "}
                        {denverDateTime(row.created_at).replace("T", " ")}{" "}
                        Denver time
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(authors.isError || revisions.isError || addenda.isError) && (
              <p role="alert">
                Some dental history or author names could not be loaded.{" "}
                <Button
                  variant="outline"
                  onClick={() => {
                    void refresh();
                    void authors.refetch();
                  }}
                >
                  Retry dental history
                </Button>
              </p>
            )}
            <details>
              <summary className="cursor-pointer">
                Saved dental version history
              </summary>
              <ul className="mt-2 space-y-3">
                {revisions.data?.map((row) => (
                  <li key={row.id} className="rounded-md border p-3">
                    <p className="font-medium">
                      Version {row.version} · {row.status} ·{" "}
                      {author(row.actor_id)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{row.notes}</p>
                    <ul className="text-sm">
                      {Object.entries(
                        row.teeth as unknown as DentalChartData,
                      ).map(([tooth, value]) => (
                        <li key={tooth} className="mt-2">
                          <strong>
                            Tooth {tooth} · {value.presence.replace(/_/g, " ")}
                          </strong>
                          <p className="whitespace-pre-wrap">
                            Findings: {value.findings || "Not recorded"} ·
                            Planned: {value.planned || "Not recorded"} ·
                            Performed: {value.performed || "Not recorded"}
                          </p>
                          {value.measurements.map((measurement, i) => (
                            <p key={i}>
                              {measurement.label}: {measurement.value_mm} mm
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        <AlertDialog open={signOpen} onOpenChange={setSignOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign this dental chart?</AlertDialogTitle>
              <AlertDialogDescription>
                Verify the patient, dentition and saved observations. Signing
                locks the original chart and records your identity. Later
                corrections are appended.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Keep draft</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void sign();
                }}
              >
                Sign saved dental chart
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={Boolean(leaveAction)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Discard unsaved dental changes?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Your current dental draft or correction has not been saved.
                Saved history remains unchanged.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setLeaveAction(null)}>
                Keep dental changes
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  leaveAction?.();
                  setLeaveAction(null);
                }}
              >
                Discard dental changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
