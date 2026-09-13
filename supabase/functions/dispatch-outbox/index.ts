import { authenticateWorker } from "../_shared/worker-auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dispatchOne,
  type OutboxEnvironment,
} from "../_shared/outbox-dispatch.ts";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const key = authenticateWorker(req, {
    SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!key) return json({ error: "Service authorization required" }, 401);
  try {
    const env: OutboxEnvironment = {};
    for (const name of [
      "APP_ENV",
      "DOCUMENT_LINK_ORIGIN",
      "DOCUMENT_LINK_ACTIVE_KEY_VERSION",
      "DOCUMENT_LINK_KEYS",
      "DOCUMENT_LINK_PUBLIC_ENABLED",
      "OUTBOUND_DELIVERY_MODE",
      "OUTBOUND_TEST_EMAILS",
      "OUTBOUND_TEST_PHONES",
      "RESEND_API_KEY",
      "RESEND_FROM",
      "RESEND_REPLY_TO",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
    ] as const)
      env[name] = Deno.env.get(name);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key);
    return json(await dispatchOne(db, env));
  } catch {
    return json(
      {
        error:
          "Dispatch persistence failed; inspect outbox state before retrying.",
        retry_safe: false,
      },
      500,
    );
  }
});
