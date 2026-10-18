import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createClinicalCallNoteHandler } from "../_shared/clinical-call-note-handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function serviceRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data;
}
Deno.serve(createClinicalCallNoteHandler({
  enabled: Deno.env.get("CLINICAL_NOTE_PROCESSING_ENABLED") === "true",
  callEnabled: Deno.env.get("CLINICAL_CALL_NOTE_PROCESSING_ENABLED") === "true",
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
      read: (id) => call("read_clinical_call_note_processing_v1", { p_actor_id: data.user.id, p_id: id }),
      claim: (id, request) => call("claim_clinical_call_note_v1", { p_actor_id: data.user.id, p_id: id, p_request: request }),
    };
  },
  dispatch: async (jobId, attemptId) => {
    const value = await serviceRpc("dispatch_clinical_call_note_v1", { p_job_id: jobId, p_attempt_id: attemptId });
    if (typeof value !== "boolean") throw Error("Invalid private call dispatch receipt.");
    return value;
  },
  finish: (jobId, attemptId, result) => serviceRpc("finish_clinical_call_note_v1", {
    p_job_id: jobId, p_attempt_id: attemptId, p_result: result,
  }),
  fail: async (jobId, attemptId, uncertain, code, details) => {
    await serviceRpc("fail_clinical_call_note_v1", {
      p_job_id: jobId, p_attempt_id: attemptId, p_uncertain: uncertain, p_code: code, p_details: details,
    });
  },
}));
