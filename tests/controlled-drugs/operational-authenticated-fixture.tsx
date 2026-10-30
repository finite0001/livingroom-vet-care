/** Closed local SDK entry. No credentials or fabricated sessions enter this input. */
import { createRoot } from "react-dom/client";
import { narcoticsAuthenticatedInputSchema, type NarcoticsAuthenticatedInput } from "./narcotics-authenticated-input";
import "../../src/index.css";

declare global { interface Window { __LRV_OPERATIONAL_LOCAL_INPUT__?: unknown } }
const input = narcoticsAuthenticatedInputSchema.safeParse(window.__LRV_OPERATIONAL_LOCAL_INPUT__);
const root = createRoot(document.getElementById("root")!);
if (!input.success || import.meta.env.VITE_SUPABASE_URL !== input.data.origin || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY !== input.data.anonKey)
  root.render(<main>Private disposable local configuration is required. No request was sent.</main>);
else void import("./operational-authenticated-app").then(({ OperationalAuthenticatedProof }) => root.render(<OperationalAuthenticatedProof input={input.data as NarcoticsAuthenticatedInput} />))
  .catch(() => root.render(<main>The local authenticated operational verification could not start.</main>));
