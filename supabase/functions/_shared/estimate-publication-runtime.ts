import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import type { EstimatePublicationDependencies } from "./estimate-publication-http.ts";
export function estimatePublicationRuntime(): EstimatePublicationDependencies {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return { service, authenticate: async token => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    return { actorId: data.user.id, db: createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
    }) };
  } };
}
