import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hub/contexts/auth-context";
import { StockField } from "../inventory/InventoryPage";
import { errorMessage, practiceTimestamp } from "../inventory/stock-policy";
import { denverInstant, denverLocal } from "../scheduling/time";
import { useCareDirty } from "./dirty-state";
import { useCareMutation } from "./useCareMutation";
import {
  care,
  type QolScaleArgs,
  type QolScaleAssessment,
  type QolScaleReference,
} from "./api";
import {
  QOL_SCALE_CATEGORIES,
  QOL_SCALE_MAX_SCORE,
  QOL_SCALE_MAX_TOTAL,
  activeReference,
  chartX,
  chartY,
  latestChange,
  parseQolScore,
  qolTotal,
  qolTrend,
  scoredCount,
  unscoredCategories,
  type QolScaleCategory,
  type QolScaleScores,
  type QolTrendPoint,
} from "./qol-scale";

const PAGE = 25;
const TREND_LIMIT = 100;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-100";
const PENDING_REVIEW =
  "Pending Dr. Susan Edler’s clinical review. Scores are recorded as entered; no interpretation, prognosis or recommendation is generated.";
type Form = {
  assessed: string;
  assessor: string;
  notes: string;
} & Record<QolScaleCategory, string> &
  Record<`${QolScaleCategory}_note`, string>;
function initialForm(record: QolScaleAssessment | null): Form {
  const form = {
    assessed: record
      ? denverLocal(record.assessed_at)
      : denverLocal(new Date()),
    assessor: record?.assessor ?? "",
    notes: record?.notes ?? "",
  } as Form;
  for (const { key } of QOL_SCALE_CATEGORIES) {
    const value = record?.[key];
    form[key] = value === null || value === undefined ? "" : String(value);
    form[`${key}_note`] = record?.[`${key}_note`] ?? "";
  }
  return form;
}
/** Parses form scores; invalid entries throw so the UI never sends out-of-range values. */
function formScores(form: Form): QolScaleScores {
  const scores = {} as QolScaleScores;
  for (const { key } of QOL_SCALE_CATEGORIES)
    scores[key] = parseQolScore(form[key]);
  return scores;
}
function safeScores(form: Form): QolScaleScores | null {
  try {
    return formScores(form);
  } catch {
    return null;
  }
}
function QolScaleEditor({
  petId,
  record,
  close,
  reload,
  onDirty,
}: {
  petId: string;
  record: QolScaleAssessment | null;
  close: () => void;
  reload: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const state = useCareMutation(`qol-scale:${petId}:${record?.id ?? "new"}`);
  const [initial] = useState(() => initialForm(record));
  const [form, setForm] = useState(initial);
  const [validation, setValidation] = useState("");
  const signed = record?.status === "signed";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useCareDirty(`qol-scale:${record?.id ?? "new"}`, dirty || state.locked);
  useEffect(() => {
    onDirty(dirty || state.locked);
    return () => onDirty(false);
  }, [dirty, state.locked, onDirty]);
  const scores = safeScores(form);
  const total = scores ? qolTotal(scores) : null;
  const scored = scores ? scoredCount(scores) : 0;
  const savedScores = record
    ? (Object.fromEntries(
        QOL_SCALE_CATEGORIES.map(({ key }) => [key, record[key]]),
      ) as QolScaleScores)
    : null;
  const missing = savedScores ? unscoredCategories(savedScores) : [];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setValidation("");
    if (state.uncertain) {
      if (await state.retry()) close();
      return;
    }
    try {
      const s = formScores(form);
      const args: QolScaleArgs = {
        p_id: record?.id ?? crypto.randomUUID(),
        p_pet_id: petId,
        p_expected_version: record?.version ?? null,
        p_assessed_at: denverInstant(form.assessed),
        p_assessor: form.assessor,
        p_hurt: s.hurt,
        p_hunger: s.hunger,
        p_hydration: s.hydration,
        p_hygiene: s.hygiene,
        p_happiness: s.happiness,
        p_mobility: s.mobility,
        p_more_good_days: s.more_good_days,
        p_hurt_note: form.hurt_note,
        p_hunger_note: form.hunger_note,
        p_hydration_note: form.hydration_note,
        p_hygiene_note: form.hygiene_note,
        p_happiness_note: form.happiness_note,
        p_mobility_note: form.mobility_note,
        p_more_good_days_note: form.more_good_days_note,
        p_notes: form.notes,
      };
      if (await state.run("save_patient_qol_scale", args)) close();
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  async function sign() {
    if (!record || dirty || missing.length) return;
    if (
      !window.confirm(
        "Sign the saved HHHHHMM assessment? This version becomes immutable; later corrections use an addendum.",
      )
    )
      return;
    if (
      await state.run("sign_patient_qol_scale", {
        p_id: record.id,
        p_expected_version: record.version,
      })
    )
      close();
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <h3 className="font-display text-lg">
        {signed
          ? "Signed HHHHHMM assessment (read-only)"
          : record
            ? "HHHHHMM assessment draft"
            : "New HHHHHMM assessment"}
      </h3>
      <form onSubmit={save} className="space-y-3">
        <fieldset disabled={state.locked} className="grid gap-3 md:grid-cols-2">
          <StockField label="Assessment date/time (America/Denver)">
            <Input
              type="datetime-local"
              required
              readOnly={signed}
              value={form.assessed}
              onChange={(e) => setForm({ ...form, assessed: e.target.value })}
            />
          </StockField>
          <StockField label="Assessor">
            <Input
              required
              maxLength={200}
              readOnly={signed}
              value={form.assessor}
              onChange={(e) => setForm({ ...form, assessor: e.target.value })}
            />
          </StockField>
        </fieldset>
        <fieldset
          disabled={state.locked}
          className="grid gap-3"
          aria-label="HHHHHMM category scores"
        >
          {QOL_SCALE_CATEGORIES.map(({ key, label }) => (
            <div
              key={key}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[12rem_1fr]"
            >
              <StockField label={`${label} score (0–10)`}>
                <select
                  className={selectClass}
                  disabled={signed}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                >
                  <option value="">Not scored</option>
                  {Array.from({ length: QOL_SCALE_MAX_SCORE + 1 }, (_, n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </StockField>
              <StockField label={`${label} note (optional)`}>
                <Textarea
                  rows={2}
                  readOnly={signed}
                  maxLength={2000}
                  value={form[`${key}_note`]}
                  onChange={(e) =>
                    setForm({ ...form, [`${key}_note`]: e.target.value })
                  }
                />
              </StockField>
            </div>
          ))}
          <StockField label="Assessment notes (optional)">
            <Textarea
              readOnly={signed}
              maxLength={20000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </StockField>
        </fieldset>
        <p aria-live="polite" className="font-medium" data-testid="qol-total">
          {total === null
            ? `Total: not available until all 7 categories are scored (${scored} of 7 scored)`
            : `Total: ${total} / ${QOL_SCALE_MAX_TOTAL}`}
        </p>
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
              {state.uncertain
                ? "Retry same assessment request"
                : "Save HHHHHMM draft"}
            </Button>
            {record && (
              <Button
                type="button"
                variant="outline"
                disabled={state.locked || dirty || missing.length > 0}
                onClick={sign}
              >
                Sign saved assessment
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={state.locked}
              onClick={reload}
            >
              Reload latest assessment
            </Button>
          </div>
        )}
        {!signed && record && missing.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Score every category and save before signing. Not yet scored:{" "}
            {missing.join(", ")}.
          </p>
        )}
      </form>
      {signed && (
        <>
          <p className="text-sm text-muted-foreground">
            Signed {practiceTimestamp(record.signed_at!)}. Original scores are
            retained; corrections are appended below.
          </p>
          <QolScaleAddendum record={record} />
        </>
      )}
      <Button
        variant="ghost"
        disabled={state.locked}
        onClick={() => {
          if (!dirty || window.confirm("Discard unsaved HHHHHMM scores?"))
            close();
        }}
      >
        Close assessment
      </Button>
    </div>
  );
}
function QolScaleAddendum({ record }: { record: QolScaleAssessment }) {
  const state = useCareMutation(`qol-scale-addendum:${record.id}`);
  const [dirty, setDirty] = useState(false);
  useCareDirty(`qol-scale-addendum:${record.id}`, dirty || state.locked);
  const list = useQuery({
    queryKey: ["care-charts", "qol-scale-addenda", record.id],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_qol_scale_addenda")
        .select("*")
        .eq("assessment_id", record.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const done = () => {
      form.reset();
      setDirty(false);
    };
    if (state.uncertain) {
      if (await state.retry()) done();
      return;
    }
    const v = new FormData(form);
    if (
      await state.run("add_patient_qol_scale_addendum", {
        p_id: crypto.randomUUID(),
        p_assessment_id: record.id,
        p_content: String(v.get("content")),
      })
    )
      done();
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
        <StockField label="HHHHHMM correction / addendum">
          <Textarea
            name="content"
            required
            maxLength={20000}
            disabled={state.locked}
          />
        </StockField>
        {state.error && <p role="alert">{state.error}</p>}
        <Button disabled={state.busy}>
          {state.uncertain ? "Retry same addendum" : "Append HHHHHMM addendum"}
        </Button>
      </form>
    </div>
  );
}
const W = 560;
const H = 220;
const PAD = { left: 36, right: 16, top: 16, bottom: 36 };
function signedChange(value: number | null): string {
  if (value === null) return "";
  return value > 0 ? `+${value}` : String(value);
}
export function QolTrendChart({
  points,
  category,
  reference,
}: {
  points: readonly QolTrendPoint[];
  category: QolScaleCategory | "total";
  reference: { total: number; label: string } | null;
}) {
  const max = category === "total" ? QOL_SCALE_MAX_TOTAL : QOL_SCALE_MAX_SCORE;
  const name =
    category === "total"
      ? "Total score"
      : QOL_SCALE_CATEGORIES.find((c) => c.key === category)!.label;
  const values = points.map((p) =>
    category === "total" ? p.total : p.scores[category],
  );
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xy = values.map((v, i) => [
    chartX(i, values.length, PAD.left, plotW),
    chartY(v, max, PAD.top, plotH),
  ]);
  // Neutral decade gridlines; no midpoint or threshold line is implied.
  const ticks =
    category === "total" ? [0, 10, 20, 30, 40, 50, 60, 70] : [0, 5, 10];
  const change = latestChange(
    points,
    category === "total" ? undefined : category,
  );
  if (!points.length)
    return (
      <p className="text-sm text-muted-foreground">
        No signed, fully scored assessments yet. The trend shows signed
        assessments only.
      </p>
    );
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby="qol-trend-title"
        className="block h-auto w-full max-w-2xl text-muted-foreground"
      >
        <title id="qol-trend-title">
          {`${name} over ${points.length} signed assessment${points.length === 1 ? "" : "s"}; latest ${values[values.length - 1]} of ${max}`}
        </title>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={chartY(t, max, PAD.top, plotH)}
              y2={chartY(t, max, PAD.top, plotH)}
              className="stroke-border"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={chartY(t, max, PAD.top, plotH) + 4}
              textAnchor="end"
              className="fill-current text-[11px]"
            >
              {t}
            </text>
          </g>
        ))}
        {category === "total" && reference && (
          <line
            data-testid="qol-reference-line"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={chartY(reference.total, max, PAD.top, plotH)}
            y2={chartY(reference.total, max, PAD.top, plotH)}
            className="stroke-muted-foreground"
            strokeDasharray="6 4"
            strokeWidth="1.5"
          />
        )}
        {xy.length > 1 && (
          <polyline
            points={xy.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            className="stroke-primary"
            strokeWidth="2"
          />
        )}
        {xy.map(([x, y], i) => (
          <circle key={points[i].id} cx={x} cy={y} r="4" className="fill-primary" />
        ))}
        <text
          x={PAD.left}
          y={H - 10}
          className="fill-current text-[11px]"
        >
          {practiceTimestamp(points[0].assessedAt)}
        </text>
        {points.length > 1 && (
          <text
            x={W - PAD.right}
            y={H - 10}
            textAnchor="end"
            className="fill-current text-[11px]"
          >
            {practiceTimestamp(points[points.length - 1].assessedAt)}
          </text>
        )}
      </svg>
      <figcaption className="text-sm text-muted-foreground">
        {name}: latest {values[values.length - 1]} / {max}
        {change !== null &&
          ` (${signedChange(change)} since the previous signed assessment)`}
        . Scale 0–{max}; signed assessments only.
      </figcaption>
    </figure>
  );
}
function ReferenceNotice({
  reference,
}: {
  reference: { total: number; label: string } | null;
}) {
  if (!reference) return null;
  return (
    <p
      className="rounded-md border border-dashed p-3 text-sm"
      data-testid="qol-reference-notice"
    >
      Practice-configured reference line at total {reference.total}:{" "}
      {reference.label}. Configured setting, pending Dr. Susan Edler’s clinical
      review; it is not a recommendation for this patient.
    </p>
  );
}
function ReferenceSettings({ setting }: { setting: QolScaleReference }) {
  const state = useCareMutation("qol-scale-reference");
  const [initial] = useState(() => ({
    enabled: setting.enabled,
    total:
      setting.reference_total === null ? "" : String(setting.reference_total),
    label: setting.reference_label,
    note: setting.review_note,
  }));
  const [form, setForm] = useState(initial);
  const [validation, setValidation] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useCareDirty("qol-scale-reference", dirty || state.locked);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setValidation("");
    if (state.uncertain) {
      await state.retry();
      return;
    }
    const raw = form.total.trim();
    const total = raw ? Number(raw) : null;
    if (
      total !== null &&
      (!/^\d{1,2}$/.test(raw) || total > QOL_SCALE_MAX_TOTAL)
    ) {
      setValidation("Reference total must be a whole number from 0 to 70.");
      return;
    }
    await state.run("save_qol_scale_reference", {
      p_expected_version: setting.version,
      p_enabled: form.enabled,
      p_reference_total: total,
      p_reference_label: form.label,
      p_review_note: form.note,
    });
  }
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Practice reference line (administrators)
      </summary>
      <form onSubmit={save} className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Optional. No reference total or wording is supplied by this software.
          Enter only wording Dr. Susan Edler has reviewed; it is always shown as
          pending clinical review and never as advice for a patient.
        </p>
        <fieldset disabled={state.locked} className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Show reference line on trend
          </label>
          <StockField label="Reference total (0–70)">
            <Input
              inputMode="numeric"
              value={form.total}
              onChange={(e) => setForm({ ...form, total: e.target.value })}
            />
          </StockField>
          <StockField label="Reference wording">
            <Input
              maxLength={300}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </StockField>
          <StockField label="Review note (who reviewed, when)">
            <Textarea
              maxLength={2000}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </StockField>
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
        {state.success && !dirty && (
          <p className="text-sm">Reference setting saved.</p>
        )}
        <Button disabled={state.busy || (!dirty && !state.uncertain)}>
          {state.uncertain ? "Retry same setting" : "Save reference setting"}
        </Button>
      </form>
    </details>
  );
}
export function QolScaleCard({ petId }: { petId: string }) {
  const { hasRole } = useAuth();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<QolScaleAssessment | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [category, setCategory] = useState<QolScaleCategory | "total">(
    "total",
  );
  const [error, setError] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const list = useQuery({
    queryKey: ["care-charts", "qol-scale", petId, page],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_qol_scale_assessments")
        .select("*")
        .eq("pet_id", petId)
        .order("assessed_at", { ascending: false })
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE);
      if (error) throw error;
      return data;
    },
  });
  const trend = useQuery({
    queryKey: ["care-charts", "qol-scale-trend", petId],
    queryFn: async () => {
      const { data, error } = await care
        .from("patient_qol_scale_assessments")
        .select("*")
        .eq("pet_id", petId)
        .eq("status", "signed")
        .order("assessed_at", { ascending: false })
        .order("id")
        .limit(TREND_LIMIT);
      if (error) throw error;
      return data;
    },
  });
  const settings = useQuery({
    queryKey: ["care-charts", "qol-scale-reference"],
    queryFn: async () => {
      const { data, error } = await care
        .from("qol_scale_reference_settings")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const points = qolTrend(trend.data ?? []);
  const reference = activeReference(settings.data);
  function openAssessment(row: QolScaleAssessment | null) {
    setSelected(row);
    setEditorKey((k) => k + 1);
    setOpen(true);
  }
  async function reload() {
    setError("");
    try {
      if (selected) {
        const { data, error } = await care
          .from("patient_qol_scale_assessments")
          .select("*")
          .eq("id", selected.id)
          .eq("pet_id", petId)
          .single();
        if (error) throw error;
        setSelected(data);
      }
      setEditorKey((k) => k + 1);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  const history = [...points].reverse();
  return (
    <Card data-testid="qol-scale-card">
      <CardHeader>
        <CardTitle>HHHHHMM quality-of-life scale</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Villalobos HHHHHMM scale: Hurt, Hunger, Hydration, Hygiene,
          Happiness, Mobility and More good days than bad, each scored 0–10
          (total 0–70). {PENDING_REVIEW}
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={() => {
            if (
              editorDirty &&
              !window.confirm("Discard unsaved HHHHHMM scores?")
            )
              return;
            openAssessment(null);
          }}
        >
          New HHHHHMM assessment
        </Button>
        {open && (
          <QolScaleEditor
            key={editorKey}
            petId={petId}
            record={selected}
            close={() => setOpen(false)}
            reload={reload}
            onDirty={setEditorDirty}
          />
        )}
        <section aria-labelledby="qol-trend-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 id="qol-trend-heading" className="font-semibold">
              Trend
            </h3>
            <StockField label="Trend series">
              <select
                className={selectClass}
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as QolScaleCategory | "total")
                }
              >
                <option value="total">Total (0–70)</option>
                {QOL_SCALE_CATEGORIES.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label} (0–10)
                  </option>
                ))}
              </select>
            </StockField>
          </div>
          {trend.error && <p role="alert">{errorMessage(trend.error)}</p>}
          {settings.error && (
            <p role="alert">
              Reference setting could not load: {errorMessage(settings.error)}
            </p>
          )}
          <QolTrendChart
            points={points}
            category={category}
            reference={reference}
          />
          {category === "total" && <ReferenceNotice reference={reference} />}
          {(trend.data?.length ?? 0) >= TREND_LIMIT && (
            <p className="text-sm">
              Showing the {TREND_LIMIT} most recent signed assessments.
            </p>
          )}
          {history.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">
                  Per-category history of signed HHHHHMM assessments, newest
                  first
                </caption>
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="p-1">
                      Assessed
                    </th>
                    {QOL_SCALE_CATEGORIES.map(({ key, label }) => (
                      <th key={key} scope="col" className="p-1">
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="p-1">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((p) => (
                    <tr key={p.id} className="border-t">
                      <th scope="row" className="p-1 text-left font-normal">
                        {practiceTimestamp(p.assessedAt)}
                      </th>
                      {QOL_SCALE_CATEGORIES.map(({ key }) => (
                        <td key={key} className="p-1">
                          {p.scores[key]}
                        </td>
                      ))}
                      <td className="p-1 font-medium">{p.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section aria-labelledby="qol-assessments-heading" className="space-y-2">
          <h3 id="qol-assessments-heading" className="font-semibold">
            Assessments
          </h3>
          {list.error && <p role="alert">{errorMessage(list.error)}</p>}
          {list.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No HHHHHMM assessments recorded.
            </p>
          )}
          {list.data?.slice(0, PAGE).map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <span>
                {practiceTimestamp(r.assessed_at)} · {r.assessor} ·{" "}
                {r.total === null
                  ? "total pending"
                  : `total ${r.total} / ${QOL_SCALE_MAX_TOTAL}`}{" "}
                · {r.status}
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    editorDirty &&
                    !window.confirm("Discard unsaved HHHHHMM scores?")
                  )
                    return;
                  openAssessment(r);
                }}
              >
                {r.status === "signed"
                  ? "View signed assessment"
                  : "Open assessment draft"}
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
            >
              Newer assessments
            </Button>
            <Button
              variant="outline"
              disabled={(list.data?.length ?? 0) <= PAGE}
              onClick={() => setPage((p) => p + 1)}
            >
              Older assessments
            </Button>
          </div>
        </section>
        {hasRole("ADMIN") && settings.data && (
          <ReferenceSettings
            key={settings.data.version}
            setting={settings.data}
          />
        )}
      </CardContent>
    </Card>
  );
}
