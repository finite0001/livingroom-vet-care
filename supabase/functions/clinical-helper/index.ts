import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createClinicalHelperHandler } from "../_shared/clinical-helper-handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(
  createClinicalHelperHandler({
    enabled: Deno.env.get("CLINICAL_HELPER_ENABLED") === "true",
    apiKey: Deno.env.get("OPENAI_API_KEY"),
    model: Deno.env.get("CLINICAL_HELPER_MODEL"),
    authenticate: async (token) => {
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) return null;
      const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return {
        claim: async (id, pet, kind, selection) => {
          const { data, error } = await user.rpc("claim_clinical_helper", {
            p_id: id,
            p_pet_id: pet,
            p_kind: kind,
            p_data: selection,
          });
          if (error) throw new Error(error.message);
          return data;
        },
      };
    },
    finish: async (id, result, model, failure) => {
      const { error } = await service.rpc("finish_clinical_helper", {
        p_id: id,
        p_result: result,
        p_model: model,
        p_failure: failure,
      });
      if (error) throw new Error("Draft persistence could not be confirmed");
    },
  }),
);
