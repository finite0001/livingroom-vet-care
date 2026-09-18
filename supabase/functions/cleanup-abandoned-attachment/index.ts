import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createAbandonedCleanupHandler } from "../_shared/cleanup-abandoned-handler.ts";
import { runAbandonedUploadCleanup } from "../_shared/abandoned-cleanup-adapter.ts";
Deno.serve(createAbandonedCleanupHandler(Deno.env.toObject(), async (uploadId, graceHours, credential) => {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, credential, { auth: { persistSession: false, autoRefreshToken: false } });
  return await runAbandonedUploadCleanup(client, uploadId, graceHours);
}));
