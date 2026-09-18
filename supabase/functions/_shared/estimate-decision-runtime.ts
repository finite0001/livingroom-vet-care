import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { estimateDecisionConfig } from "./estimate-decision-capability.ts";
import { createEstimateDecisionHandler } from "./estimate-decision-http.ts";
import { createEstimateDecisionLimiter } from "./estimate-decision-limiter.ts";

export function estimateDecisionRuntime(): (request: Request) => Promise<Response> {
  try {
    const config = estimateDecisionConfig({
      origin: Deno.env.get("ESTIMATE_DECISION_ORIGIN"),
      activeKeyVersion: Deno.env.get("ESTIMATE_DECISION_ACTIVE_KEY_VERSION"),
      keys: Deno.env.get("ESTIMATE_DECISION_KEYS"),
      publicEnabled: Deno.env.get("ESTIMATE_DECISION_PUBLIC_ENABLED"),
      issuanceEnabled: Deno.env.get("ESTIMATE_DECISION_ISSUANCE_ENABLED"),
    });
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return createEstimateDecisionHandler({ db, config, rateLimit: createEstimateDecisionLimiter() });
  } catch {
    // Missing commissioning configuration must not leak environment values or
    // accidentally turn a public endpoint into an authenticated staff endpoint.
    return async () => new Response(JSON.stringify({ error: "Estimate access unavailable" }), {
      status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
    });
  }
}
