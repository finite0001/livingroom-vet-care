import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createClinicalCallHandler } from "../_shared/clinical-call-handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
async function serviceRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args); if (error) throw error; return data;
}
const key = Deno.env.get("CLOUDTALK_API_KEY_ID"), secret = Deno.env.get("CLOUDTALK_API_KEY_SECRET");
Deno.serve(createClinicalCallHandler({
  enabled: Deno.env.get("CLINICAL_CALL_CAPTURE_ENABLED") === "true",
  credentials: key && secret ? btoa(`${key}:${secret}`) : undefined,
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token); if (error || !data.user) return null;
    const actorId = data.user.id;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    return { actorId, read: async (id) => { const { data, error } = await user.rpc("read_clinical_call_capture", { p_actor_id: actorId, p_id: id }); if (error) throw error; return data; } };
  },
  dispatch: (id) => serviceRpc("dispatch_clinical_call_capture", { p_id: id }),
  finish: (id, document) => serviceRpc("finish_clinical_call_capture", { p_id: id, p_document: document }),
  fail: async (id, code) => { await serviceRpc("fail_clinical_call_capture", { p_id: id, p_code: code }); },
}));
