/** Validate private input and fixed loopback configuration before importing SDK code. */
import { createRoot } from "react-dom/client";
import { localAuthenticatedClinicalInputSchema, type LocalAuthenticatedClinicalInput } from "./local-authenticated-clinical-input";
import "../../src/index.css";

const input = (() => {
  try { const parsed = localAuthenticatedClinicalInputSchema.safeParse(window.__LRV_LOCAL_CLINICAL_INPUT__); return parsed.success ? parsed.data : null; }
  catch { return null; }
})();
const unavailable = () => createRoot(document.getElementById("root")!).render(<main className="p-8"><p>Private disposable local SDK configuration is required. No API request was sent.</p></main>);
if (!input || import.meta.env.VITE_SUPABASE_URL !== input.origin || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY !== input.anonKey) unavailable();
else void import("./record-review-authenticated-clinical-app").then(module => {
  const StaffProof = module.AuthenticatedClinicalProof;
  createRoot(document.getElementById("root")!).render(<StaffProof input={input as LocalAuthenticatedClinicalInput} />);
})
  .catch(() => createRoot(document.getElementById("root")!).render(<main className="p-8"><p>The local staff proof could not start.</p></main>));
