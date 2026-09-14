import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createHandler({ env: key => Deno.env.get(key), gateway: {
  async authenticate(bearer) {
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data.user) return null;
    const [{ data: active, error: activeError }, { data: dvm, error: dvmError }] = await Promise.all([
      admin.rpc("is_active_staff", { _user_id: data.user.id }), admin.rpc("has_role", { _user_id: data.user.id, _role: "DVM" }),
    ]);
    if (activeError) throw activeError; if (dvmError) throw dvmError;
    return { id: data.user.id, activeDvm: active === true && dvm === true };
  },
  async context(recordId, petId, actor) {
    const { data, error } = await admin.rpc("get_ezyvet_attachment_original_review_context", { p_record_id: recordId, p_pet_id: petId, p_actor: actor });
    if (error) throw error;
    return data;
  },
  async readOriginal(original) {
    const path = `${encodeURIComponent(original.bucket_id)}/${original.object_path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(`${url}/storage/v1/object/authenticated/${path}`, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Accept-Encoding": "identity" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw new Error("Private chart original unavailable"); }
    return response;
  },
} }));
