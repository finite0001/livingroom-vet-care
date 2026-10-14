import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createOperationalReconciliationHandler } from "../_shared/operational-reconciliation-handler.ts";

Deno.serve(createOperationalReconciliationHandler({
  SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  OPERATIONAL_RECONCILIATION_ENABLED: Deno.env.get(
    "OPERATIONAL_RECONCILIATION_ENABLED",
  ),
  APP_ENV: Deno.env.get("APP_ENV"),
}, (key) => {
  // Validate lazily: a disabled worker creates no client or database request.
  const url = new URL(Deno.env.get("SUPABASE_URL")!);
  if (
    url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || !(
      (url.protocol === "https:" &&
        ["kothoqicubowyhwfsrte.supabase.co", "mgadheotkdnrsatfivjy.supabase.co"]
          .includes(url.hostname)) ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "kong"].includes(url.hostname))
    )
  ) throw new Error("Known practice backend required");
  return createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}));
