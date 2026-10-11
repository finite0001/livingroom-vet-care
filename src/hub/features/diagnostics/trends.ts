import type { FinalizedPanel, Observation } from "./model";
export interface TrendPoint {
  panel: FinalizedPanel;
  finding: Observation;
  day: string;
}
export interface TrendSeries {
  key: string;
  label: string;
  analyteKey: string;
  specimen: string;
  method: string;
  source: string;
  unit: string | null;
  kind: "numeric" | "qualitative";
  points: TrendPoint[];
}
/** Original identity/unit/specimen/method/source are exact; aliases/conversions are not inferred. */
export function comparableSeries(panels: FinalizedPanel[]): TrendSeries[] {
  if (new Set(panels.map((p) => p.pet_id)).size > 1)
    throw new Error("Diagnostic series must belong to one patient");
  const groups = new Map<string, TrendSeries>();
  const seen = new Set<string>();
  for (const panel of panels) {
    if (seen.has(panel.panel_id))
      throw new Error("Duplicate current diagnostic panel in trend census");
    seen.add(panel.panel_id);
    for (const finding of panel.snapshot.observations) {
      const s = panel.snapshot;
      const key = JSON.stringify([
        s.category,
        finding.analyte_key,
        s.specimen,
        s.method,
        s.source,
        finding.unit,
        finding.kind,
      ]);
      let series = groups.get(key);
      if (!series) {
        series = {
          key,
          label: finding.label,
          analyteKey: finding.analyte_key,
          specimen: s.specimen,
          method: s.method,
          source: s.source,
          unit: finding.unit,
          kind: finding.kind,
          points: [],
        };
        groups.set(key, series);
      }
      series.points.push({ panel, finding, day: s.collected_on });
    }
  }
  return [...groups.values()]
    .map((s) => ({
      ...s,
      points: s.points.sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.panel.panel_id.localeCompare(b.panel.panel_id),
      ),
    }))
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
    );
}
export interface PlotPoint extends TrendPoint {
  x: number;
  y: number;
}
export function plotPoints(series: TrendSeries): PlotPoint[] {
  if (series.kind !== "numeric") return [];
  const points = series.points.filter((p) => p.finding.value_number !== null);
  if (!points.length) return [];
  const times = points.map((p) => Date.parse(p.day + "T12:00:00Z"));
  const values = points.map((p) => p.finding.value_number!);
  const low = Math.min(...values),
    high = Math.max(...values);
  const first = Math.min(...times),
    last = Math.max(...times);
  return points.map((p, i) => ({
    ...p,
    x: 40 + (last === first ? 0.5 : (times[i] - first) / (last - first)) * 520,
    y: 140 - (high === low ? 0.5 : (values[i] - low) / (high - low)) * 110,
  }));
}
