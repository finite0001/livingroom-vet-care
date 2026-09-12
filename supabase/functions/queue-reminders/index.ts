import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createReminderSchedulerHandler } from "../_shared/reminder-scheduler.ts";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
serve(
  createReminderSchedulerHandler(
    {
      SUPABASE_SERVICE_ROLE_KEY: key,
      REMINDER_SCHEDULER_ENABLED: Deno.env.get("REMINDER_SCHEDULER_ENABLED"),
      APP_ENV: Deno.env.get("APP_ENV"),
    },
    () => createClient(Deno.env.get("SUPABASE_URL")!, key!),
  ),
);
