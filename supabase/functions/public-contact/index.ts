import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createContactHandler } from "./handler.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);
const list = (key: string) =>
  (Deno.env.get(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
Deno.serve(
  createContactHandler(
    {
      secret: Deno.env.get("CONTACT_TURNSTILE_SECRET") ?? "",
      emailHashSecret: Deno.env.get("CONTACT_EMAIL_HASH_SECRET") ?? "",
      allowedOrigins: list("CONTACT_ALLOWED_ORIGINS"),
      allowedHostnames: list("CONTACT_ALLOWED_HOSTNAMES"),
    },
    {
      async consumeBudget() {
        const { data, error } = await db.rpc("consume_contact_intake_budget");
        if (error) throw error;
        return data === true;
      },
      async receipt(id, hash) {
        const { data, error } = await db.rpc("contact_intake_receipt", {
          p_request_id: id,
          p_capability_hash: hash,
        });
        if (error) throw error;
        if (typeof data?.received !== "boolean")
          throw new Error("Invalid receipt");
        return data;
      },
      async accept(id, hash, emailHash, payload) {
        const { data, error } = await db.rpc("accept_contact_intake", {
          p_request_id: id,
          p_capability_hash: hash,
          p_email_budget_hash: emailHash,
          p_payload: payload,
        });
        if (error) throw error;
        if (typeof data?.received !== "boolean")
          throw new Error("Invalid receipt");
        return data;
      },
    },
  ),
);
