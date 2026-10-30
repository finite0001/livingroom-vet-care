/** Validate loopback configuration before importing any SDK code. */
import { createRoot } from "react-dom/client";
import { narcoticsAuthenticatedInputSchema, type NarcoticsAuthenticatedInput } from "./narcotics-authenticated-input";
import "../../src/index.css";
const input = (() => {
  try { const result = narcoticsAuthenticatedInputSchema.safeParse(window.__LRV_NARCOTICS_LOCAL_INPUT__); return result.success ? result.data : null; }
  catch { return null; }
})();
const root = createRoot(document.getElementById("root")!);
if (!input || import.meta.env.VITE_SUPABASE_URL !== input.origin || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY !== input.anonKey)
  root.render(<main className="p-4">Private disposable local configuration is required. No request was sent.</main>);
else void import("./narcotics-authenticated-app").then(({ NarcoticsAuthenticatedProof }) => root.render(<NarcoticsAuthenticatedProof input={input as NarcoticsAuthenticatedInput} />))
  .catch(() => root.render(<main className="p-4">The local staff verification could not start.</main>));
