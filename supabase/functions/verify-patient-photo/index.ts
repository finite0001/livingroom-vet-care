import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createPatientPhotoVerificationHandler } from "../_shared/patient-photo-verification.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createPatientPhotoVerificationHandler({
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      actorId: data.user.id,
      read: async (id) => {
        const { data, error } = await user.rpc("read_patient_photo_upload", {
          p_id: id,
        });
        if (error) throw error;
        return data;
      },
      download: async (path) => {
        const { data, error } = await user.storage.from("patient-documents")
          .download(path);
        if (error) throw error;
        if (!data) throw new Error("Image unavailable");
        return data;
      },
    };
  },
  verify: async (args) => {
    const { data, error } = await service.rpc(
      "verify_patient_photo_bytes",
      args,
    );
    if (error) throw error;
    return data;
  },
}));
