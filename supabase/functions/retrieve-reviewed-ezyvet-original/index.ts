import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHandler, type ReviewedContext } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(
  createHandler({
    env: (key) => Deno.env.get(key),
    async authenticate(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
    async context(actor, record, pet, hash) {
      const { data, error } = await client.rpc(
        "get_reviewed_ezyvet_original_context",
        {
          p_actor: actor,
          p_record_id: record,
          p_pet_id: pet,
          p_capture_hash: hash,
        },
      );
      if (error) throw error;
      return data as ReviewedContext;
    },
    async read(context) {
      const path = `${encodeURIComponent(context.bucket_id)}/${context.object_path.split("/").map(encodeURIComponent).join("/")}`;
      return fetch(`${url}/storage/v1/object/authenticated/${path}`, {
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
          "Accept-Encoding": "identity",
        },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    },
  }),
);
