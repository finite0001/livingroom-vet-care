import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Only known in-page anchors scroll; other hashes (e.g. private access tokens)
// never become element lookups.
const anchors = new Set([
  "#contact-form",
  "#text-messages",
  "#text-message-program",
]);

const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (anchors.has(hash)) {
      // Lazy pages mount after the route changes; wait briefly for the anchor.
      let frame = 0;
      let tries = 0;
      const seek = () => {
        const target = document.getElementById(hash.slice(1));
        if (target) target.scrollIntoView();
        else if (tries++ < 120) frame = requestAnimationFrame(seek);
      };
      seek();
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
