import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createPrepareReleaseEmailHandler } from "../_shared/prepare-release-email.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(
  createPrepareReleaseEmailHandler({
    service,
    authenticate: async (token) => {
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) return null;
      return {
        actorId: data.user.id,
        db: createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      };
    },
    download: async (bucket, path, expectedSize) => {
      const { data, error } = await service.storage.from(bucket).download(path);
      if (error) throw error;
      if (!data || data.size !== expectedSize)
        throw new Error("Original size mismatch");
      return new Uint8Array(await data.arrayBuffer());
    },
    sender: {
      from: Deno.env.get("RESEND_FROM") || "",
      replyTo: Deno.env.get("RESEND_REPLY_TO") || "",
    },
  }),
);
