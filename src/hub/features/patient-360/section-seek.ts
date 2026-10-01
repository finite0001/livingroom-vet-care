/**
 * Frame-driven search for a deep-link target that may not exist yet.
 *
 * Patient/household 360 pages render a loading state first, so on a cold load
 * the `?section=` element appears some frames later. Phase 1 polls until the
 * element exists (bounded); phase 2 keeps it aligned for a short settle window
 * while content above it finishes loading and shifts the layout. Pure — the
 * scheduler and DOM access are injected so it is unit-testable.
 */
export interface SectionSeekOptions<T> {
  /** Returns the target when it is present and visible, else null. */
  find: () => T | null;
  /** Scrolls the target into view (and focuses it). */
  reveal: (target: T) => void;
  /** Current offset of the target from the viewport top. */
  offset: (target: T) => number;
  schedule: (step: () => void) => number;
  cancel: (handle: number) => void;
  /** Frames to wait for the target to appear (~5s at 60fps). */
  maxTries?: number;
  /** Frames to keep the target aligned after it is first revealed. */
  settleFrames?: number;
  /** Pixel drift that triggers a re-alignment during the settle window. */
  tolerance?: number;
}

export function seekSection<T>({
  find, reveal, offset, schedule, cancel, maxTries = 300, settleFrames = 90, tolerance = 4,
}: SectionSeekOptions<T>): () => void {
  let handle: number | null = null;
  let stopped = false;
  let tries = 0;
  let settled = 0;
  let target: T | null = null;
  let anchor = 0;

  const next = () => {
    if (!stopped) handle = schedule(step);
  };
  function step() {
    handle = null;
    if (stopped) return;
    if (target === null) {
      target = find();
      if (target !== null) {
        reveal(target);
        anchor = offset(target);
        next();
      } else if (tries++ < maxTries) {
        next();
      }
      return;
    }
    if (settled++ >= settleFrames) return;
    const current = offset(target);
    if (Math.abs(current - anchor) > tolerance) {
      reveal(target);
      anchor = offset(target);
    }
    next();
  }

  step();
  return () => {
    stopped = true;
    if (handle !== null) cancel(handle);
  };
}
