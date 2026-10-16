import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createInvoiceReminderHandler } from "../_shared/invoice-reminder-handler.ts";
Deno.serve(
  createInvoiceReminderHandler(
    {
      SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      INVOICE_REMINDERS_ENABLED: Deno.env.get("INVOICE_REMINDERS_ENABLED"),
      APP_ENV: Deno.env.get("APP_ENV"),
    },
    (key) => {
      const url = new URL(Deno.env.get("SUPABASE_URL")!);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/" ||
        !(
          (url.protocol === "https:" &&
            [
              "mgadheotkdnrsatfivjy.supabase.co",
              "kothoqicubowyhwfsrte.supabase.co",
            ].includes(url.hostname)) ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "kong"].includes(url.hostname))
        )
      )
        throw new Error("Known practice backend required");
      return createClient(url.origin, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    },
  ),
);
