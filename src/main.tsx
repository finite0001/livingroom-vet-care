import { createRoot } from "react-dom/client";
import "./index.css";
import { paymentRoute, validPaymentAccess } from "./shared/payment-client";
import { bootstrapEstimateDecisionAccess } from "./shared/estimate-decision-public-api";

// Strip private estimate access before importing a page, staff auth or marketing.
const estimateAccess = bootstrapEstimateDecisionAccess(window);

const paymentAccess = paymentRoute(
  window.location.pathname,
  window.location.hash,
);
if (estimateAccess) {
  const referrer = document.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  document.head.appendChild(referrer);
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow, noarchive";
  document.head.appendChild(robots);
  document.title = "Your estimate · The Living Room Vet";
  void import("./shared/EstimateDecisionPage.tsx").then(
    ({ default: EstimateDecisionPage }) => {
      createRoot(document.getElementById("root")!).render(
        <EstimateDecisionPage access={estimateAccess} />,
      );
    },
  ).catch(() => {
    estimateAccess.retire();
    const root = document.getElementById("root");
    if (root) {
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = "Your estimate could not be opened. Please reopen the original link or contact the practice.";
      root.replaceChildren(message);
    }
  });
} else if (paymentAccess) {
  if (!validPaymentAccess(paymentAccess)) paymentAccess.token = "";
  window.addEventListener(
    "pagehide",
    () => {
      paymentAccess.token = "";
    },
    { once: true },
  );
  window.addEventListener("hashchange", () => {
    paymentAccess.token = "";
    window.history.replaceState(null, "", window.location.pathname);
  });
  window.history.replaceState(null, "", window.location.pathname);
  const referrer = document.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  document.head.appendChild(referrer);
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow, noarchive";
  document.head.appendChild(robots);
  document.title = "Your payment · The Living Room Vet";
  void import("./shared/PaymentPage.tsx").then(({ default: PaymentPage }) => {
    createRoot(document.getElementById("root")!).render(
      <PaymentPage access={paymentAccess} />,
    );
  });
} else if (window.location.pathname.startsWith("/shared/")) {
  // Client capabilities stay outside the staff router, auth storage and marketing imports.
  const grantId = window.location.pathname.slice("/shared/".length);
  const token = window.location.hash.slice(1);
  window.history.replaceState(null, "", window.location.pathname);
  const referrer = document.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  document.head.appendChild(referrer);
  document.title = "Your documents · The Living Room Vet";
  void import("./shared/SharedDocumentsPage.tsx").then(
    ({ default: SharedDocumentsPage }) => {
      createRoot(document.getElementById("root")!).render(
        <SharedDocumentsPage grantId={grantId} token={token} />,
      );
    },
  );
} else {
  void import("./App.tsx").then(({ default: App }) => {
    createRoot(document.getElementById("root")!).render(<App />);
  });
}
