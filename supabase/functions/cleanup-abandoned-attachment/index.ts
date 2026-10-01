import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createAbandonedCleanupHandler } from "../_shared/cleanup-abandoned-handler.ts";
import { discoverAbandonedUploads, runAbandonedUploadCleanup } from "../_shared/abandoned-cleanup-adapter.ts";
const client = (credential: string) =>
  createClient(Deno.env.get("SUPABASE_URL")!, credential, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createAbandonedCleanupHandler(Deno.env.toObject(),
  async (uploadId, graceHours, credential) => await runAbandonedUploadCleanup(client(credential), uploadId, graceHours),
  async (graceHours, limit, credential) => await discoverAbandonedUploads(client(credential), graceHours, limit)));
