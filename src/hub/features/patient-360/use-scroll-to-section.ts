import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { seekSection } from "./section-seek";

/**
 * Scroll the requested `?section=` into view once it has rendered.
 *
 * The page may still be loading when the URL changes, so the target is polled
 * for across frames rather than looked up once. Depending on the location key
 * re-runs the seek when the same section link is followed again. Any user
 * scroll input stops the follow-up alignment.
 */
export function useScrollToSection(tab: string, section: string | null) {
  const { key } = useLocation();
  useEffect(() => {
    if (!section) return;
    const stop = seekSection<HTMLElement>({
      find: () => {
        const target = document.getElementById(`p360-${section}`);
        // offsetParent is null while the owning tab is display:none.
        return target && !target.closest("[hidden]") && target.offsetParent !== null ? target : null;
      },
      reveal: (target) => {
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      },
      offset: (target) => target.getBoundingClientRect().top,
      schedule: (step) => window.requestAnimationFrame(step),
      cancel: (handle) => window.cancelAnimationFrame(handle),
    });
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const onUserInput = () => stop();
    for (const name of events) window.addEventListener(name, onUserInput, { passive: true });
    return () => {
      stop();
      for (const name of events) window.removeEventListener(name, onUserInput);
    };
  }, [tab, section, key]);
}
