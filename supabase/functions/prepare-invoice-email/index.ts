import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createPrepareInvoiceEmailHandler } from "../_shared/prepare-invoice-email.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(
  createPrepareInvoiceEmailHandler({
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
    practice: {
      name: "The Living Room Vet",
      address: "2619 Spruce Street, Boulder, CO",
      domain: "thelivingroom.vet",
    },
    sender: {
      from: Deno.env.get("RESEND_FROM") || "",
      replyTo: Deno.env.get("RESEND_REPLY_TO") || "",
    },
  }),
);
