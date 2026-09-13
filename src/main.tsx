import { createRoot } from "react-dom/client";
import "./index.css";

// Client capabilities stay outside the staff router, auth storage and marketing imports.
if (window.location.pathname.startsWith("/shared/")) {
  const grantId = window.location.pathname.slice("/shared/".length);
  const token = window.location.hash.slice(1);
  window.history.replaceState(null, "", window.location.pathname);
  const referrer = document.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  document.head.appendChild(referrer);
  document.title = "Your documents · The Living Room Vet";
  void import("./shared/SharedDocumentsPage.tsx").then(({ default: SharedDocumentsPage }) => {
    createRoot(document.getElementById("root")!).render(<SharedDocumentsPage grantId={grantId} token={token} />);
  });
} else {
  void import("./App.tsx").then(({ default: App }) => {
    createRoot(document.getElementById("root")!).render(<App />);
  });
}
