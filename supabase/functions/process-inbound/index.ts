import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processOneInbound } from "../_shared/inbound/process.ts";
serve(async (req) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (
    req.method !== "POST" ||
    !key ||
    req.headers.get("Authorization") !== `Bearer ${key}`
  )
    return new Response("Service authorization required", { status: 401 });
  try {
    const result = await processOneInbound(
      createClient(Deno.env.get("SUPABASE_URL")!, key),
      {
        RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
        TWILIO_ACCOUNT_SID: Deno.env.get("TWILIO_ACCOUNT_SID"),
        TWILIO_AUTH_TOKEN: Deno.env.get("TWILIO_AUTH_TOKEN"),
      },
    );
    return Response.json(result);
  } catch {
    return Response.json(
      { error: "Inbound persistence unavailable; retry required" },
      { status: 503 },
    );
  }
});
