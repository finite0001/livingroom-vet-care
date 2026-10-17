import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createClinicalNoteHandler } from "../_shared/clinical-note-handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function serviceRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data;
}
Deno.serve(createClinicalNoteHandler({
  enabled: Deno.env.get("CLINICAL_NOTE_PROCESSING_ENABLED") === "true",
  audioEnabled: Deno.env.get("CLINICAL_AUDIO_PROCESSING_ENABLED") === "true",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await user.rpc(name, args);
      if (error) throw error;
      return data;
    };
    return {
      actorId: data.user.id,
      read: (id) =>
        call("read_clinical_note_job", { p_actor_id: data.user.id, p_id: id }),
      claim: (args) => call("claim_clinical_note", args),
    };
  },
  dispatch: async (id) => {
    const v = await serviceRpc("dispatch_clinical_note", { p_id: id });
    if (typeof v !== "boolean") throw Error("Invalid dispatch receipt");
    return v;
  },
  finish: (id, result) =>
    serviceRpc("finish_clinical_note", { p_id: id, p_result: result }),
  fail: async (id, uncertain, code, details) => {
    await serviceRpc("fail_clinical_note", {
      p_id: id,
      p_uncertain: uncertain,
      p_code: code,
      p_details: details ?? {},
    });
  },
}));
