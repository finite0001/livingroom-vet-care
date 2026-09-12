import { authorizeDelivery, DeliveryPolicyError, requireEmailConfiguration } from "../_shared/delivery-policy.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const STAFF_ROLES = new Set(["ADMIN", "DVM", "TECH", "STAFF"]);
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  let accepted = false;
  let acceptanceUnknown = false;
  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader || "" } } });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("id, is_active").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;
    const roles = new Set((rolesRes.data ?? []).map((r: { role: string }) => r.role));
    const isActiveStaff = profileRes.data?.is_active === true && [...roles].some((r) => STAFF_ROLES.has(r as string));
    if (!isActiveStaff) return jsonResponse({ error: "Forbidden" }, 403);

    const { provider_id, subject, body, client_id, pet_id, attachment_paths } = await req.json();
    if (!provider_id || !subject || !body) return jsonResponse({ error: "Missing required fields" }, 400);
    if (typeof body !== "string" || body.trim().length === 0 || body.length > 100000) return jsonResponse({ error: "Invalid body" }, 400);
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > 500) return jsonResponse({ error: "Invalid subject" }, 400);
    if (attachment_paths !== undefined && (!Array.isArray(attachment_paths) || attachment_paths.length > MAX_ATTACHMENTS || attachment_paths.some((p) => typeof p !== "string"))) {
      return jsonResponse({ error: "Invalid attachments" }, 400);
    }

    // Recipient is bound to a provider_contacts row — staff cannot send to arbitrary addresses.
    const { data: provider, error: providerError } = await supabase
      .from("provider_contacts").select("id, name, email, is_active").eq("id", provider_id).maybeSingle();
    if (providerError) throw providerError;
    if (!provider || provider.is_active !== true) return jsonResponse({ error: "Provider not found or inactive" }, 404);
    if (!provider.email) return jsonResponse({ error: "Provider has no email on file" }, 400);

    const delivery = authorizeDelivery({
      APP_ENV: Deno.env.get("APP_ENV"),
      OUTBOUND_DELIVERY_MODE: Deno.env.get("OUTBOUND_DELIVERY_MODE"),
      OUTBOUND_TEST_EMAILS: Deno.env.get("OUTBOUND_TEST_EMAILS"),
      OUTBOUND_TEST_PHONES: Deno.env.get("OUTBOUND_TEST_PHONES"),
    }, "EMAIL", provider.email);
    const emailConfig = requireEmailConfiguration({
      RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
      RESEND_FROM: Deno.env.get("RESEND_FROM"),
      RESEND_REPLY_TO: Deno.env.get("RESEND_REPLY_TO"),
    });

    // Attachments may only come from client_files rows for the named client,
    // so a path can't be pointed at another client's documents.
    const attachments: { filename: string; content: string }[] = [];
    if (attachment_paths?.length) {
      if (!client_id) return jsonResponse({ error: "client_id is required when sending attachments" }, 400);
      const { data: fileRows, error: filesError } = await supabase
        .from("client_files").select("file_path, file_name").eq("client_id", client_id).in("file_path", attachment_paths);
      if (filesError) throw filesError;
      if ((fileRows ?? []).length !== attachment_paths.length) {
        return jsonResponse({ error: "One or more attachments do not belong to this client" }, 403);
      }
      for (const row of fileRows!) {
        const { data: blob, error: dlError } = await supabase.storage.from("client-files").download(row.file_path);
        if (dlError || !blob) return jsonResponse({ error: `Could not read attachment ${row.file_name ?? row.file_path}` }, 400);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length > MAX_ATTACHMENT_BYTES) return jsonResponse({ error: `Attachment too large: ${row.file_name ?? row.file_path}` }, 400);
        attachments.push({ filename: row.file_name ?? row.file_path.split("/").pop() ?? "attachment", content: base64Encode(bytes) });
      }
    }

    const delivered = false;
    let statusNote = "";
    let errorText: string | null = null;
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${emailConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: emailConfig.from, reply_to: emailConfig.replyTo, to: [delivery.recipient], subject: String(subject), text: body.trim(), ...(attachments.length ? { attachments } : {}) }),
      });
      accepted = resp.ok;
      statusNote = accepted
        ? "Resend accepted the request; delivery is unconfirmed (callbacks are not configured)."
        : "Resend rejected the request; message was not accepted.";
      if (!accepted) errorText = `Resend HTTP ${resp.status}`;
    } catch {
      acceptanceUnknown = true;
      errorText = "Provider request failed; acceptance is unknown.";
      statusNote = "Provider acceptance is unknown after a connection failure. Check provider activity before retrying.";
    }

    const { error: logError } = await supabase.from("document_deliveries").insert({
      provider_id, client_id: client_id ?? null, pet_id: pet_id ?? null, channel: "EMAIL",
      recipient: delivery.recipient, subject: String(subject), body_excerpt: body.trim().slice(0, 500),
      attachment_paths: attachment_paths ?? null, delivered, status_note: statusNote, error_text: errorText, sent_by: user.id,
    });

    if (logError) {
      return jsonResponse({ success: false, accepted, acceptance_unknown: acceptanceUnknown, delivered, retry_safe: false,
        error: "Could not save the delivery audit record. Check provider activity before retrying.", note: statusNote }, 500);
    }

    return jsonResponse({ success: accepted, accepted, acceptance_unknown: acceptanceUnknown, retry_safe: false, delivered, note: statusNote });
  } catch (e) {
    if (e instanceof DeliveryPolicyError) return jsonResponse({ success: false, accepted: false, delivered: false, error: e.message }, e.status);
    // Database/provider exceptions can contain personal data; do not return or log raw errors.
    return jsonResponse({ success: false, accepted, acceptance_unknown: acceptanceUnknown, retry_safe: false, delivered: false, error: "Unable to process this delivery request. Check provider activity before retrying if a send was attempted." }, 500);
  }
});
