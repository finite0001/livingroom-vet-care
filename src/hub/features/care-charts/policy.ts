export function measurement(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(n) || n < 0)
    throw new Error("Measurements must be finite, nonnegative millimeters.");
  return n;
}
export function coordinate(value: string): number {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n < 0 || n > 1)
    throw new Error("Schematic coordinates must be between 0 and 1.");
  return n;
}
export function moveCoordinate(value: number, delta: number): number {
  return Math.min(1, Math.max(0, Math.round((value + delta) * 100) / 100));
}
