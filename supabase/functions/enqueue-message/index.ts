import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeDelivery,
  DeliveryPolicyError,
} from "../_shared/delivery-policy.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      },
    );
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    const input = await req.json();
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            "request_id",
            "conversation_id",
            "channel",
            "to",
            "subject",
            "body",
            "attachment_ids",
          ].includes(key),
      )
    )
      return json({ error: "Invalid outbound fields" }, 400);
    if (
      !["EMAIL", "SMS"].includes(input.channel) ||
      typeof input.request_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.request_id,
      )
    )
      return json({ error: "Channel and stable request UUID required" }, 400);
    authorizeDelivery(
      {
        APP_ENV: Deno.env.get("APP_ENV"),
        OUTBOUND_DELIVERY_MODE: Deno.env.get("OUTBOUND_DELIVERY_MODE"),
        OUTBOUND_TEST_EMAILS: Deno.env.get("OUTBOUND_TEST_EMAILS"),
        OUTBOUND_TEST_PHONES: Deno.env.get("OUTBOUND_TEST_PHONES"),
      },
      input.channel,
      input.to,
    );
    const { data, error } = await db.rpc("enqueue_communication", {
      p_actor_id: user.id,
      p_request_id: input.request_id,
      p_conversation_id: input.conversation_id,
      p_channel: input.channel,
      p_recipient: input.to,
      p_subject: input.subject ?? "",
      p_body: input.body,
      p_attachment_ids: input.attachment_ids ?? [],
    });
    if (error)
      return json(
        {
          error:
            error.code === "23505"
              ? "Request UUID was already used for different content."
              : error.code === "42501"
                ? "Staff access, matching recipient and channel permission required."
                : "Message could not be queued. Keep the same request UUID when retrying unchanged content.",
        },
        error.code === "23505" ? 409 : 400,
      );
    return json(
      {
        success: true,
        queued: true,
        outbox_id: data.id,
        message_id: data.message_id,
        state: data.state,
        accepted: ["accepted", "delivered"].includes(data.state),
        delivered: data.state === "delivered",
      },
      202,
    );
  } catch (error) {
    if (error instanceof DeliveryPolicyError)
      return json({ error: error.message }, error.status);
    return json(
      {
        error:
          "Unable to queue message. Keep the same request UUID when retrying unchanged content.",
      },
      400,
    );
  }
});
