// HHHHHMM quality-of-life scale (Villalobos). Category names follow the published scale; the
// practice has not approved any interpretation, so this module only sums and orders scores.
export const QOL_SCALE_CATEGORIES = [
  { key: "hurt", label: "Hurt" },
  { key: "hunger", label: "Hunger" },
  { key: "hydration", label: "Hydration" },
  { key: "hygiene", label: "Hygiene" },
  { key: "happiness", label: "Happiness" },
  { key: "mobility", label: "Mobility" },
  { key: "more_good_days", label: "More good days than bad" },
] as const;
export type QolScaleCategory = (typeof QOL_SCALE_CATEGORIES)[number]["key"];
export type QolScaleScores = Record<QolScaleCategory, number | null>;
export const QOL_SCALE_MAX_SCORE = 10;
export const QOL_SCALE_MAX_TOTAL =
  QOL_SCALE_MAX_SCORE * QOL_SCALE_CATEGORIES.length;
/** Blank → null (unscored draft); otherwise a whole number 0–10. */
export function parseQolScore(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,2}$/.test(trimmed) || Number(trimmed) > QOL_SCALE_MAX_SCORE)
    throw new Error("Each category score must be a whole number from 0 to 10.");
  return Number(trimmed);
}
export function scoredCount(scores: QolScaleScores): number {
  return QOL_SCALE_CATEGORIES.filter(({ key }) => scores[key] !== null).length;
}
/** Total only when all seven categories are scored, matching the database's generated column. */
export function qolTotal(scores: QolScaleScores): number | null {
  let total = 0;
  for (const { key } of QOL_SCALE_CATEGORIES) {
    const value = scores[key];
    if (value === null) return null;
    total += value;
  }
  return total;
}
export function unscoredCategories(scores: QolScaleScores): string[] {
  return QOL_SCALE_CATEGORIES.filter(({ key }) => scores[key] === null).map(
    ({ label }) => label,
  );
}
export interface QolTrendInput extends QolScaleScores {
  id: string;
  assessed_at: string;
  status: string;
}
export interface QolTrendPoint {
  id: string;
  assessedAt: string;
  total: number;
  scores: Record<QolScaleCategory, number>;
}
/** Signed, fully scored assessments in chronological order (ties broken by id for stability). */
export function qolTrend(rows: readonly QolTrendInput[]): QolTrendPoint[] {
  const points: QolTrendPoint[] = [];
  for (const row of rows) {
    if (row.status !== "signed") continue;
    const total = qolTotal(row);
    if (total === null) continue;
    const scores = {} as Record<QolScaleCategory, number>;
    for (const { key } of QOL_SCALE_CATEGORIES) scores[key] = row[key]!;
    points.push({ id: row.id, assessedAt: row.assessed_at, total, scores });
  }
  return points.sort(
    (a, b) =>
      Date.parse(a.assessedAt) - Date.parse(b.assessedAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
/** Change in total or a category between the two most recent points; null when fewer than two. */
export function latestChange(
  points: readonly QolTrendPoint[],
  category?: QolScaleCategory,
): number | null {
  if (points.length < 2) return null;
  const [previous, latest] = points.slice(-2);
  return category
    ? latest.scores[category] - previous.scores[category]
    : latest.total - previous.total;
}
/** Maps a value on [0, max] to an SVG y coordinate inside [top, top+height] (0 at the bottom). */
export function chartY(
  value: number,
  max: number,
  top: number,
  height: number,
): number {
  const clamped = Math.min(max, Math.max(0, value));
  return top + height - (clamped / max) * height;
}
/** Even horizontal spacing; a single point is centered. */
export function chartX(
  index: number,
  count: number,
  left: number,
  width: number,
): number {
  return count <= 1 ? left + width / 2 : left + (index / (count - 1)) * width;
}
export interface QolReferenceSetting {
  enabled: boolean;
  reference_total: number | null;
  reference_label: string;
  review_note: string;
}
/** A practice reference is shown only when an administrator has fully configured it. */
export function activeReference(
  setting: QolReferenceSetting | null | undefined,
): { total: number; label: string } | null {
  if (!setting?.enabled || setting.reference_total === null) return null;
  const label = setting.reference_label.trim();
  if (!label || !setting.review_note.trim()) return null;
  if (
    !Number.isInteger(setting.reference_total) ||
    setting.reference_total < 0 ||
    setting.reference_total > QOL_SCALE_MAX_TOTAL
  )
    return null;
  return { total: setting.reference_total, label };
}
