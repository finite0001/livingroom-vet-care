import { useEffect } from "react";

/** Scroll the requested section into view once its tab has rendered. */
export function useScrollToSection(tab: string, section: string | null) {
  useEffect(() => {
    if (!section) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`p360-${section}`);
      if (!target || target.closest("[hidden]")) return;
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab, section]);
}
