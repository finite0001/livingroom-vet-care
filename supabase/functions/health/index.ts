import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHealthHandler } from "../_shared/health-ping.ts";

// Deployed with verify_jwt = false in supabase/config.toml: an uptime monitor has
// no credential. The handler is public by design and says nothing it should not -
// see _shared/health-ping.ts.
serve(
  createHealthHandler({
    pingDatabase: async () => {
      // The client is built per request rather than at module load: a function
      // that throws while booting cannot report that it is down.
      const client = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
      );
      // One cheap read against a table that always exists. The rows are never
      // returned; this proves the database answered and nothing more.
      const { error } = await client.from("app_settings").select("key").limit(1);
      if (error) throw error;
    },
  }),
);
